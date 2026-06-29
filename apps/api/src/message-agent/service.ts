import { randomUUID } from "node:crypto";
import { copyFile, mkdir, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  MessageAgentChatMode,
  MessageAgentChatResponse,
  MessageAgentDraft,
  MessageAgentFileRole,
  MessageAgentMessage,
  MessageAgentQuestion,
  MessageAgentSession,
  MessageAgentSource,
  MessageAgentSourceRef,
  MessageAgentTemplate,
  MessageAgentUploadProgress
} from "@harmonia/shared";
import type { AiClient, MessageAgentClassification } from "../ai/client.js";
import { buildMessageDraftDocx } from "./docx-export.js";
import { parseMessageAgentFile } from "./parser.js";
import type { MessageAgentTemplateSeed } from "./parser.js";
import {
  classifyByText,
  fallbackDraft,
  fallbackTemplateFromSeed,
  missingSlotsFor,
  questionsForMissing,
  retrieveTemplates,
  sourceRefsForTemplates
} from "./templates.js";
import {
  cleanupPaths,
  contentTypeFromName,
  isIgnorableUploadName,
  messageAgentStorageRoot,
  readJson,
  safeFileName,
  safeStoredPath,
  sanitizeRelativePath,
  sessionGeneratedDir,
  sessionInputDir,
  sessionJsonPath,
  sessionRoot,
  tempUploadFileName,
  writeJson
} from "./storage.js";

const staleUploadProgressMs = 2 * 60 * 1000;
const templateExtractionConcurrency = 4;

export type MessageAgentUploadedFile = {
  tempPath: string;
  fileName: string;
  contentType: string | null;
  relativePath: string | null;
};

export type MessageAgentImageFile = {
  tempPath: string;
  fileName: string;
  contentType: string | null;
};

export type MessageAgentSessionDetail = {
  session: MessageAgentSession;
  messages: MessageAgentMessage[];
  sources: MessageAgentSource[];
  templates: MessageAgentTemplate[];
  latestDraft: MessageAgentDraft | null;
  uploadProgress: MessageAgentUploadProgress | null;
};

type MessageAgentStoredSource = MessageAgentSource & {
  storagePath: string;
};

type StoredSessionDetail = Omit<MessageAgentSessionDetail, "sources"> & {
  sources: MessageAgentStoredSource[];
};

type SessionState = StoredSessionDetail & {
  drafts: MessageAgentDraft[];
};

export class MessageAgentService {
  private readonly storageRoot: string;
  private readonly sessionLocks = new Map<string, Promise<void>>();

  constructor(private readonly ai: AiClient, storageRoot = "storage/message-agent") {
    this.storageRoot = messageAgentStorageRoot(storageRoot);
  }

  async createSession(): Promise<MessageAgentSession> {
    const now = new Date().toISOString();
    const state: SessionState = {
      session: {
        id: randomUUID(),
        status: "active",
        createdAt: now,
        updatedAt: now,
        sourceCount: 0,
        templateCount: 0,
        messageCount: 0,
        latestDraftId: null
      },
      messages: [],
      sources: [],
      templates: [],
      drafts: [],
      latestDraft: null,
      uploadProgress: null
    };
    await this.saveState(state);
    return state.session;
  }

  async getSession(id: string): Promise<MessageAgentSessionDetail | null> {
    const state = await this.loadState(id);
    if (!state) return null;
    if (this.markStaleUploadProgress(state)) await this.saveState(state);
    return this.publicDetail(state);
  }

  async deleteSession(id: string): Promise<boolean> {
    return this.withSessionLock(id, async () => {
      const state = await this.loadState(id);
      if (!state) return false;
      await rm(sessionRoot(this.storageRoot, id), { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      return true;
    });
  }

  async uploadFiles(
    sessionId: string,
    files: MessageAgentUploadedFile[],
    role: MessageAgentFileRole
  ): Promise<{
    session: MessageAgentSession;
    sources: MessageAgentSource[];
    templates: MessageAgentTemplate[];
    warnings: string[];
    uploadProgress: MessageAgentUploadProgress | null;
  } | null> {
    return this.withSessionLock(sessionId, () => this.uploadFilesUnlocked(sessionId, files, role));
  }

  private async uploadFilesUnlocked(
    sessionId: string,
    files: MessageAgentUploadedFile[],
    role: MessageAgentFileRole
  ): Promise<{
    session: MessageAgentSession;
    sources: MessageAgentSource[];
    templates: MessageAgentTemplate[];
    warnings: string[];
    uploadProgress: MessageAgentUploadProgress | null;
  } | null> {
    const state = await this.loadState(sessionId);
    if (!state) return null;
    const warnings: string[] = [];
    const createdSources: MessageAgentStoredSource[] = [];
    const createdTemplates: MessageAgentTemplate[] = [];

    const startedAt = new Date().toISOString();
    state.uploadProgress = {
      active: true,
      phase: "uploading",
      role,
      totalFiles: files.length,
      processedFiles: 0,
      currentFileName: null,
      warnings: [],
      error: null,
      startedAt,
      updatedAt: startedAt,
      finishedAt: null
    };
    await this.saveState(state);

    try {
      for (const file of files) {
        this.updateUploadProgress(state, { phase: "parsing", currentFileName: file.fileName, warnings: [...warnings] });
        await this.saveState(state);

        if (isIgnorableUploadName(file.fileName, file.relativePath)) {
          warnings.push(`IGNORED_TEMP_FILE:${file.fileName}`);
          this.updateUploadProgress(state, {
            processedFiles: (state.uploadProgress?.processedFiles ?? 0) + 1,
            currentFileName: file.fileName,
            warnings: [...warnings]
          });
          await this.saveState(state);
          continue;
        }

        const source = await this.storeAndParseFile(state, file, role);
        state.sources.push(source.source);
        createdSources.push(source.source);
        warnings.push(...source.source.warnings);
        if (role === "reference" && source.seeds.length > 0 && source.source.status !== "unsupported") {
          this.updateUploadProgress(state, { phase: "templating", currentFileName: file.fileName, warnings: [...warnings] });
          const templates = await this.templatesFromSeeds(source.seeds, source.source);
          state.templates.push(...templates);
          createdTemplates.push(...templates);
        }
        this.updateUploadProgress(state, {
          phase: "parsing",
          processedFiles: (state.uploadProgress?.processedFiles ?? 0) + 1,
          currentFileName: file.fileName,
          warnings: [...warnings]
        });
        await this.saveState(state);
      }

      this.updateUploadProgress(state, {
        active: false,
        phase: "completed",
        processedFiles: files.length,
        currentFileName: null,
        warnings: [...warnings],
        finishedAt: new Date().toISOString()
      });
      await this.saveState(state);
      return { session: state.session, sources: createdSources.map(publicSource), templates: createdTemplates, warnings, uploadProgress: state.uploadProgress };
    } catch (error) {
      const message = error instanceof Error ? error.message : "MESSAGE_AGENT_UPLOAD_FAILED";
      warnings.push(`MESSAGE_AGENT_UPLOAD_FAILED:${message}`);
      this.updateUploadProgress(state, {
        active: false,
        phase: "failed",
        warnings: [...warnings],
        error: message,
        finishedAt: new Date().toISOString()
      });
      await this.saveState(state);
      throw error;
    }
  }

  async chat(
    sessionId: string,
    input: { message: string; mode: MessageAgentChatMode; images: MessageAgentImageFile[] }
  ): Promise<MessageAgentChatResponse | null> {
    return this.withSessionLock(sessionId, () => this.chatUnlocked(sessionId, input));
  }

  async clearChat(sessionId: string): Promise<MessageAgentSessionDetail | null> {
    return this.withSessionLock(sessionId, async () => {
      const state = await this.loadState(sessionId);
      if (!state) return null;
      state.messages = [];
      await this.saveState(state);
      return this.publicDetail(state);
    });
  }

  private async chatUnlocked(
    sessionId: string,
    input: { message: string; mode: MessageAgentChatMode; images: MessageAgentImageFile[] }
  ): Promise<MessageAgentChatResponse | null> {
    const state = await this.loadState(sessionId);
    if (!state) return null;
    const warnings: string[] = [];
    const imageText = await this.describeImages(input.images, warnings);
    const context = this.contextFor(state, input.message, imageText);
    const userMessage = this.message("user", input.message, imageText ? { imageText } : {});
    state.messages.push(userMessage);
    const classification = (await this.classify(input.message, context, warnings)) ?? classifyByText(context);
    const templates = retrieveTemplates({ templates: state.templates, query: context, category: classification.category, limit: 8 });
    const sourceRefs = sourceRefsForTemplates(templates, state.sources, context);
    const plan = await this.plan(input.message, context, classification, templates, warnings);
    if (plan.followUpQuestions.length > 0) {
      const content = plan.followUpQuestions.map((question) => question.question).join("\n");
      const assistantMessage = this.message("assistant", content, {
        type: "follow_up",
        missingSlots: plan.missingSlots,
        followUpQuestions: plan.followUpQuestions,
        sourceRefs,
        warnings: [...warnings]
      });
      state.messages.push(assistantMessage);
      await this.saveState(state);
      return {
        session: state.session,
        assistantMessage,
        draft: null,
        followUpQuestions: plan.followUpQuestions,
        sources: sourceRefs,
        warnings
      };
    }

    const generated = await this.generateDraft(input.message, context, classification, templates, warnings);
    warnings.push(...generated.warnings);
    const now = new Date().toISOString();
    const draft: MessageAgentDraft = {
      id: randomUUID(),
      subject: generated.subject,
      body: generated.body,
      plainText: `Subject: ${generated.subject}\n\n${generated.body}`,
      sourceIds: sourceRefs.map((source) => source.sourceId),
      sourceRefs,
      attachmentSuggestions: generated.attachmentSuggestions,
      missingSlots: [],
      createdAt: now,
      updatedAt: now,
      editedAt: null
    };
    state.drafts.push(draft);
    state.latestDraft = draft;
    state.session.latestDraftId = draft.id;
    const assistantMessage = this.message("assistant", draft.plainText, { type: "draft", draftId: draft.id, sourceRefs, warnings: [...warnings] });
    state.messages.push(assistantMessage);
    await this.saveState(state);
    return {
      session: state.session,
      assistantMessage,
      draft,
      followUpQuestions: [],
      sources: sourceRefs,
      warnings
    };
  }

  async patchDraft(sessionId: string, patch: { subject?: string; body?: string }): Promise<MessageAgentDraft | null> {
    return this.withSessionLock(sessionId, () => this.patchDraftUnlocked(sessionId, patch));
  }

  private async patchDraftUnlocked(sessionId: string, patch: { subject?: string; body?: string }): Promise<MessageAgentDraft | null> {
    const state = await this.loadState(sessionId);
    if (!state || !state.latestDraft) return null;
    const index = state.drafts.findIndex((draft) => draft.id === state.latestDraft?.id);
    if (index < 0) return null;
    const now = new Date().toISOString();
    const current = state.drafts[index]!;
    const updated: MessageAgentDraft = {
      ...current,
      subject: patch.subject ?? current.subject,
      body: patch.body ?? current.body,
      plainText: `Subject: ${patch.subject ?? current.subject}\n\n${patch.body ?? current.body}`,
      updatedAt: now,
      editedAt: now
    };
    state.drafts[index] = updated;
    state.latestDraft = updated;
    await this.saveState(state);
    return updated;
  }

  async draftDocx(sessionId: string): Promise<{ buffer: Buffer; fileName: string } | null> {
    const state = await this.loadState(sessionId);
    if (!state?.latestDraft) return null;
    const sources =
      state.latestDraft.sourceRefs ??
      sourceRefsForTemplates(
        state.templates.filter((template) => template.sourceIds.some((sourceId) => state.latestDraft?.sourceIds.includes(sourceId))),
        state.sources,
        state.latestDraft.body
      );
    const buffer = await buildMessageDraftDocx({ draft: state.latestDraft, sources });
    await mkdir(sessionGeneratedDir(this.storageRoot, sessionId), { recursive: true });
    return { buffer, fileName: "message-agent-draft.docx" };
  }

  private async storeAndParseFile(
    state: SessionState,
    file: MessageAgentUploadedFile,
    role: MessageAgentFileRole
  ): Promise<{ source: MessageAgentStoredSource; seeds: MessageAgentTemplateSeed[] }> {
    const id = randomUUID();
    const inputDir = sessionInputDir(this.storageRoot, state.session.id);
    const storedPath = safeStoredPath(inputDir, file.fileName, file.relativePath);
    await mkdir(dirname(storedPath), { recursive: true });
    await copyFile(file.tempPath, storedPath);
    const parsed = await parseMessageAgentFile({ filePath: storedPath, fileName: file.fileName });
    const size = (await stat(storedPath)).size;
    const source: MessageAgentStoredSource = {
      id,
      sessionId: state.session.id,
      fileName: safeFileName(file.fileName),
      originalName: file.fileName,
      relativePath: sanitizeRelativePath(file.relativePath),
      role,
      contentType: contentTypeFromName(file.fileName, file.contentType),
      size,
      status: parsed.status,
      text: parsed.text,
      warnings: parsed.warnings,
      storagePath: storedPath,
      createdAt: new Date().toISOString()
    };
    return { source, seeds: parsed.templateSeeds };
  }

  private async templateFromSeed(seed: MessageAgentTemplateSeed, source: MessageAgentSource): Promise<MessageAgentTemplate> {
    try {
      const extracted = await this.ai.extractMessageAgentTemplate({
        sourceTitle: seed.title,
        categoryHint: seed.category,
        text: seed.text
      });
      return fallbackTemplateFromSeed(seed, source, extracted);
    } catch {
      return fallbackTemplateFromSeed(seed, source, null);
    }
  }

  private async templatesFromSeeds(seeds: MessageAgentTemplateSeed[], source: MessageAgentSource): Promise<MessageAgentTemplate[]> {
    const templates: Array<MessageAgentTemplate | undefined> = new Array(seeds.length);
    let nextIndex = 0;
    const workers = Array.from({ length: Math.min(templateExtractionConcurrency, seeds.length) }, async () => {
      while (nextIndex < seeds.length) {
        const index = nextIndex;
        nextIndex += 1;
        const seed = seeds[index];
        if (!seed) continue;
        templates[index] = await this.templateFromSeed(seed, source);
      }
    });
    await Promise.all(workers);
    return templates.filter((template): template is MessageAgentTemplate => Boolean(template));
  }

  private async classify(message: string, context: string, warnings: string[]): Promise<MessageAgentClassification | null> {
    try {
      return await this.ai.classifyMessageAgentRequest({ message, context });
    } catch (error) {
      warnings.push(error instanceof Error ? `MESSAGE_AGENT_CLASSIFY_FAILED:${error.message}` : "MESSAGE_AGENT_CLASSIFY_FAILED");
      return null;
    }
  }

  private async plan(
    message: string,
    context: string,
    classification: MessageAgentClassification,
    templates: MessageAgentTemplate[],
    warnings: string[]
  ): Promise<{ missingSlots: ReturnType<typeof missingSlotsFor>; followUpQuestions: MessageAgentQuestion[] }> {
    const fallbackMissing = missingSlotsFor(classification.category, context);
    try {
      const aiPlan = await this.ai.planMessageAgentDraft({
        message,
        context,
        category: classification.category,
        templates: templates.map((template) => ({
          id: template.id,
          title: template.title,
          category: template.category,
          bodySkeleton: template.bodySkeleton,
          requiredSlots: template.requiredSlots
        }))
      });
      if (aiPlan) {
        const missingSlots = aiPlan.ready ? [] : aiPlan.missingSlots.length ? aiPlan.missingSlots : fallbackMissing;
        return { missingSlots, followUpQuestions: aiPlan.ready ? [] : aiPlan.questions.length ? aiPlan.questions : questionsForMissing(missingSlots) };
      }
    } catch (error) {
      warnings.push(error instanceof Error ? `MESSAGE_AGENT_PLAN_FAILED:${error.message}` : "MESSAGE_AGENT_PLAN_FAILED");
    }
    return { missingSlots: fallbackMissing, followUpQuestions: questionsForMissing(fallbackMissing) };
  }

  private async generateDraft(
    message: string,
    context: string,
    classification: MessageAgentClassification,
    templates: MessageAgentTemplate[],
    warnings: string[]
  ): Promise<{ subject: string; body: string; attachmentSuggestions: string[]; warnings: string[] }> {
    try {
      const generated = await this.ai.generateMessageAgentDraft({
        message,
        context,
        category: classification.category,
        language: classification.language,
        audience: classification.audience,
        templates: templates.map((template) => ({ id: template.id, title: template.title, bodySkeleton: template.bodySkeleton }))
      });
      if (generated?.subject && generated.body) return generated;
    } catch (error) {
      warnings.push(error instanceof Error ? `MESSAGE_AGENT_GENERATE_FAILED:${error.message}` : "MESSAGE_AGENT_GENERATE_FAILED");
    }
    return fallbackDraft({ category: classification.category, language: classification.language, context, templates });
  }

  private async describeImages(images: MessageAgentImageFile[], warnings: string[]): Promise<string | null> {
    const texts: string[] = [];
    for (const image of images) {
      try {
        const text = await this.ai.describeMessageAgentImage({
          filePath: image.tempPath,
          contentType: contentTypeFromName(image.fileName, image.contentType) ?? "application/octet-stream"
        });
        if (text?.trim()) texts.push(`${image.fileName}: ${text.trim()}`);
      } catch (error) {
        warnings.push(error instanceof Error ? `MESSAGE_AGENT_IMAGE_FAILED:${error.message}` : "MESSAGE_AGENT_IMAGE_FAILED");
      }
    }
    return texts.length ? texts.join("\n\n") : null;
  }

  private contextFor(state: SessionState, message: string, imageText: string | null): string {
    const requestSources = state.sources.filter((source) => source.role === "request" && source.text).map((source) => source.text);
    const userMessages = state.messages.filter((item) => item.role === "user").map((item) => item.content);
    return [requestSources.join("\n\n"), userMessages.join("\n\n"), message, imageText].filter(Boolean).join("\n\n");
  }

  private message(role: "user" | "assistant", content: string, metadata: Record<string, unknown>): MessageAgentMessage {
    return { id: randomUUID(), role, content, metadata, createdAt: new Date().toISOString() };
  }

  private async withSessionLock<T>(sessionId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.sessionLocks.get(sessionId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queued = previous.catch(() => undefined).then(() => current);
    this.sessionLocks.set(sessionId, queued);
    await previous.catch(() => undefined);
    try {
      return await task();
    } finally {
      release();
      if (this.sessionLocks.get(sessionId) === queued) this.sessionLocks.delete(sessionId);
    }
  }

  private async loadState(sessionId: string): Promise<SessionState | null> {
    return readJson<SessionState>(sessionJsonPath(this.storageRoot, sessionId));
  }

  private async saveState(state: SessionState): Promise<void> {
    state.latestDraft = state.drafts.at(-1) ?? null;
    state.session.sourceCount = state.sources.length;
    state.session.templateCount = state.templates.length;
    state.session.messageCount = state.messages.length;
    state.session.latestDraftId = state.latestDraft?.id ?? null;
    state.session.updatedAt = new Date().toISOString();
    await writeJson(sessionJsonPath(this.storageRoot, state.session.id), state);
  }

  private updateUploadProgress(state: SessionState, patch: Partial<MessageAgentUploadProgress>): void {
    if (!state.uploadProgress) return;
    state.uploadProgress = {
      ...state.uploadProgress,
      ...patch,
      updatedAt: new Date().toISOString()
    };
  }

  private markStaleUploadProgress(state: SessionState): boolean {
    const progress = state.uploadProgress;
    if (!progress?.active || this.sessionLocks.has(state.session.id)) return false;
    const updatedAt = Date.parse(progress.updatedAt);
    if (!Number.isFinite(updatedAt) || Date.now() - updatedAt < staleUploadProgressMs) return false;
    this.updateUploadProgress(state, {
      active: false,
      phase: "failed",
      error: "MESSAGE_AGENT_UPLOAD_INTERRUPTED_RETRY_UPLOAD",
      finishedAt: new Date().toISOString()
    });
    return true;
  }

  private publicDetail(state: SessionState): MessageAgentSessionDetail {
    return {
      session: state.session,
      messages: state.messages,
      sources: state.sources.map(publicSource),
      templates: state.templates,
      latestDraft: state.latestDraft,
      uploadProgress: state.uploadProgress ?? null
    };
  }
}

function publicSource(source: MessageAgentStoredSource): MessageAgentSource {
  const { storagePath: _storagePath, ...rest } = source;
  return rest;
}

export function messageAgentTempUploadName(rawName: string, index: number): string {
  return tempUploadFileName(rawName, index);
}

export async function cleanupMessageAgentTemp(paths: string[]): Promise<void> {
  await cleanupPaths(paths);
}
