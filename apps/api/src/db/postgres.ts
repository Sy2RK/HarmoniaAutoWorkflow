import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool, type QueryResultRow } from "pg";
import type {
  AppSettings,
  AttachmentRecord,
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
  DraftInput,
  ForwardInput,
  MessageFilters,
  MessageInput,
  MessageProcessingPatch,
  SendLogInput,
  UserRecord
} from "./repository.js";

const schemaPath = join(dirname(fileURLToPath(import.meta.url)), "schema.sql");

function iso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function jsonValue<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
}

function rowToUser(row: QueryResultRow): UserRecord {
  return {
    id: String(row.id),
    email: String(row.email),
    passwordHash: String(row.password_hash),
    role: String(row.role),
    createdAt: iso(row.created_at) ?? new Date().toISOString()
  };
}

function rowToSettings(row: QueryResultRow | null, mailboxAddress: string): AppSettings {
  if (!row) return defaultSettings(mailboxAddress);
  return {
    mailboxAddress: String(row.mailbox_address),
    ownerEmails: jsonValue(row.owner_emails, {}),
    defaultManualEmail: String(row.default_manual_email),
    roomAutoApproveEnabled: Boolean(row.room_auto_approve_enabled),
    knowledgeBaseEnabled: Boolean(row.knowledge_base_enabled),
    mailSyncEnabled: Boolean(row.mail_sync_enabled),
    roomRules: jsonValue(row.room_rules, {
      allowedRooms: [],
      maxParticipants: 30,
      allowedPurposes: []
    })
  };
}

function rowToMessage(row: QueryResultRow): MailMessage {
  return {
    id: String(row.id),
    mailboxAddress: String(row.mailbox_address),
    graphMessageId: String(row.graph_message_id),
    internetMessageId: row.internet_message_id ? String(row.internet_message_id) : null,
    conversationId: row.conversation_id ? String(row.conversation_id) : null,
    subject: String(row.subject),
    senderName: row.sender_name ? String(row.sender_name) : null,
    senderEmail: String(row.sender_email),
    toRecipients: jsonValue(row.to_recipients, []),
    ccRecipients: jsonValue(row.cc_recipients, []),
    receivedAt: iso(row.received_at) ?? new Date().toISOString(),
    bodyText: String(row.body_text ?? ""),
    hasAttachments: Boolean(row.has_attachments),
    category: String(row.category) as MailCategory,
    status: String(row.status) as ProcessingStatus,
    needsReview: Boolean(row.needs_review),
    extracted: jsonValue(row.extracted, {}),
    overview: row.overview ? String(row.overview) : null,
    recommendation: row.recommendation ? String(row.recommendation) : null,
    error: row.error ? String(row.error) : null,
    processedAt: iso(row.processed_at),
    createdAt: iso(row.created_at) ?? new Date().toISOString(),
    updatedAt: iso(row.updated_at) ?? new Date().toISOString()
  };
}

function rowToAttachment(row: QueryResultRow): AttachmentRecord {
  return {
    id: String(row.id),
    messageId: String(row.message_id),
    graphAttachmentId: String(row.graph_attachment_id),
    name: String(row.name),
    contentType: String(row.content_type),
    size: Number(row.size),
    storagePath: String(row.storage_path),
    createdAt: iso(row.created_at) ?? new Date().toISOString()
  };
}

function rowToDraft(row: QueryResultRow): ReplyDraft {
  return {
    id: String(row.id),
    messageId: String(row.message_id),
    toEmail: String(row.to_email),
    ccEmails: jsonValue(row.cc_emails, []),
    subject: String(row.subject),
    body: String(row.body),
    status: String(row.status) as DraftStatus,
    createdByAi: Boolean(row.created_by_ai),
    sentAt: iso(row.sent_at),
    createdAt: iso(row.created_at) ?? new Date().toISOString(),
    updatedAt: iso(row.updated_at) ?? new Date().toISOString()
  };
}

function rowToForward(row: QueryResultRow): ForwardRecord {
  return {
    id: String(row.id),
    messageId: String(row.message_id),
    toEmail: String(row.to_email),
    subject: String(row.subject),
    summary: String(row.summary),
    status: String(row.status) as ForwardRecord["status"],
    error: row.error ? String(row.error) : null,
    sentAt: iso(row.sent_at),
    createdAt: iso(row.created_at) ?? new Date().toISOString()
  };
}

function rowToKnowledge(row: QueryResultRow): KnowledgeEntry {
  return {
    id: String(row.id),
    category: String(row.category) as KnowledgeEntry["category"],
    question: String(row.question),
    answer: String(row.answer),
    enabled: Boolean(row.enabled),
    createdAt: iso(row.created_at) ?? new Date().toISOString(),
    updatedAt: iso(row.updated_at) ?? new Date().toISOString()
  };
}

export class PostgresRepository implements AppRepository {
  private readonly pool: Pool;
  private readonly initialMailbox: string;

  constructor(databaseUrl: string, initialMailbox: string) {
    this.pool = new Pool({ connectionString: databaseUrl });
    this.initialMailbox = initialMailbox;
  }

  async migrate(): Promise<void> {
    const sql = await readFile(schemaPath, "utf8");
    await this.pool.query(sql);
    const settings = defaultSettings(this.initialMailbox);
    await this.pool.query(
      `insert into app_settings (
        id, mailbox_address, owner_emails, default_manual_email,
        room_auto_approve_enabled, knowledge_base_enabled, mail_sync_enabled, room_rules
      ) values (1, $1, $2, $3, $4, $5, $6, $7)
      on conflict (id) do nothing`,
      [
        settings.mailboxAddress,
        JSON.stringify(settings.ownerEmails),
        settings.defaultManualEmail,
        settings.roomAutoApproveEnabled,
        settings.knowledgeBaseEnabled,
        settings.mailSyncEnabled,
        JSON.stringify(settings.roomRules)
      ]
    );
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async ensureAdminUser(email: string, passwordHash: string): Promise<UserRecord> {
    const existing = await this.findUserByEmail(email);
    if (existing) return existing;
    const result = await this.pool.query(
      `insert into users (id, email, password_hash, role) values ($1, $2, $3, 'admin') returning *`,
      [randomUUID(), email, passwordHash]
    );
    return rowToUser(result.rows[0]);
  }

  async findUserByEmail(email: string): Promise<UserRecord | null> {
    const result = await this.pool.query(`select * from users where lower(email) = lower($1)`, [email]);
    return result.rowCount ? rowToUser(result.rows[0]) : null;
  }

  async getSettings(): Promise<AppSettings> {
    const result = await this.pool.query(`select * from app_settings where id = 1`);
    return rowToSettings(result.rowCount ? result.rows[0] : null, this.initialMailbox);
  }

  async saveSettings(settings: AppSettings): Promise<AppSettings> {
    const result = await this.pool.query(
      `insert into app_settings (
        id, mailbox_address, owner_emails, default_manual_email,
        room_auto_approve_enabled, knowledge_base_enabled, mail_sync_enabled, room_rules, updated_at
      ) values (1, $1, $2, $3, $4, $5, $6, $7, now())
      on conflict (id) do update set
        mailbox_address = excluded.mailbox_address,
        owner_emails = excluded.owner_emails,
        default_manual_email = excluded.default_manual_email,
        room_auto_approve_enabled = excluded.room_auto_approve_enabled,
        knowledge_base_enabled = excluded.knowledge_base_enabled,
        mail_sync_enabled = excluded.mail_sync_enabled,
        room_rules = excluded.room_rules,
        updated_at = now()
      returning *`,
      [
        settings.mailboxAddress,
        JSON.stringify(settings.ownerEmails),
        settings.defaultManualEmail,
        settings.roomAutoApproveEnabled,
        settings.knowledgeBaseEnabled,
        settings.mailSyncEnabled,
        JSON.stringify(settings.roomRules)
      ]
    );
    return rowToSettings(result.rows[0], this.initialMailbox);
  }

  async getSyncState(mailboxAddress: string): Promise<string | null> {
    const result = await this.pool.query(`select delta_link from sync_states where mailbox_address = $1`, [mailboxAddress]);
    return result.rowCount ? String(result.rows[0].delta_link ?? "") || null : null;
  }

  async setSyncState(mailboxAddress: string, deltaLink: string | null): Promise<void> {
    await this.pool.query(
      `insert into sync_states (mailbox_address, delta_link, updated_at) values ($1, $2, now())
      on conflict (mailbox_address) do update set delta_link = excluded.delta_link, updated_at = now()`,
      [mailboxAddress, deltaLink]
    );
  }

  async upsertMessage(input: MessageInput): Promise<MailMessage> {
    const result = await this.pool.query(
      `insert into messages (
        id, mailbox_address, graph_message_id, internet_message_id, conversation_id,
        subject, sender_name, sender_email, to_recipients, cc_recipients,
        received_at, body_text, has_attachments, updated_at
      ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,now())
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
        updated_at = now()
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
        input.hasAttachments
      ]
    );
    return rowToMessage(result.rows[0]);
  }

  async updateMessageProcessing(id: string, patch: MessageProcessingPatch): Promise<MailMessage> {
    const assignments: string[] = ["updated_at = now()"];
    const values: unknown[] = [];
    const push = (column: string, value: unknown) => {
      values.push(value);
      assignments.push(`${column} = $${values.length}`);
    };
    if ("category" in patch) push("category", patch.category);
    if ("status" in patch) push("status", patch.status);
    if ("needsReview" in patch) push("needs_review", patch.needsReview);
    if ("extracted" in patch) push("extracted", JSON.stringify(patch.extracted));
    if ("overview" in patch) push("overview", patch.overview);
    if ("recommendation" in patch) push("recommendation", patch.recommendation);
    if ("error" in patch) push("error", patch.error);
    if ("processedAt" in patch) push("processed_at", patch.processedAt);
    values.push(id);
    const result = await this.pool.query(`update messages set ${assignments.join(", ")} where id = $${values.length} returning *`, values);
    return rowToMessage(result.rows[0]);
  }

  async getMessage(id: string): Promise<MailMessage | null> {
    const result = await this.pool.query(`select * from messages where id = $1`, [id]);
    return result.rowCount ? rowToMessage(result.rows[0]) : null;
  }

  async listMessages(filters: MessageFilters): Promise<{ items: MailMessage[]; total: number }> {
    const clauses: string[] = [];
    const values: unknown[] = [];
    const add = (clause: string, value: unknown) => {
      values.push(value);
      clauses.push(clause.replace("?", `$${values.length}`));
    };
    if (filters.category) add("category = ?", filters.category);
    if (filters.status) add("status = ?", filters.status);
    if (filters.needsReview !== undefined) add("needs_review = ?", filters.needsReview);
    if (filters.hasAttachments !== undefined) add("has_attachments = ?", filters.hasAttachments);
    if (filters.from) add("received_at >= ?", filters.from);
    if (filters.to) add("received_at <= ?", filters.to);
    const where = clauses.length ? `where ${clauses.join(" and ")}` : "";
    const totalResult = await this.pool.query(`select count(*)::int as count from messages ${where}`, values);
    const count = Number(totalResult.rows[0].count);
    values.push(filters.limit ?? 50);
    values.push(filters.offset ?? 0);
    const result = await this.pool.query(
      `select * from messages ${where} order by received_at desc limit $${values.length - 1} offset $${values.length}`,
      values
    );
    return { items: result.rows.map(rowToMessage), total: count };
  }

  async addAttachment(input: Omit<AttachmentRecord, "id" | "createdAt">): Promise<AttachmentRecord> {
    const result = await this.pool.query(
      `insert into attachments (id, message_id, graph_attachment_id, name, content_type, size, storage_path)
      values ($1,$2,$3,$4,$5,$6,$7)
      on conflict (message_id, graph_attachment_id) do update set
        name = excluded.name,
        content_type = excluded.content_type,
        size = excluded.size,
        storage_path = excluded.storage_path
      returning *`,
      [randomUUID(), input.messageId, input.graphAttachmentId, input.name, input.contentType, input.size, input.storagePath]
    );
    return rowToAttachment(result.rows[0]);
  }

  async listAttachments(messageId: string): Promise<AttachmentRecord[]> {
    const result = await this.pool.query(`select * from attachments where message_id = $1 order by created_at asc`, [messageId]);
    return result.rows.map(rowToAttachment);
  }

  async createDraft(input: DraftInput): Promise<ReplyDraft> {
    const result = await this.pool.query(
      `insert into reply_drafts (id, message_id, to_email, cc_emails, subject, body, status, created_by_ai)
      values ($1,$2,$3,$4,$5,$6,$7,$8)
      returning *`,
      [
        randomUUID(),
        input.messageId,
        input.toEmail,
        JSON.stringify(input.ccEmails),
        input.subject,
        input.body,
        input.status ?? "draft",
        input.createdByAi ?? true
      ]
    );
    return rowToDraft(result.rows[0]);
  }

  async getDraft(id: string): Promise<ReplyDraft | null> {
    const result = await this.pool.query(`select * from reply_drafts where id = $1`, [id]);
    return result.rowCount ? rowToDraft(result.rows[0]) : null;
  }

  async getDraftForMessage(messageId: string): Promise<ReplyDraft | null> {
    const result = await this.pool.query(`select * from reply_drafts where message_id = $1 order by created_at desc limit 1`, [messageId]);
    return result.rowCount ? rowToDraft(result.rows[0]) : null;
  }

  async listDrafts(status?: DraftStatus): Promise<ReplyDraft[]> {
    const result = status
      ? await this.pool.query(`select * from reply_drafts where status = $1 order by updated_at desc`, [status])
      : await this.pool.query(`select * from reply_drafts order by updated_at desc`);
    return result.rows.map(rowToDraft);
  }

  async updateDraft(id: string, patch: { body?: string; status?: DraftStatus; sentAt?: string | null }): Promise<ReplyDraft> {
    const assignments: string[] = ["updated_at = now()"];
    const values: unknown[] = [];
    const push = (column: string, value: unknown) => {
      values.push(value);
      assignments.push(`${column} = $${values.length}`);
    };
    if ("body" in patch) push("body", patch.body);
    if ("status" in patch) push("status", patch.status);
    if ("sentAt" in patch) push("sent_at", patch.sentAt);
    values.push(id);
    const result = await this.pool.query(`update reply_drafts set ${assignments.join(", ")} where id = $${values.length} returning *`, values);
    return rowToDraft(result.rows[0]);
  }

  async createForwardRecord(input: ForwardInput): Promise<ForwardRecord> {
    const result = await this.pool.query(
      `insert into forward_records (id, message_id, to_email, subject, summary, status, error, sent_at)
      values ($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
      [randomUUID(), input.messageId, input.toEmail, input.subject, input.summary, input.status, input.error, input.sentAt]
    );
    return rowToForward(result.rows[0]);
  }

  async listForwardRecords(): Promise<ForwardRecord[]> {
    const result = await this.pool.query(`select * from forward_records order by created_at desc limit 200`);
    return result.rows.map(rowToForward);
  }

  async createSendLog(input: SendLogInput): Promise<void> {
    await this.pool.query(
      `insert into send_logs (id, message_id, draft_id, kind, to_email, subject, status, error, sent_at)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [randomUUID(), input.messageId, input.draftId, input.kind, input.toEmail, input.subject, input.status, input.error, input.sentAt]
    );
  }

  async addAudit(input: AuditInput): Promise<void> {
    await this.pool.query(
      `insert into audit_logs (id, message_id, actor, action, detail) values ($1,$2,$3,$4,$5)`,
      [randomUUID(), input.messageId, input.actor, input.action, JSON.stringify(input.detail)]
    );
  }

  async listAuditLogs(messageId: string): Promise<import("./repository.js").AuditRecord[]> {
    const result = await this.pool.query(`select * from audit_logs where message_id = $1 order by created_at desc`, [messageId]);
    return result.rows.map((row) => ({
      id: String(row.id),
      messageId: row.message_id ? String(row.message_id) : null,
      actor: String(row.actor),
      action: String(row.action),
      detail: jsonValue(row.detail, {}),
      createdAt: iso(row.created_at) ?? new Date().toISOString()
    }));
  }

  async listKnowledgeEntries(category?: KnowledgeEntry["category"]): Promise<KnowledgeEntry[]> {
    const result = category
      ? await this.pool.query(`select * from knowledge_entries where category = $1 order by updated_at desc`, [category])
      : await this.pool.query(`select * from knowledge_entries order by updated_at desc`);
    return result.rows.map(rowToKnowledge);
  }

  async upsertKnowledgeEntry(input: Omit<KnowledgeEntry, "createdAt" | "updatedAt">): Promise<KnowledgeEntry> {
    const result = await this.pool.query(
      `insert into knowledge_entries (id, category, question, answer, enabled, updated_at)
      values ($1,$2,$3,$4,$5,now())
      on conflict (id) do update set
        category = excluded.category,
        question = excluded.question,
        answer = excluded.answer,
        enabled = excluded.enabled,
        updated_at = now()
      returning *`,
      [input.id, input.category, input.question, input.answer, input.enabled]
    );
    return rowToKnowledge(result.rows[0]);
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
    const [pendingMessages, pendingDrafts, processedToday, autoApprovedToday, failedMessages, recentMessages] = await Promise.all([
      this.pool.query(`select count(*)::int as count from messages where status in ('new','processing','manual_required','awaiting_review')`),
      this.pool.query(`select count(*)::int as count from reply_drafts where status in ('draft','saved','manual_required')`),
      this.pool.query(`select count(*)::int as count from messages where processed_at >= $1`, [startOfDay.toISOString()]),
      this.pool.query(`select count(*)::int as count from messages where status = 'auto_approved' and processed_at >= $1`, [startOfDay.toISOString()]),
      this.pool.query(`select count(*)::int as count from messages where status = 'failed'`),
      this.pool.query(`select * from messages order by received_at desc limit 8`)
    ]);
    return {
      pendingMessages: Number(pendingMessages.rows[0].count),
      pendingDrafts: Number(pendingDrafts.rows[0].count),
      processedToday: Number(processedToday.rows[0].count),
      autoApprovedToday: Number(autoApprovedToday.rows[0].count),
      failedMessages: Number(failedMessages.rows[0].count),
      recentMessages: recentMessages.rows.map(rowToMessage)
    };
  }
}
