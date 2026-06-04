import { describe, expect, it } from "vitest";
import { NoopAiClient } from "../src/ai/client.js";
import { defaultSettings } from "../src/config/defaults.js";
import { InMemoryRepository } from "../src/db/memory.js";
import type { GraphMailClient } from "../src/graph/client.js";
import type { OutboundMailer } from "../src/mail/outbound.js";
import { syncMailbox } from "../src/worker/sync.js";

const mailer: OutboundMailer = {
  async send() {
    return { status: "sent", error: null, sentAt: "2026-06-03T00:00:00.000Z" };
  }
};

describe("syncMailbox", () => {
  it("upserts messages and skips already processed duplicates", async () => {
    const repo = new InMemoryRepository("public@example.edu.cn");
    await repo.saveSettings({
      ...defaultSettings("public@example.edu.cn"),
      mailboxAddress: "public@example.edu.cn",
      mailSyncEnabled: true,
      defaultManualEmail: "manual@example.edu.cn"
    });
    let calls = 0;
    const graph: GraphMailClient = {
      async listInboxDelta() {
        calls += 1;
        return {
          deltaLink: `delta-${calls}`,
          rawIds: new Map(),
          messages: [
            {
              mailboxAddress: "public@example.edu.cn",
              graphMessageId: "graph-1",
              internetMessageId: "<m1>",
              conversationId: "c1",
              subject: "毕业退宿申请",
              senderName: "张三",
              senderEmail: "student@example.com",
              toRecipients: ["public@example.edu.cn"],
              ccRecipients: [],
              receivedAt: "2026-06-03T00:00:00.000Z",
              bodyText: "姓名：张三\n学号：2026123456\n联系方式：13800000000\n退宿原因：毕业\n退宿时间：2026年6月20日",
              hasAttachments: false
            }
          ]
        };
      },
      async listAttachments() {
        return [];
      },
      async downloadAttachment() {
        return Buffer.from("");
      },
      async sendMail() {
        return;
      }
    };

    const first = await syncMailbox({ repo, graph, ai: new NoopAiClient(), mailer, attachmentRoot: "storage/attachments" });
    const second = await syncMailbox({ repo, graph, ai: new NoopAiClient(), mailer, attachmentRoot: "storage/attachments" });
    const messages = await repo.listMessages({});
    const drafts = await repo.listDrafts();

    expect(first.processed).toBe(1);
    expect(second.processed).toBe(0);
    expect(messages.total).toBe(1);
    expect(drafts).toHaveLength(1);
    expect(await repo.getSyncState("public@example.edu.cn")).toBe("delta-2");
  });
});
