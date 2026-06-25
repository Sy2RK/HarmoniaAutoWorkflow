import { randomUUID } from "node:crypto";
import type {
  AppSettings,
  AttachmentRecord,
  CollegeKnowledgeDocument,
  DraftStatus,
  ForwardRecord,
  KnowledgeEntry,
  MailMessage,
  ReplyDraft
} from "@harmonia/shared";
import { defaultSettings } from "../config/defaults.js";
import type {
  AppRepository,
  AuditInput,
  CollegeKnowledgeChunkInput,
  CollegeKnowledgeChunkRecord,
  CollegeKnowledgeDocumentInput,
  CollegeKnowledgeDocumentPatch,
  DraftInput,
  ForwardInput,
  MessageFilters,
  MessageInput,
  MessageProcessingPatch,
  SendLogInput,
  UserRecord
} from "./repository.js";

function now(): string {
  return new Date().toISOString();
}

export class InMemoryRepository implements AppRepository {
  private users = new Map<string, UserRecord>();
  private settings: AppSettings;
  private syncStates = new Map<string, string | null>();
  private messages = new Map<string, MailMessage>();
  private attachments = new Map<string, AttachmentRecord>();
  private drafts = new Map<string, ReplyDraft>();
  private forwards = new Map<string, ForwardRecord>();
  private knowledge = new Map<string, KnowledgeEntry>();
  private collegeKnowledgeDocuments = new Map<string, CollegeKnowledgeDocument>();
  private collegeKnowledgeChunks = new Map<string, CollegeKnowledgeChunkRecord>();
  private audits: import("./repository.js").AuditRecord[] = [];

  constructor(mailboxAddress = "public@example.edu.cn") {
    this.settings = defaultSettings(mailboxAddress);
  }

  async migrate(): Promise<void> {
    return;
  }

  async close(): Promise<void> {
    return;
  }

  async ensureAdminUser(email: string, passwordHash: string): Promise<UserRecord> {
    const existing = await this.findUserByEmail(email);
    if (existing) return existing;
    const record = { id: randomUUID(), email, passwordHash, role: "admin", createdAt: now() };
    this.users.set(email.toLowerCase(), record);
    return record;
  }

  async findUserByEmail(email: string): Promise<UserRecord | null> {
    return this.users.get(email.toLowerCase()) ?? null;
  }

  async getSettings(): Promise<AppSettings> {
    return structuredClone(this.settings);
  }

  async saveSettings(settings: AppSettings): Promise<AppSettings> {
    this.settings = structuredClone(settings);
    return this.getSettings();
  }

  async getSyncState(mailboxAddress: string): Promise<string | null> {
    return this.syncStates.get(mailboxAddress) ?? null;
  }

  async setSyncState(mailboxAddress: string, deltaLink: string | null): Promise<void> {
    this.syncStates.set(mailboxAddress, deltaLink);
  }

  async upsertMessage(input: MessageInput): Promise<MailMessage> {
    const existing = [...this.messages.values()].find(
      (message) => message.mailboxAddress === input.mailboxAddress && message.graphMessageId === input.graphMessageId
    );
    const stamp = now();
    const message: MailMessage = {
      id: existing?.id ?? randomUUID(),
      mailboxAddress: input.mailboxAddress,
      graphMessageId: input.graphMessageId,
      internetMessageId: input.internetMessageId,
      conversationId: input.conversationId,
      subject: input.subject,
      senderName: input.senderName,
      senderEmail: input.senderEmail,
      toRecipients: [...input.toRecipients],
      ccRecipients: [...input.ccRecipients],
      receivedAt: input.receivedAt,
      bodyText: input.bodyText,
      hasAttachments: input.hasAttachments,
      category: existing?.category ?? "other",
      status: existing?.status ?? "new",
      needsReview: existing?.needsReview ?? true,
      extracted: existing?.extracted ?? {},
      overview: existing?.overview ?? null,
      recommendation: existing?.recommendation ?? null,
      error: existing?.error ?? null,
      processedAt: existing?.processedAt ?? null,
      createdAt: existing?.createdAt ?? stamp,
      updatedAt: stamp
    };
    this.messages.set(message.id, message);
    return structuredClone(message);
  }

  async updateMessageProcessing(id: string, patch: MessageProcessingPatch): Promise<MailMessage> {
    const message = this.messages.get(id);
    if (!message) throw new Error(`Message ${id} not found`);
    const updated: MailMessage = { ...message, ...patch, updatedAt: now() };
    this.messages.set(id, updated);
    return structuredClone(updated);
  }

  async getMessage(id: string): Promise<MailMessage | null> {
    const message = this.messages.get(id);
    return message ? structuredClone(message) : null;
  }

  async listMessages(filters: MessageFilters): Promise<{ items: MailMessage[]; total: number }> {
    let items = [...this.messages.values()];
    if (filters.category) items = items.filter((item) => item.category === filters.category);
    if (filters.status) items = items.filter((item) => item.status === filters.status);
    if (filters.needsReview !== undefined) items = items.filter((item) => item.needsReview === filters.needsReview);
    if (filters.hasAttachments !== undefined) items = items.filter((item) => item.hasAttachments === filters.hasAttachments);
    if (filters.from) items = items.filter((item) => item.receivedAt >= filters.from!);
    if (filters.to) items = items.filter((item) => item.receivedAt <= filters.to!);
    items = items.toSorted((a, b) => b.receivedAt.localeCompare(a.receivedAt));
    const total = items.length;
    const offset = filters.offset ?? 0;
    const limit = filters.limit ?? 50;
    return { items: structuredClone(items.slice(offset, offset + limit)), total };
  }

  async addAttachment(input: Omit<AttachmentRecord, "id" | "createdAt">): Promise<AttachmentRecord> {
    const existing = [...this.attachments.values()].find(
      (item) => item.messageId === input.messageId && item.graphAttachmentId === input.graphAttachmentId
    );
    const record: AttachmentRecord = {
      ...input,
      id: existing?.id ?? randomUUID(),
      createdAt: existing?.createdAt ?? now()
    };
    this.attachments.set(record.id, record);
    return structuredClone(record);
  }

  async listAttachments(messageId: string): Promise<AttachmentRecord[]> {
    return structuredClone([...this.attachments.values()].filter((item) => item.messageId === messageId));
  }

  async createDraft(input: DraftInput): Promise<ReplyDraft> {
    const stamp = now();
    const draft: ReplyDraft = {
      id: randomUUID(),
      messageId: input.messageId,
      toEmail: input.toEmail,
      ccEmails: [...input.ccEmails],
      subject: input.subject,
      body: input.body,
      status: input.status ?? "draft",
      createdByAi: input.createdByAi ?? true,
      sentAt: null,
      createdAt: stamp,
      updatedAt: stamp
    };
    this.drafts.set(draft.id, draft);
    return structuredClone(draft);
  }

  async getDraft(id: string): Promise<ReplyDraft | null> {
    const draft = this.drafts.get(id);
    return draft ? structuredClone(draft) : null;
  }

  async getDraftForMessage(messageId: string): Promise<ReplyDraft | null> {
    const draft = [...this.drafts.values()]
      .filter((item) => item.messageId === messageId)
      .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    return draft ? structuredClone(draft) : null;
  }

  async listDrafts(status?: DraftStatus): Promise<ReplyDraft[]> {
    const drafts = [...this.drafts.values()]
      .filter((draft) => (status ? draft.status === status : true))
      .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return structuredClone(drafts);
  }

  async updateDraft(id: string, patch: { body?: string; status?: DraftStatus; sentAt?: string | null }): Promise<ReplyDraft> {
    const draft = this.drafts.get(id);
    if (!draft) throw new Error(`Draft ${id} not found`);
    const updated: ReplyDraft = { ...draft, ...patch, updatedAt: now() };
    this.drafts.set(id, updated);
    return structuredClone(updated);
  }

  async createForwardRecord(input: ForwardInput): Promise<ForwardRecord> {
    const record: ForwardRecord = { id: randomUUID(), createdAt: now(), ...input };
    this.forwards.set(record.id, record);
    return structuredClone(record);
  }

  async listForwardRecords(): Promise<ForwardRecord[]> {
    return structuredClone([...this.forwards.values()].toSorted((a, b) => b.createdAt.localeCompare(a.createdAt)));
  }

  async createSendLog(_input: SendLogInput): Promise<void> {
    return;
  }

  async addAudit(input: AuditInput): Promise<void> {
    this.audits.push({ ...input, id: randomUUID(), createdAt: now() });
  }

  async listAuditLogs(messageId: string): Promise<import("./repository.js").AuditRecord[]> {
    return structuredClone(this.audits.filter((audit) => audit.messageId === messageId).toSorted((a, b) => b.createdAt.localeCompare(a.createdAt)));
  }

  async listKnowledgeEntries(category?: KnowledgeEntry["category"]): Promise<KnowledgeEntry[]> {
    return structuredClone([...this.knowledge.values()].filter((entry) => (category ? entry.category === category : true)));
  }

  async upsertKnowledgeEntry(input: Omit<KnowledgeEntry, "createdAt" | "updatedAt">): Promise<KnowledgeEntry> {
    const existing = this.knowledge.get(input.id);
    const stamp = now();
    const record: KnowledgeEntry = {
      ...input,
      createdAt: existing?.createdAt ?? stamp,
      updatedAt: stamp
    };
    this.knowledge.set(record.id, record);
    return structuredClone(record);
  }

  async upsertCollegeKnowledgeDocument(input: CollegeKnowledgeDocumentInput): Promise<CollegeKnowledgeDocument> {
    const existing = this.collegeKnowledgeDocuments.get(input.id);
    const stamp = now();
    const record: CollegeKnowledgeDocument = {
      ...input,
      createdAt: existing?.createdAt ?? stamp,
      updatedAt: stamp
    };
    this.collegeKnowledgeDocuments.set(record.id, record);
    return structuredClone(record);
  }

  async updateCollegeKnowledgeDocument(id: string, patch: CollegeKnowledgeDocumentPatch): Promise<CollegeKnowledgeDocument> {
    const document = this.collegeKnowledgeDocuments.get(id);
    if (!document) throw new Error(`College knowledge document ${id} not found`);
    const updated: CollegeKnowledgeDocument = { ...document, ...patch, updatedAt: now() };
    this.collegeKnowledgeDocuments.set(id, updated);
    return structuredClone(updated);
  }

  async getCollegeKnowledgeDocument(id: string): Promise<CollegeKnowledgeDocument | null> {
    const document = this.collegeKnowledgeDocuments.get(id);
    return document ? structuredClone(document) : null;
  }

  async getCollegeKnowledgeDocumentBySha256(sha256: string): Promise<CollegeKnowledgeDocument | null> {
    const document = [...this.collegeKnowledgeDocuments.values()].find((item) => item.sha256 === sha256);
    return document ? structuredClone(document) : null;
  }

  async listCollegeKnowledgeDocuments(): Promise<CollegeKnowledgeDocument[]> {
    return structuredClone([...this.collegeKnowledgeDocuments.values()].toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
  }

  async replaceCollegeKnowledgeChunks(documentId: string, chunks: CollegeKnowledgeChunkInput[]): Promise<void> {
    for (const [id, chunk] of this.collegeKnowledgeChunks.entries()) {
      if (chunk.documentId === documentId) this.collegeKnowledgeChunks.delete(id);
    }
    const stamp = now();
    for (const chunk of chunks) {
      this.collegeKnowledgeChunks.set(chunk.id, {
        ...chunk,
        createdAt: stamp,
        updatedAt: stamp
      });
    }
  }

  async listCollegeKnowledgeChunks(documentId?: string): Promise<CollegeKnowledgeChunkRecord[]> {
    const chunks = [...this.collegeKnowledgeChunks.values()]
      .filter((chunk) => (documentId ? chunk.documentId === documentId : true))
      .toSorted((a, b) => a.documentId.localeCompare(b.documentId) || a.chunkIndex - b.chunkIndex);
    return structuredClone(chunks);
  }

  async deleteCollegeKnowledgeDocument(id: string): Promise<boolean> {
    const deleted = this.collegeKnowledgeDocuments.delete(id);
    for (const [chunkId, chunk] of this.collegeKnowledgeChunks.entries()) {
      if (chunk.documentId === id) this.collegeKnowledgeChunks.delete(chunkId);
    }
    return deleted;
  }

  async dashboard(nowIso: string): Promise<{
    pendingMessages: number;
    pendingDrafts: number;
    processedToday: number;
    autoApprovedToday: number;
    failedMessages: number;
    recentMessages: MailMessage[];
  }> {
    const day = new Date(nowIso);
    day.setHours(0, 0, 0, 0);
    const start = day.toISOString();
    const messages = [...this.messages.values()];
    return {
      pendingMessages: messages.filter((message) => ["new", "processing", "manual_required", "awaiting_review"].includes(message.status)).length,
      pendingDrafts: [...this.drafts.values()].filter((draft) => ["draft", "saved", "manual_required"].includes(draft.status)).length,
      processedToday: messages.filter((message) => message.processedAt && message.processedAt >= start).length,
      autoApprovedToday: messages.filter((message) => message.status === "auto_approved" && message.processedAt && message.processedAt >= start).length,
      failedMessages: messages.filter((message) => message.status === "failed").length,
      recentMessages: structuredClone(messages.toSorted((a, b) => b.receivedAt.localeCompare(a.receivedAt)).slice(0, 8))
    };
  }
}
