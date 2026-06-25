import type {
  AppSettings,
  AttachmentRecord,
  CollegeKnowledgeDocument,
  CollegeKnowledgeDocumentStatus,
  DraftStatus,
  ForwardRecord,
  KnowledgeEntry,
  MailCategory,
  MailMessage,
  ProcessingStatus,
  ReplyDraft
} from "@harmonia/shared";

export type UserRecord = {
  id: string;
  email: string;
  passwordHash: string;
  role: string;
  createdAt: string;
};

export type MessageInput = {
  mailboxAddress: string;
  graphMessageId: string;
  internetMessageId: string | null;
  conversationId: string | null;
  subject: string;
  senderName: string | null;
  senderEmail: string;
  toRecipients: string[];
  ccRecipients: string[];
  receivedAt: string;
  bodyText: string;
  hasAttachments: boolean;
};

export type MessageFilters = {
  category?: MailCategory;
  status?: ProcessingStatus;
  needsReview?: boolean;
  hasAttachments?: boolean;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
};

export type MessageProcessingPatch = {
  category?: MailCategory;
  status?: ProcessingStatus;
  needsReview?: boolean;
  extracted?: Record<string, unknown>;
  overview?: string | null;
  recommendation?: string | null;
  error?: string | null;
  processedAt?: string | null;
};

export type DraftInput = {
  messageId: string;
  toEmail: string;
  ccEmails: string[];
  subject: string;
  body: string;
  status?: DraftStatus;
  createdByAi?: boolean;
};

export type ForwardInput = {
  messageId: string;
  toEmail: string;
  subject: string;
  summary: string;
  status: "pending" | "sent" | "failed";
  error: string | null;
  sentAt: string | null;
};

export type SendLogInput = {
  messageId: string | null;
  draftId: string | null;
  kind: "reply" | "auto_reply" | "forward";
  toEmail: string;
  subject: string;
  status: "sent" | "failed" | "skipped";
  error: string | null;
  sentAt: string | null;
};

export type AuditInput = {
  messageId: string | null;
  actor: string;
  action: string;
  detail: Record<string, unknown>;
};

export type AuditRecord = AuditInput & {
  id: string;
  createdAt: string;
};

export type CollegeKnowledgeDocumentInput = Omit<CollegeKnowledgeDocument, "createdAt" | "updatedAt">;

export type CollegeKnowledgeDocumentPatch = Partial<
  Pick<
    CollegeKnowledgeDocument,
    | "fileName"
    | "originalName"
    | "relativePath"
    | "contentType"
    | "size"
    | "sha256"
    | "status"
    | "error"
    | "warnings"
    | "storagePath"
    | "extractedMarkdownPath"
    | "metadataPath"
    | "chunkCount"
  >
> & { status?: CollegeKnowledgeDocumentStatus };

export type CollegeKnowledgeChunkRecord = {
  id: string;
  documentId: string;
  chunkIndex: number;
  title: string | null;
  locator: string;
  sourcePath: string | null;
  text: string;
  markdown: string;
  metadata: Record<string, unknown>;
  tokenCount: number;
  createdAt: string;
  updatedAt: string;
};

export type CollegeKnowledgeChunkInput = Omit<CollegeKnowledgeChunkRecord, "createdAt" | "updatedAt">;

export interface AppRepository {
  migrate(): Promise<void>;
  close(): Promise<void>;

  ensureAdminUser(email: string, passwordHash: string): Promise<UserRecord>;
  findUserByEmail(email: string): Promise<UserRecord | null>;

  getSettings(): Promise<AppSettings>;
  saveSettings(settings: AppSettings): Promise<AppSettings>;

  getSyncState(mailboxAddress: string): Promise<string | null>;
  setSyncState(mailboxAddress: string, deltaLink: string | null): Promise<void>;

  upsertMessage(input: MessageInput): Promise<MailMessage>;
  updateMessageProcessing(id: string, patch: MessageProcessingPatch): Promise<MailMessage>;
  getMessage(id: string): Promise<MailMessage | null>;
  listMessages(filters: MessageFilters): Promise<{ items: MailMessage[]; total: number }>;

  addAttachment(input: Omit<AttachmentRecord, "id" | "createdAt">): Promise<AttachmentRecord>;
  listAttachments(messageId: string): Promise<AttachmentRecord[]>;

  createDraft(input: DraftInput): Promise<ReplyDraft>;
  getDraft(id: string): Promise<ReplyDraft | null>;
  getDraftForMessage(messageId: string): Promise<ReplyDraft | null>;
  listDrafts(status?: DraftStatus): Promise<ReplyDraft[]>;
  updateDraft(id: string, patch: { body?: string; status?: DraftStatus; sentAt?: string | null }): Promise<ReplyDraft>;

  createForwardRecord(input: ForwardInput): Promise<ForwardRecord>;
  listForwardRecords(): Promise<ForwardRecord[]>;

  createSendLog(input: SendLogInput): Promise<void>;
  addAudit(input: AuditInput): Promise<void>;
  listAuditLogs(messageId: string): Promise<AuditRecord[]>;

  listKnowledgeEntries(category?: KnowledgeEntry["category"]): Promise<KnowledgeEntry[]>;
  upsertKnowledgeEntry(input: Omit<KnowledgeEntry, "createdAt" | "updatedAt">): Promise<KnowledgeEntry>;

  upsertCollegeKnowledgeDocument(input: CollegeKnowledgeDocumentInput): Promise<CollegeKnowledgeDocument>;
  updateCollegeKnowledgeDocument(id: string, patch: CollegeKnowledgeDocumentPatch): Promise<CollegeKnowledgeDocument>;
  getCollegeKnowledgeDocument(id: string): Promise<CollegeKnowledgeDocument | null>;
  getCollegeKnowledgeDocumentBySha256(sha256: string): Promise<CollegeKnowledgeDocument | null>;
  listCollegeKnowledgeDocuments(): Promise<CollegeKnowledgeDocument[]>;
  replaceCollegeKnowledgeChunks(documentId: string, chunks: CollegeKnowledgeChunkInput[]): Promise<void>;
  listCollegeKnowledgeChunks(documentId?: string): Promise<CollegeKnowledgeChunkRecord[]>;
  deleteCollegeKnowledgeDocument(id: string): Promise<boolean>;

  dashboard(nowIso: string): Promise<{
    pendingMessages: number;
    pendingDrafts: number;
    processedToday: number;
    autoApprovedToday: number;
    failedMessages: number;
    recentMessages: MailMessage[];
  }>;
}
