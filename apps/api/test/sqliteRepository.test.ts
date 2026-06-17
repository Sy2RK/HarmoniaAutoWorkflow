import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { defaultSettings } from "../src/config/defaults.js";
import { SQLiteRepository } from "../src/db/sqlite.js";

async function withRepository<T>(run: (repo: SQLiteRepository, dbPath: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "harmonia-sqlite-"));
  const dbPath = join(dir, "harmonia.sqlite");
  const repo = await SQLiteRepository.open(dbPath, "public@example.edu.cn");
  try {
    await repo.migrate();
    return await run(repo, dbPath);
  } finally {
    await repo.close();
    await rm(dir, { recursive: true, force: true });
  }
}

describe("SQLiteRepository", () => {
  it("implements the repository contract and persists data to disk", async () => {
    await withRepository(async (repo, dbPath) => {
      const admin = await repo.ensureAdminUser("admin@example.edu.cn", "hash");
      expect(admin.email).toBe("admin@example.edu.cn");
      expect(await repo.findUserByEmail("ADMIN@example.edu.cn")).toMatchObject({ id: admin.id });

      const settings = await repo.saveSettings({
        ...defaultSettings("public@example.edu.cn"),
        defaultManualEmail: "manual@example.edu.cn",
        mailSyncEnabled: true,
        ownerEmails: { room_usage: "room@example.edu.cn" }
      });
      expect(settings.defaultManualEmail).toBe("manual@example.edu.cn");

      await repo.setSyncState("public@example.edu.cn", "delta-1");
      expect(await repo.getSyncState("public@example.edu.cn")).toBe("delta-1");

      const message = await repo.upsertMessage({
        mailboxAddress: "public@example.edu.cn",
        graphMessageId: "graph-1",
        internetMessageId: "<m1>",
        conversationId: "c1",
        subject: "Room request",
        senderName: "Student",
        senderEmail: "student@example.com",
        toRecipients: ["public@example.edu.cn"],
        ccRecipients: ["cc@example.edu.cn"],
        receivedAt: "2026-06-03T08:00:00.000Z",
        bodyText: "Need a room",
        hasAttachments: true
      });
      await repo.updateMessageProcessing(message.id, {
        category: "room_usage",
        status: "awaiting_review",
        needsReview: true,
        extracted: { room: "A101" },
        overview: "Room usage request",
        recommendation: "Review",
        processedAt: "2026-06-03T09:00:00.000Z"
      });
      await repo.addAttachment({
        messageId: message.id,
        graphAttachmentId: "att-1",
        name: "request.pdf",
        contentType: "application/pdf",
        size: 12,
        storagePath: "storage/attachments/request.pdf"
      });
      const draft = await repo.createDraft({
        messageId: message.id,
        toEmail: "student@example.com",
        ccEmails: ["cc@example.edu.cn"],
        subject: "Re: Room request",
        body: "Draft body"
      });
      await repo.updateDraft(draft.id, { status: "saved", body: "Updated body" });
      await repo.createForwardRecord({
        messageId: message.id,
        toEmail: "room@example.edu.cn",
        subject: "Forward: Room request",
        summary: "Summary",
        status: "sent",
        error: null,
        sentAt: "2026-06-03T10:00:00.000Z"
      });
      await repo.createSendLog({
        messageId: message.id,
        draftId: draft.id,
        kind: "reply",
        toEmail: "student@example.com",
        subject: "Re: Room request",
        status: "skipped",
        error: "disabled",
        sentAt: null
      });
      await repo.upsertKnowledgeEntry({
        id: "kb-1",
        category: "party_consultation",
        question: "How to transfer party membership?",
        answer: "Follow the college notice.",
        enabled: true
      });
      await repo.addAudit({
        messageId: message.id,
        actor: "admin@example.edu.cn",
        action: "checked",
        detail: { draftId: draft.id }
      });

      const listed = await repo.listMessages({ category: "room_usage", hasAttachments: true });
      expect(listed.total).toBe(1);
      expect((await repo.listAttachments(message.id))[0]).toMatchObject({ name: "request.pdf" });
      expect((await repo.getDraftForMessage(message.id))?.body).toBe("Updated body");
      expect(await repo.listForwardRecords()).toHaveLength(1);
      expect(await repo.listKnowledgeEntries("party_consultation")).toHaveLength(1);
      expect((await repo.listAuditLogs(message.id))[0]?.detail).toMatchObject({ draftId: draft.id });
      await expect(repo.dashboard("2026-06-03T12:00:00.000Z")).resolves.toMatchObject({
        pendingMessages: 1,
        pendingDrafts: 1,
        processedToday: 1
      });

      const reopened = await SQLiteRepository.open(dbPath, "public@example.edu.cn");
      try {
        await reopened.migrate();
        expect((await reopened.getSettings()).defaultManualEmail).toBe("manual@example.edu.cn");
        expect(await reopened.getMessage(message.id)).toMatchObject({
          id: message.id,
          category: "room_usage",
          overview: "Room usage request"
        });
      } finally {
        await reopened.close();
      }
    });
  });
});
