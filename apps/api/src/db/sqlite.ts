import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import initSqlJs from "sql.js";
import { scholarshipAiModels } from "@harmonia/shared";
import type {
  AppSettings,
  AttachmentRecord,
  CollegeKnowledgeDocument,
  DraftStatus,
  ForwardRecord,
  KnowledgeEntry,
  MailCategory,
  MailMessage,
  ProcessingStatus,
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

type SqlValue = number | string | Uint8Array | null;
type SqlParam = SqlValue;
type SqliteRow = Record<string, SqlValue | undefined>;
type QueryExecResult = {
  columns: string[];
  values: SqlValue[][];
};

type SqlJsDatabase = {
  close(): void;
  exec(sql: string, params?: SqlParam[] | null): QueryExecResult[];
  export(): Uint8Array;
  run(sql: string, params?: SqlParam[] | null): SqlJsDatabase;
};

type SqlJsStatic = {
  Database: new (data?: ArrayLike<number> | null) => SqlJsDatabase;
};

const memoryPath = ":memory:";
let sqlJs: Promise<SqlJsStatic> | null = null;

function currentIso(): string {
  return new Date().toISOString();
}

function getSqlJs(): Promise<SqlJsStatic> {
  sqlJs ??= initSqlJs() as Promise<SqlJsStatic>;
  return sqlJs;
}

function findWorkspaceRoot(): string {
  let current = process.cwd();
  while (true) {
    if (existsSync(join(current, "pnpm-workspace.yaml"))) return current;
    const parent = dirname(current);
    if (parent === current) return process.cwd();
    current = parent;
  }
}

function resolveDbPath(dbPath: string): string {
  if (dbPath === memoryPath) return dbPath;
  return isAbsolute(dbPath) ? dbPath : resolve(findWorkspaceRoot(), dbPath);
}

function resolveSchemaPath(): string {
  const candidates = [join(dirname(fileURLToPath(import.meta.url)), "schema.sqlite.sql"), resolve(findWorkspaceRoot(), "apps/api/src/db/schema.sqlite.sql")];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0]!;
}

function iso(value: SqlValue | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Uint8Array) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function jsonValue<T>(value: SqlValue | undefined, fallback: T): T {
  if (value === null || value === undefined || value instanceof Uint8Array) return fallback;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return fallback;
}

function text(row: SqliteRow, key: string, fallback = ""): string {
  const value = row[key];
  if (value === null || value === undefined || value instanceof Uint8Array) return fallback;
  return String(value);
}

function nullableText(row: SqliteRow, key: string): string | null {
  const value = row[key];
  if (value === null || value === undefined || value instanceof Uint8Array) return null;
  return String(value);
}

function integer(row: SqliteRow, key: string): number {
  const value = row[key];
  return typeof value === "number" ? value : Number(value ?? 0);
}

function bool(row: SqliteRow, key: string): boolean {
  return integer(row, key) === 1;
}

function boolParam(value: boolean): number {
  return value ? 1 : 0;
}

function scholarshipAiModel(value: string): AppSettings["scholarshipCheckAiModel"] {
  return scholarshipAiModels.includes(value as AppSettings["scholarshipCheckAiModel"])
    ? (value as AppSettings["scholarshipCheckAiModel"])
    : scholarshipAiModels[0];
}

function rowToUser(row: SqliteRow): UserRecord {
  return {
    id: text(row, "id"),
    email: text(row, "email"),
    passwordHash: text(row, "password_hash"),
    role: text(row, "role"),
    createdAt: iso(row.created_at) ?? currentIso()
  };
}

function rowToSettings(row: SqliteRow | null, mailboxAddress: string): AppSettings {
  if (!row) return defaultSettings(mailboxAddress);
  return {
    mailboxAddress: text(row, "mailbox_address"),
    ownerEmails: jsonValue(row.owner_emails, {}),
    defaultManualEmail: text(row, "default_manual_email"),
    scholarshipCheckAiModel: scholarshipAiModel(text(row, "scholarship_check_ai_model", scholarshipAiModels[0])),
    roomAutoApproveEnabled: bool(row, "room_auto_approve_enabled"),
    knowledgeBaseEnabled: bool(row, "knowledge_base_enabled"),
    mailSyncEnabled: bool(row, "mail_sync_enabled"),
    roomRules: jsonValue(row.room_rules, {
      allowedRooms: [],
      maxParticipants: 30,
      allowedPurposes: []
    })
  };
}

function rowToMessage(row: SqliteRow): MailMessage {
  return {
    id: text(row, "id"),
    mailboxAddress: text(row, "mailbox_address"),
    graphMessageId: text(row, "graph_message_id"),
    internetMessageId: nullableText(row, "internet_message_id"),
    conversationId: nullableText(row, "conversation_id"),
    subject: text(row, "subject"),
    senderName: nullableText(row, "sender_name"),
    senderEmail: text(row, "sender_email"),
    toRecipients: jsonValue(row.to_recipients, []),
    ccRecipients: jsonValue(row.cc_recipients, []),
    receivedAt: iso(row.received_at) ?? currentIso(),
    bodyText: text(row, "body_text"),
    hasAttachments: bool(row, "has_attachments"),
    category: text(row, "category") as MailCategory,
    status: text(row, "status") as ProcessingStatus,
    needsReview: bool(row, "needs_review"),
    extracted: jsonValue(row.extracted, {}),
    overview: nullableText(row, "overview"),
    recommendation: nullableText(row, "recommendation"),
    error: nullableText(row, "error"),
    processedAt: iso(row.processed_at),
    createdAt: iso(row.created_at) ?? currentIso(),
    updatedAt: iso(row.updated_at) ?? currentIso()
  };
}

function rowToAttachment(row: SqliteRow): AttachmentRecord {
  return {
    id: text(row, "id"),
    messageId: text(row, "message_id"),
    graphAttachmentId: text(row, "graph_attachment_id"),
    name: text(row, "name"),
    contentType: text(row, "content_type"),
    size: integer(row, "size"),
    storagePath: text(row, "storage_path"),
    createdAt: iso(row.created_at) ?? currentIso()
  };
}

function rowToDraft(row: SqliteRow): ReplyDraft {
  return {
    id: text(row, "id"),
    messageId: text(row, "message_id"),
    toEmail: text(row, "to_email"),
    ccEmails: jsonValue(row.cc_emails, []),
    subject: text(row, "subject"),
    body: text(row, "body"),
    status: text(row, "status") as DraftStatus,
    createdByAi: bool(row, "created_by_ai"),
    sentAt: iso(row.sent_at),
    createdAt: iso(row.created_at) ?? currentIso(),
    updatedAt: iso(row.updated_at) ?? currentIso()
  };
}

function rowToForward(row: SqliteRow): ForwardRecord {
  return {
    id: text(row, "id"),
    messageId: text(row, "message_id"),
    toEmail: text(row, "to_email"),
    subject: text(row, "subject"),
    summary: text(row, "summary"),
    status: text(row, "status") as ForwardRecord["status"],
    error: nullableText(row, "error"),
    sentAt: iso(row.sent_at),
    createdAt: iso(row.created_at) ?? currentIso()
  };
}

function rowToKnowledge(row: SqliteRow): KnowledgeEntry {
  return {
    id: text(row, "id"),
    category: text(row, "category") as KnowledgeEntry["category"],
    question: text(row, "question"),
    answer: text(row, "answer"),
    enabled: bool(row, "enabled"),
    createdAt: iso(row.created_at) ?? currentIso(),
    updatedAt: iso(row.updated_at) ?? currentIso()
  };
}

function rowToCollegeKnowledgeDocument(row: SqliteRow): CollegeKnowledgeDocument {
  return {
    id: text(row, "id"),
    fileName: text(row, "file_name"),
    originalName: text(row, "original_name"),
    relativePath: nullableText(row, "relative_path"),
    contentType: nullableText(row, "content_type"),
    size: integer(row, "size"),
    sha256: text(row, "sha256"),
    status: text(row, "status") as CollegeKnowledgeDocument["status"],
    error: nullableText(row, "error"),
    warnings: jsonValue(row.warnings, []),
    storagePath: text(row, "storage_path"),
    extractedMarkdownPath: text(row, "extracted_markdown_path"),
    metadataPath: text(row, "metadata_path"),
    chunkCount: integer(row, "chunk_count"),
    createdAt: iso(row.created_at) ?? currentIso(),
    updatedAt: iso(row.updated_at) ?? currentIso()
  };
}

function rowToCollegeKnowledgeChunk(row: SqliteRow): CollegeKnowledgeChunkRecord {
  return {
    id: text(row, "id"),
    documentId: text(row, "document_id"),
    chunkIndex: integer(row, "chunk_index"),
    title: nullableText(row, "title"),
    locator: text(row, "locator"),
    sourcePath: nullableText(row, "source_path"),
    text: text(row, "text"),
    markdown: text(row, "markdown"),
    metadata: jsonValue(row.metadata, {}),
    tokenCount: integer(row, "token_count"),
    createdAt: iso(row.created_at) ?? currentIso(),
    updatedAt: iso(row.updated_at) ?? currentIso()
  };
}

export class SQLiteRepository implements AppRepository {
  private constructor(
    private readonly db: SqlJsDatabase,
    private readonly dbPath: string,
    private readonly initialMailbox: string
  ) {}

  static async open(dbPath: string, initialMailbox: string): Promise<SQLiteRepository> {
    const resolvedPath = resolveDbPath(dbPath);
    const SQL = await getSqlJs();
    const data = resolvedPath !== memoryPath && existsSync(resolvedPath) ? readFileSync(resolvedPath) : null;
    const db = data ? new SQL.Database(data) : new SQL.Database();
    db.run("pragma foreign_keys = on");
    return new SQLiteRepository(db, resolvedPath, initialMailbox);
  }

  async migrate(): Promise<void> {
    const sql = readFileSync(resolveSchemaPath(), "utf8");
    this.db.run(sql);
    this.addColumnIfMissing("app_settings", "scholarship_check_ai_model", `text not null default '${scholarshipAiModels[0]}'`);
    const settings = defaultSettings(this.initialMailbox);
    this.run(
      `insert into app_settings (
        id, mailbox_address, owner_emails, default_manual_email,
        scholarship_check_ai_model, room_auto_approve_enabled, knowledge_base_enabled, mail_sync_enabled, room_rules
      ) values (1, ?, ?, ?, ?, ?, ?, ?, ?)
      on conflict (id) do nothing`,
      [
        settings.mailboxAddress,
        JSON.stringify(settings.ownerEmails),
        settings.defaultManualEmail,
        settings.scholarshipCheckAiModel,
        boolParam(settings.roomAutoApproveEnabled),
        boolParam(settings.knowledgeBaseEnabled),
        boolParam(settings.mailSyncEnabled),
        JSON.stringify(settings.roomRules)
      ]
    );
  }

  async close(): Promise<void> {
    this.persist();
    this.db.close();
  }

  async ensureAdminUser(email: string, passwordHash: string): Promise<UserRecord> {
    const existing = await this.findUserByEmail(email);
    if (existing) return existing;
    return rowToUser(
      this.mutateOne(
        `insert into users (id, email, password_hash, role, created_at)
        values (?, ?, ?, 'admin', ?)
        returning *`,
        [randomUUID(), email, passwordHash, currentIso()]
      )
    );
  }

  async findUserByEmail(email: string): Promise<UserRecord | null> {
    const row = this.one(`select * from users where lower(email) = lower(?)`, [email]);
    return row ? rowToUser(row) : null;
  }

  async getSettings(): Promise<AppSettings> {
    return rowToSettings(this.one(`select * from app_settings where id = 1`), this.initialMailbox);
  }

  async saveSettings(settings: AppSettings): Promise<AppSettings> {
    const stamp = currentIso();
    return rowToSettings(
      this.mutateOne(
        `insert into app_settings (
          id, mailbox_address, owner_emails, default_manual_email,
          scholarship_check_ai_model, room_auto_approve_enabled, knowledge_base_enabled, mail_sync_enabled, room_rules, updated_at
        ) values (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        on conflict (id) do update set
          mailbox_address = excluded.mailbox_address,
          owner_emails = excluded.owner_emails,
          default_manual_email = excluded.default_manual_email,
          scholarship_check_ai_model = excluded.scholarship_check_ai_model,
          room_auto_approve_enabled = excluded.room_auto_approve_enabled,
          knowledge_base_enabled = excluded.knowledge_base_enabled,
          mail_sync_enabled = excluded.mail_sync_enabled,
          room_rules = excluded.room_rules,
          updated_at = excluded.updated_at
        returning *`,
        [
          settings.mailboxAddress,
          JSON.stringify(settings.ownerEmails),
          settings.defaultManualEmail,
          settings.scholarshipCheckAiModel,
          boolParam(settings.roomAutoApproveEnabled),
          boolParam(settings.knowledgeBaseEnabled),
          boolParam(settings.mailSyncEnabled),
          JSON.stringify(settings.roomRules),
          stamp
        ]
      ),
      this.initialMailbox
    );
  }

  async getSyncState(mailboxAddress: string): Promise<string | null> {
    const row = this.one(`select delta_link from sync_states where mailbox_address = ?`, [mailboxAddress]);
    return row ? nullableText(row, "delta_link") : null;
  }

  async setSyncState(mailboxAddress: string, deltaLink: string | null): Promise<void> {
    this.run(
      `insert into sync_states (mailbox_address, delta_link, updated_at) values (?, ?, ?)
      on conflict (mailbox_address) do update set delta_link = excluded.delta_link, updated_at = excluded.updated_at`,
      [mailboxAddress, deltaLink, currentIso()]
    );
  }

  async upsertMessage(input: MessageInput): Promise<MailMessage> {
    const stamp = currentIso();
    return rowToMessage(
      this.mutateOne(
        `insert into messages (
          id, mailbox_address, graph_message_id, internet_message_id, conversation_id,
          subject, sender_name, sender_email, to_recipients, cc_recipients,
          received_at, body_text, has_attachments, updated_at
        ) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        on conflict (mailbox_address, graph_message_id) do update set
          internet_message_id = excluded.internet_message_id,
          conversation_id = excluded.conversation_id,
          subject = excluded.subject,
          sender_name = excluded.sender_name,
          sender_email = excluded.sender_email,
          to_recipients = excluded.to_recipients,
          cc_recipients = excluded.cc_recipients,
          received_at = excluded.received_at,
          body_text = excluded.body_text,
          has_attachments = excluded.has_attachments,
          updated_at = excluded.updated_at
        returning *`,
        [
          randomUUID(),
          input.mailboxAddress,
          input.graphMessageId,
          input.internetMessageId,
          input.conversationId,
          input.subject,
          input.senderName,
          input.senderEmail,
          JSON.stringify(input.toRecipients),
          JSON.stringify(input.ccRecipients),
          input.receivedAt,
          input.bodyText,
          boolParam(input.hasAttachments),
          stamp
        ]
      )
    );
  }

  async updateMessageProcessing(id: string, patch: MessageProcessingPatch): Promise<MailMessage> {
    const assignments: string[] = ["updated_at = ?"];
    const values: SqlParam[] = [currentIso()];
    const push = (column: string, value: SqlParam) => {
      assignments.push(`${column} = ?`);
      values.push(value);
    };
    if ("category" in patch) push("category", patch.category ?? null);
    if ("status" in patch) push("status", patch.status ?? null);
    if ("needsReview" in patch) push("needs_review", patch.needsReview === undefined ? null : boolParam(patch.needsReview));
    if ("extracted" in patch) push("extracted", JSON.stringify(patch.extracted));
    if ("overview" in patch) push("overview", patch.overview ?? null);
    if ("recommendation" in patch) push("recommendation", patch.recommendation ?? null);
    if ("error" in patch) push("error", patch.error ?? null);
    if ("processedAt" in patch) push("processed_at", patch.processedAt ?? null);
    values.push(id);
    return rowToMessage(this.mutateOne(`update messages set ${assignments.join(", ")} where id = ? returning *`, values));
  }

  async getMessage(id: string): Promise<MailMessage | null> {
    const row = this.one(`select * from messages where id = ?`, [id]);
    return row ? rowToMessage(row) : null;
  }

  async listMessages(filters: MessageFilters): Promise<{ items: MailMessage[]; total: number }> {
    const clauses: string[] = [];
    const values: SqlParam[] = [];
    const add = (clause: string, value: SqlParam) => {
      clauses.push(clause);
      values.push(value);
    };
    if (filters.category) add("category = ?", filters.category);
    if (filters.status) add("status = ?", filters.status);
    if (filters.needsReview !== undefined) add("needs_review = ?", boolParam(filters.needsReview));
    if (filters.hasAttachments !== undefined) add("has_attachments = ?", boolParam(filters.hasAttachments));
    if (filters.from) add("received_at >= ?", filters.from);
    if (filters.to) add("received_at <= ?", filters.to);
    const where = clauses.length ? `where ${clauses.join(" and ")}` : "";
    const total = integer(this.one(`select count(*) as count from messages ${where}`, values) ?? {}, "count");
    const rows = this.all(`select * from messages ${where} order by received_at desc limit ? offset ?`, [
      ...values,
      filters.limit ?? 50,
      filters.offset ?? 0
    ]);
    return { items: rows.map(rowToMessage), total };
  }

  async addAttachment(input: Omit<AttachmentRecord, "id" | "createdAt">): Promise<AttachmentRecord> {
    return rowToAttachment(
      this.mutateOne(
        `insert into attachments (id, message_id, graph_attachment_id, name, content_type, size, storage_path)
        values (?,?,?,?,?,?,?)
        on conflict (message_id, graph_attachment_id) do update set
          name = excluded.name,
          content_type = excluded.content_type,
          size = excluded.size,
          storage_path = excluded.storage_path
        returning *`,
        [randomUUID(), input.messageId, input.graphAttachmentId, input.name, input.contentType, input.size, input.storagePath]
      )
    );
  }

  async listAttachments(messageId: string): Promise<AttachmentRecord[]> {
    return this.all(`select * from attachments where message_id = ? order by created_at asc`, [messageId]).map(rowToAttachment);
  }

  async createDraft(input: DraftInput): Promise<ReplyDraft> {
    const stamp = currentIso();
    return rowToDraft(
      this.mutateOne(
        `insert into reply_drafts (
          id, message_id, to_email, cc_emails, subject, body, status, created_by_ai, created_at, updated_at
        ) values (?,?,?,?,?,?,?,?,?,?)
        returning *`,
        [
          randomUUID(),
          input.messageId,
          input.toEmail,
          JSON.stringify(input.ccEmails),
          input.subject,
          input.body,
          input.status ?? "draft",
          boolParam(input.createdByAi ?? true),
          stamp,
          stamp
        ]
      )
    );
  }

  async getDraft(id: string): Promise<ReplyDraft | null> {
    const row = this.one(`select * from reply_drafts where id = ?`, [id]);
    return row ? rowToDraft(row) : null;
  }

  async getDraftForMessage(messageId: string): Promise<ReplyDraft | null> {
    const row = this.one(`select * from reply_drafts where message_id = ? order by created_at desc limit 1`, [messageId]);
    return row ? rowToDraft(row) : null;
  }

  async listDrafts(status?: DraftStatus): Promise<ReplyDraft[]> {
    const rows = status
      ? this.all(`select * from reply_drafts where status = ? order by updated_at desc`, [status])
      : this.all(`select * from reply_drafts order by updated_at desc`);
    return rows.map(rowToDraft);
  }

  async updateDraft(id: string, patch: { body?: string; status?: DraftStatus; sentAt?: string | null }): Promise<ReplyDraft> {
    const assignments: string[] = ["updated_at = ?"];
    const values: SqlParam[] = [currentIso()];
    const push = (column: string, value: SqlParam) => {
      assignments.push(`${column} = ?`);
      values.push(value);
    };
    if ("body" in patch) push("body", patch.body ?? null);
    if ("status" in patch) push("status", patch.status ?? null);
    if ("sentAt" in patch) push("sent_at", patch.sentAt ?? null);
    values.push(id);
    return rowToDraft(this.mutateOne(`update reply_drafts set ${assignments.join(", ")} where id = ? returning *`, values));
  }

  async createForwardRecord(input: ForwardInput): Promise<ForwardRecord> {
    return rowToForward(
      this.mutateOne(
        `insert into forward_records (id, message_id, to_email, subject, summary, status, error, sent_at)
        values (?,?,?,?,?,?,?,?) returning *`,
        [randomUUID(), input.messageId, input.toEmail, input.subject, input.summary, input.status, input.error, input.sentAt]
      )
    );
  }

  async listForwardRecords(): Promise<ForwardRecord[]> {
    return this.all(`select * from forward_records order by created_at desc limit 200`).map(rowToForward);
  }

  async createSendLog(input: SendLogInput): Promise<void> {
    this.run(
      `insert into send_logs (id, message_id, draft_id, kind, to_email, subject, status, error, sent_at)
      values (?,?,?,?,?,?,?,?,?)`,
      [randomUUID(), input.messageId, input.draftId, input.kind, input.toEmail, input.subject, input.status, input.error, input.sentAt]
    );
  }

  async addAudit(input: AuditInput): Promise<void> {
    this.run(`insert into audit_logs (id, message_id, actor, action, detail) values (?,?,?,?,?)`, [
      randomUUID(),
      input.messageId,
      input.actor,
      input.action,
      JSON.stringify(input.detail)
    ]);
  }

  async listAuditLogs(messageId: string): Promise<import("./repository.js").AuditRecord[]> {
    return this.all(`select * from audit_logs where message_id = ? order by created_at desc`, [messageId]).map((row) => ({
      id: text(row, "id"),
      messageId: nullableText(row, "message_id"),
      actor: text(row, "actor"),
      action: text(row, "action"),
      detail: jsonValue(row.detail, {}),
      createdAt: iso(row.created_at) ?? currentIso()
    }));
  }

  async listKnowledgeEntries(category?: KnowledgeEntry["category"]): Promise<KnowledgeEntry[]> {
    const rows = category
      ? this.all(`select * from knowledge_entries where category = ? order by updated_at desc`, [category])
      : this.all(`select * from knowledge_entries order by updated_at desc`);
    return rows.map(rowToKnowledge);
  }

  async upsertKnowledgeEntry(input: Omit<KnowledgeEntry, "createdAt" | "updatedAt">): Promise<KnowledgeEntry> {
    return rowToKnowledge(
      this.mutateOne(
        `insert into knowledge_entries (id, category, question, answer, enabled, updated_at)
        values (?,?,?,?,?,?)
        on conflict (id) do update set
          category = excluded.category,
          question = excluded.question,
          answer = excluded.answer,
          enabled = excluded.enabled,
          updated_at = excluded.updated_at
        returning *`,
        [input.id, input.category, input.question, input.answer, boolParam(input.enabled), currentIso()]
      )
    );
  }

  async upsertCollegeKnowledgeDocument(input: CollegeKnowledgeDocumentInput): Promise<CollegeKnowledgeDocument> {
    return rowToCollegeKnowledgeDocument(
      this.mutateOne(
        `insert into college_knowledge_documents (
          id, file_name, original_name, relative_path, content_type, size, sha256, status, error,
          warnings, storage_path, extracted_markdown_path, metadata_path, chunk_count, updated_at
        ) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        on conflict (id) do update set
          file_name = excluded.file_name,
          original_name = excluded.original_name,
          relative_path = excluded.relative_path,
          content_type = excluded.content_type,
          size = excluded.size,
          sha256 = excluded.sha256,
          status = excluded.status,
          error = excluded.error,
          warnings = excluded.warnings,
          storage_path = excluded.storage_path,
          extracted_markdown_path = excluded.extracted_markdown_path,
          metadata_path = excluded.metadata_path,
          chunk_count = excluded.chunk_count,
          updated_at = excluded.updated_at
        returning *`,
        [
          input.id,
          input.fileName,
          input.originalName,
          input.relativePath,
          input.contentType,
          input.size,
          input.sha256,
          input.status,
          input.error,
          JSON.stringify(input.warnings),
          input.storagePath,
          input.extractedMarkdownPath,
          input.metadataPath,
          input.chunkCount,
          currentIso()
        ]
      )
    );
  }

  async updateCollegeKnowledgeDocument(id: string, patch: CollegeKnowledgeDocumentPatch): Promise<CollegeKnowledgeDocument> {
    const assignments: string[] = ["updated_at = ?"];
    const values: SqlParam[] = [currentIso()];
    const push = (column: string, value: SqlParam) => {
      assignments.push(`${column} = ?`);
      values.push(value);
    };
    if ("fileName" in patch) push("file_name", patch.fileName ?? null);
    if ("originalName" in patch) push("original_name", patch.originalName ?? null);
    if ("relativePath" in patch) push("relative_path", patch.relativePath ?? null);
    if ("contentType" in patch) push("content_type", patch.contentType ?? null);
    if ("size" in patch) push("size", patch.size ?? null);
    if ("sha256" in patch) push("sha256", patch.sha256 ?? null);
    if ("status" in patch) push("status", patch.status ?? null);
    if ("error" in patch) push("error", patch.error ?? null);
    if ("warnings" in patch) push("warnings", JSON.stringify(patch.warnings ?? []));
    if ("storagePath" in patch) push("storage_path", patch.storagePath ?? null);
    if ("extractedMarkdownPath" in patch) push("extracted_markdown_path", patch.extractedMarkdownPath ?? null);
    if ("metadataPath" in patch) push("metadata_path", patch.metadataPath ?? null);
    if ("chunkCount" in patch) push("chunk_count", patch.chunkCount ?? null);
    values.push(id);
    return rowToCollegeKnowledgeDocument(this.mutateOne(`update college_knowledge_documents set ${assignments.join(", ")} where id = ? returning *`, values));
  }

  async getCollegeKnowledgeDocument(id: string): Promise<CollegeKnowledgeDocument | null> {
    const row = this.one(`select * from college_knowledge_documents where id = ?`, [id]);
    return row ? rowToCollegeKnowledgeDocument(row) : null;
  }

  async getCollegeKnowledgeDocumentBySha256(sha256: string): Promise<CollegeKnowledgeDocument | null> {
    const row = this.one(`select * from college_knowledge_documents where sha256 = ?`, [sha256]);
    return row ? rowToCollegeKnowledgeDocument(row) : null;
  }

  async listCollegeKnowledgeDocuments(): Promise<CollegeKnowledgeDocument[]> {
    return this.all(`select * from college_knowledge_documents order by updated_at desc`).map(rowToCollegeKnowledgeDocument);
  }

  async replaceCollegeKnowledgeChunks(documentId: string, chunks: CollegeKnowledgeChunkInput[]): Promise<void> {
    this.run(`delete from college_knowledge_chunks where document_id = ?`, [documentId]);
    for (const chunk of chunks) {
      this.run(
        `insert into college_knowledge_chunks (
          id, document_id, chunk_index, title, locator, source_path, text, markdown, metadata, token_count, updated_at
        ) values (?,?,?,?,?,?,?,?,?,?,?)`,
        [
          chunk.id,
          chunk.documentId,
          chunk.chunkIndex,
          chunk.title,
          chunk.locator,
          chunk.sourcePath,
          chunk.text,
          chunk.markdown,
          JSON.stringify(chunk.metadata),
          chunk.tokenCount,
          currentIso()
        ]
      );
    }
  }

  async listCollegeKnowledgeChunks(documentId?: string): Promise<CollegeKnowledgeChunkRecord[]> {
    const rows = documentId
      ? this.all(`select * from college_knowledge_chunks where document_id = ? order by chunk_index asc`, [documentId])
      : this.all(`select * from college_knowledge_chunks order by document_id asc, chunk_index asc`);
    return rows.map(rowToCollegeKnowledgeChunk);
  }

  async deleteCollegeKnowledgeDocument(id: string): Promise<boolean> {
    const existing = await this.getCollegeKnowledgeDocument(id);
    if (!existing) return false;
    this.run(`delete from college_knowledge_documents where id = ?`, [id]);
    return true;
  }

  async dashboard(nowIso: string): Promise<{
    pendingMessages: number;
    pendingDrafts: number;
    processedToday: number;
    autoApprovedToday: number;
    failedMessages: number;
    recentMessages: MailMessage[];
  }> {
    const startOfDay = new Date(nowIso);
    startOfDay.setHours(0, 0, 0, 0);
    return {
      pendingMessages: this.count(`select count(*) as count from messages where status in ('new','processing','manual_required','awaiting_review')`),
      pendingDrafts: this.count(`select count(*) as count from reply_drafts where status in ('draft','saved','manual_required')`),
      processedToday: this.count(`select count(*) as count from messages where processed_at >= ?`, [startOfDay.toISOString()]),
      autoApprovedToday: this.count(`select count(*) as count from messages where status = 'auto_approved' and processed_at >= ?`, [
        startOfDay.toISOString()
      ]),
      failedMessages: this.count(`select count(*) as count from messages where status = 'failed'`),
      recentMessages: this.all(`select * from messages order by received_at desc limit 8`).map(rowToMessage)
    };
  }

  private run(sql: string, params: SqlParam[] = []): void {
    this.db.run(sql, params);
    this.persist();
  }

  private mutateOne(sql: string, params: SqlParam[]): SqliteRow {
    const row = this.one(sql, params);
    this.persist();
    if (!row) throw new Error("SQLite mutation returned no rows");
    return row;
  }

  private one(sql: string, params: SqlParam[] = []): SqliteRow | null {
    return this.all(sql, params)[0] ?? null;
  }

  private all(sql: string, params: SqlParam[] = []): SqliteRow[] {
    const result = this.db.exec(sql, params)[0];
    if (!result) return [];
    return result.values.map((values) => {
      const row: SqliteRow = {};
      result.columns.forEach((column, index) => {
        row[column] = values[index];
      });
      return row;
    });
  }

  private count(sql: string, params: SqlParam[] = []): number {
    return integer(this.one(sql, params) ?? {}, "count");
  }

  private addColumnIfMissing(table: string, column: string, definition: string): void {
    try {
      this.db.run(`alter table ${table} add column ${column} ${definition}`);
    } catch (error) {
      if (!String(error).toLowerCase().includes("duplicate column")) throw error;
    }
  }

  private persist(): void {
    if (this.dbPath === memoryPath) return;
    mkdirSync(dirname(this.dbPath), { recursive: true });
    const tempPath = `${this.dbPath}.tmp`;
    writeFileSync(tempPath, Buffer.from(this.db.export()));
    renameSync(tempPath, this.dbPath);
  }
}
