import { randomUUID } from "node:crypto";
import { copyFile, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import type { CollegeKnowledgeChatMode, CollegeKnowledgeChatResponse, CollegeKnowledgeDocument, CollegeKnowledgeSource } from "@harmonia/shared";
import type { AiClient, CollegeKnowledgeAnswerResult } from "../ai/client.js";
import type { AppRepository, CollegeKnowledgeChunkInput } from "../db/repository.js";
import { estimateTokenCount } from "./chunker.js";
import {
  isArchiveFile,
  isLegacyUnsupportedOfficeFile,
  isSupportedKnowledgeFile,
  parseKnowledgeDocument,
  readZipEntries
} from "./parser.js";
import { retrieveCollegeKnowledge, snippetFor } from "./retrieval.js";
import {
  cleanupPaths,
  collegeKnowledgeStorageRoot,
  contentTypeFromName,
  documentOriginalDir,
  documentRoot,
  extractedMarkdownPath,
  isIgnorableUploadName,
  metadataPath,
  safeFileName,
  safeStoredOriginalPath,
  sanitizeRelativePath,
  sha256File,
  writeJson,
  writeUtf8
} from "./storage.js";
import type { IndexedKnowledgeChunk, KnowledgeUploadFile, ParsedKnowledgeDocument } from "./types.js";

export type CollegeKnowledgeUploadResult = {
  documents: CollegeKnowledgeDocument[];
  total: number;
  ignored: number;
};

export type CollegeKnowledgeImageInput = {
  tempPath: string;
  fileName: string;
  contentType: string | null;
};

export type CollegeKnowledgeServiceOptions = {
  rerankEnabled?: boolean;
};

export class CollegeKnowledgeService {
  private readonly storageRoot: string;
  private readonly rerankEnabled: boolean;

  constructor(
    private readonly repo: AppRepository,
    private readonly ai: AiClient,
    storageRoot = "storage/college-knowledge",
    options: CollegeKnowledgeServiceOptions = {}
  ) {
    this.storageRoot = collegeKnowledgeStorageRoot(storageRoot);
    this.rerankEnabled = options.rerankEnabled ?? false;
  }

  async listDocuments(): Promise<{ items: CollegeKnowledgeDocument[]; total: number }> {
    const items = await this.repo.listCollegeKnowledgeDocuments();
    return { items, total: items.length };
  }

  async uploadFiles(files: KnowledgeUploadFile[]): Promise<CollegeKnowledgeUploadResult> {
    await mkdir(join(this.storageRoot, "documents"), { recursive: true });
    const expanded = await this.expandArchives(files);
    const documents: CollegeKnowledgeDocument[] = [];
    let ignored = 0;
    try {
      for (const file of expanded.files) {
        if (isIgnorableUploadName(file.fileName, file.relativePath)) {
          ignored += 1;
          continue;
        }
        documents.push(await this.ingestFile(file));
      }
      ignored += expanded.ignored;
      return { documents, total: documents.length, ignored };
    } finally {
      await cleanupPaths(expanded.tempDirs);
    }
  }

  async reindexDocument(id: string): Promise<CollegeKnowledgeDocument | null> {
    const document = await this.repo.getCollegeKnowledgeDocument(id);
    if (!document) return null;
    if (document.status === "unsupported") return document;
    return this.indexStoredDocument(document);
  }

  async deleteDocument(id: string): Promise<boolean> {
    const document = await this.repo.getCollegeKnowledgeDocument(id);
    if (!document) return false;
    const deleted = await this.repo.deleteCollegeKnowledgeDocument(id);
    if (deleted) await rm(documentRoot(this.storageRoot, id), { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    return deleted;
  }

  async chat(input: { question: string; images: CollegeKnowledgeImageInput[]; mode?: CollegeKnowledgeChatMode }): Promise<CollegeKnowledgeChatResponse> {
    const warnings: string[] = [];
    const imageText = await this.describeImages(input.images, warnings);
    const documents = await this.repo.listCollegeKnowledgeDocuments();
    const chunks = await this.repo.listCollegeKnowledgeChunks();
    const rerankEnabled = input.mode ? input.mode === "precise" : this.rerankEnabled;
    const lexicalCandidates = retrieveCollegeKnowledge({
      question: input.question,
      imageText,
      documents,
      chunks,
      limit: rerankEnabled ? 40 : 8
    });
    if (lexicalCandidates.length === 0) {
      return {
        answerable: false,
        answer: "未在已上传的书院知识资料中找到相关依据。",
        sources: [],
        warnings
      };
    }

    const selectedCandidates = rerankEnabled ? await this.rerank(input.question, imageText, lexicalCandidates, warnings) : lexicalCandidates.slice(0, 8);
    const answer = await this.answer(input.question, imageText, selectedCandidates, warnings);
    if (!answer) {
      return {
        answerable: false,
        answer: "模型未配置或未返回可用答案，无法完成带来源引用的问答。",
        sources: selectedCandidates.slice(0, 5).map((chunk) => this.sourceFromChunk(chunk, input.question)),
        warnings: [...warnings, "MODEL_ANSWER_UNAVAILABLE"]
      };
    }

    const selected = this.sourcesFromAnswer(answer, selectedCandidates, input.question);
    return {
      answerable: answer.answerable,
      answer: answer.answer || (answer.answerable ? "" : "未在已上传的书院知识资料中找到明确依据。"),
      sources: answer.answerable ? selected : selected.slice(0, 3),
      warnings: [...warnings, ...answer.warnings]
    };
  }

  private async expandArchives(files: KnowledgeUploadFile[]): Promise<{ files: KnowledgeUploadFile[]; tempDirs: string[]; ignored: number }> {
    const expanded: KnowledgeUploadFile[] = [];
    const tempDirs: string[] = [];
    let ignored = 0;
    for (const file of files) {
      if (!isArchiveFile(file.fileName)) {
        expanded.push(file);
        continue;
      }
      const tempDir = join(this.storageRoot, "tmp", randomUUID());
      tempDirs.push(tempDir);
      await mkdir(tempDir, { recursive: true });
      const entries = await readZipEntries(file.tempPath);
      for (const [index, entry] of entries.entries()) {
        const relativePath = sanitizeRelativePath(entry.name);
        if (!relativePath || isIgnorableUploadName(entry.name, relativePath)) {
          ignored += 1;
          continue;
        }
        const tempPath = join(tempDir, `${index}-${safeFileName(entry.name)}`);
        await writeFile(tempPath, entry.buffer);
        expanded.push({
          tempPath,
          fileName: entry.name,
          contentType: contentTypeFromName(entry.name, null),
          relativePath: file.relativePath ? `${file.relativePath}/${relativePath}` : relativePath
        });
      }
    }
    return { files: expanded, tempDirs, ignored };
  }

  private async ingestFile(file: KnowledgeUploadFile): Promise<CollegeKnowledgeDocument> {
    const sha256 = await sha256File(file.tempPath);
    const existing = await this.repo.getCollegeKnowledgeDocumentBySha256(sha256);
    if (existing) return existing;

    const id = randomUUID();
    const originalDir = documentOriginalDir(this.storageRoot, id);
    const storedPath = safeStoredOriginalPath(originalDir, file.fileName, file.relativePath);
    await mkdir(originalDir, { recursive: true });
    await mkdir(dirname(storedPath), { recursive: true });
    await copyFile(file.tempPath, storedPath);
    const size = (await stat(storedPath)).size;
    const baseDocument = await this.repo.upsertCollegeKnowledgeDocument({
      id,
      fileName: safeFileName(file.fileName),
      originalName: file.fileName,
      relativePath: sanitizeRelativePath(file.relativePath),
      contentType: contentTypeFromName(file.fileName, file.contentType),
      size,
      sha256,
      status: "processing",
      error: null,
      warnings: [],
      storagePath: storedPath,
      extractedMarkdownPath: extractedMarkdownPath(this.storageRoot, id),
      metadataPath: metadataPath(this.storageRoot, id),
      chunkCount: 0
    });

    const ext = extname(file.fileName).toLowerCase();
    if (isLegacyUnsupportedOfficeFile(file.fileName) || !isSupportedKnowledgeFile(file.fileName)) {
      return this.markUnsupported(baseDocument, ext ? `Unsupported file type: ${ext}` : "Unsupported file type");
    }
    return this.indexStoredDocument(baseDocument);
  }

  private async markUnsupported(document: CollegeKnowledgeDocument, error: string): Promise<CollegeKnowledgeDocument> {
    const metadata = { parser: "unsupported", error, originalName: document.originalName };
    await writeJson(document.metadataPath, metadata);
    await writeUtf8(document.extractedMarkdownPath, "");
    await this.repo.replaceCollegeKnowledgeChunks(document.id, []);
    return this.repo.updateCollegeKnowledgeDocument(document.id, {
      status: "unsupported",
      error,
      warnings: [error],
      chunkCount: 0
    });
  }

  private async indexStoredDocument(document: CollegeKnowledgeDocument): Promise<CollegeKnowledgeDocument> {
    await this.repo.updateCollegeKnowledgeDocument(document.id, { status: "processing", error: null });
    try {
      const parsed = await parseKnowledgeDocument({
        filePath: document.storagePath,
        fileName: document.originalName,
        relativePath: document.relativePath
      });
      await this.persistParsedDocument(document, parsed);
      const status = parsed.chunks.length === 0 ? "failed" : parsed.warnings.length > 0 ? "partial" : "ready";
      return this.repo.updateCollegeKnowledgeDocument(document.id, {
        status,
        error: parsed.chunks.length === 0 ? parsed.warnings[0] ?? "NO_EXTRACTABLE_TEXT" : null,
        warnings: parsed.warnings,
        chunkCount: parsed.chunks.length
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "COLLEGE_KNOWLEDGE_PARSE_FAILED";
      await this.repo.replaceCollegeKnowledgeChunks(document.id, []);
      await writeJson(document.metadataPath, { parser: "failed", error: message }).catch(() => undefined);
      await writeUtf8(document.extractedMarkdownPath, "").catch(() => undefined);
      return this.repo.updateCollegeKnowledgeDocument(document.id, {
        status: "failed",
        error: message,
        warnings: [message],
        chunkCount: 0
      });
    }
  }

  private async persistParsedDocument(document: CollegeKnowledgeDocument, parsed: ParsedKnowledgeDocument): Promise<void> {
    await writeUtf8(document.extractedMarkdownPath, parsed.markdown);
    await writeJson(document.metadataPath, {
      ...parsed.metadata,
      originalName: document.originalName,
      relativePath: document.relativePath,
      chunkCount: parsed.chunks.length,
      indexedAt: new Date().toISOString()
    });
    const chunks: CollegeKnowledgeChunkInput[] = parsed.chunks.map((chunk, index) => ({
      id: `${document.id}:${index + 1}`,
      documentId: document.id,
      chunkIndex: index + 1,
      title: chunk.title,
      locator: chunk.locator,
      sourcePath: chunk.sourcePath,
      text: chunk.text,
      markdown: chunk.markdown,
      metadata: chunk.metadata,
      tokenCount: estimateTokenCount(chunk.text)
    }));
    await this.repo.replaceCollegeKnowledgeChunks(document.id, chunks);
  }

  private async describeImages(images: CollegeKnowledgeImageInput[], warnings: string[]): Promise<string | null> {
    const descriptions: string[] = [];
    for (const image of images) {
      try {
        const description = await this.ai.describeCollegeKnowledgeImage({
          filePath: image.tempPath,
          contentType: contentTypeFromName(image.fileName, image.contentType) ?? "application/octet-stream"
        });
        if (description?.trim()) descriptions.push(`${image.fileName}: ${description.trim()}`);
      } catch (error) {
        warnings.push(error instanceof Error ? `IMAGE_PARSE_FAILED: ${error.message}` : "IMAGE_PARSE_FAILED");
      }
    }
    return descriptions.length ? descriptions.join("\n\n") : null;
  }

  private async rerank(
    question: string,
    imageText: string | null,
    candidates: IndexedKnowledgeChunk[],
    warnings: string[]
  ): Promise<IndexedKnowledgeChunk[]> {
    try {
      const result = await this.ai.rerankCollegeKnowledge({
        question,
        imageText,
        candidates: candidates.map((candidate) => ({
          id: candidate.id,
          documentName: candidate.documentName,
          locator: candidate.locator,
          title: candidate.title,
          text: candidate.text,
          lexicalScore: candidate.lexicalScore
        }))
      });
      if (result?.selectedIds.length) {
        const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
        const selected = result.selectedIds.map((id) => byId.get(id)).filter((candidate): candidate is IndexedKnowledgeChunk => Boolean(candidate));
        const selectedIds = new Set(selected.map((candidate) => candidate.id));
        return [...selected, ...candidates.filter((candidate) => !selectedIds.has(candidate.id))].slice(0, 8);
      }
    } catch (error) {
      warnings.push(error instanceof Error ? `MODEL_RERANK_FAILED: ${error.message}` : "MODEL_RERANK_FAILED");
    }
    warnings.push("MODEL_RERANK_UNAVAILABLE");
    return candidates.slice(0, 8);
  }

  private async answer(
    question: string,
    imageText: string | null,
    sources: IndexedKnowledgeChunk[],
    warnings: string[]
  ): Promise<CollegeKnowledgeAnswerResult | null> {
    try {
      return await this.ai.answerCollegeKnowledge({
        question,
        imageText,
        sources: sources.map((source) => ({
          id: source.id,
          documentName: source.documentName,
          locator: source.locator,
          title: source.title,
          text: source.text
        }))
      });
    } catch (error) {
      warnings.push(error instanceof Error ? `MODEL_ANSWER_FAILED: ${error.message}` : "MODEL_ANSWER_FAILED");
      return null;
    }
  }

  private sourcesFromAnswer(answer: CollegeKnowledgeAnswerResult, chunks: IndexedKnowledgeChunk[], query: string): CollegeKnowledgeSource[] {
    const byId = new Map(chunks.map((chunk) => [chunk.id, chunk]));
    const selected = answer.sourceIds.map((id) => byId.get(id)).filter((chunk): chunk is IndexedKnowledgeChunk => Boolean(chunk));
    const fallback = selected.length ? selected : chunks.slice(0, Math.min(3, chunks.length));
    return fallback.map((chunk) => this.sourceFromChunk(chunk, query));
  }

  private sourceFromChunk(chunk: IndexedKnowledgeChunk, query: string): CollegeKnowledgeSource {
    return {
      id: chunk.id,
      documentId: chunk.documentId,
      documentName: chunk.documentName,
      relativePath: chunk.relativePath,
      locator: chunk.locator,
      title: chunk.title,
      snippet: snippetFor(chunk.text, query),
      score: Number(chunk.lexicalScore.toFixed(4))
    };
  }
}
