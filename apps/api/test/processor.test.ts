import { beforeEach, describe, expect, it } from "vitest";
import { NoopAiClient, type AwardInfo } from "../src/ai/client.js";
import { processMessage } from "../src/business/processor.js";
import { defaultSettings } from "../src/config/defaults.js";
import { InMemoryRepository } from "../src/db/memory.js";
import type { MessageInput } from "../src/db/repository.js";
import type { OutboundMail, OutboundMailer, OutboundResult } from "../src/mail/outbound.js";

class RecordingMailer implements OutboundMailer {
  sent: OutboundMail[] = [];
  result: OutboundResult = { status: "sent", error: null, sentAt: "2026-06-03T00:00:00.000Z" };

  async send(input: OutboundMail): Promise<OutboundResult> {
    this.sent.push(input);
    return this.result;
  }
}

class AwardAi extends NoopAiClient {
  async extractAwardFromImage(): Promise<AwardInfo> {
    return {
      awardName: "物理竞赛二等奖",
      level: "二等奖",
      winner: "李四",
      issuer: "物理学会",
      awardedAt: "2026",
      confidence: 0.92
    };
  }
}

function baseMessage(input: Partial<MessageInput>): MessageInput {
  return {
    mailboxAddress: "public@example.edu.cn",
    graphMessageId: crypto.randomUUID(),
    internetMessageId: null,
    conversationId: null,
    subject: "测试邮件",
    senderName: "张三",
    senderEmail: "student@example.com",
    toRecipients: ["public@example.edu.cn"],
    ccRecipients: [],
    receivedAt: "2026-06-03T08:00:00.000Z",
    bodyText: "",
    hasAttachments: false,
    ...input
  };
}

describe("processMessage", () => {
  let repo: InMemoryRepository;
  let mailer: RecordingMailer;

  beforeEach(async () => {
    repo = new InMemoryRepository("public@example.edu.cn");
    mailer = new RecordingMailer();
    await repo.saveSettings({
      ...defaultSettings("public@example.edu.cn"),
      mailboxAddress: "public@example.edu.cn",
      defaultManualEmail: "manual@example.edu.cn",
      ownerEmails: {
        room_usage: "room@example.edu.cn",
        scholarship: "scholarship@example.edu.cn",
        other: "manual@example.edu.cn"
      },
      mailSyncEnabled: true
    });
  });

  it("auto-approves valid room usage and records outbound mails", async () => {
    const message = await repo.upsertMessage(
      baseMessage({
        subject: "功能房使用报备",
        bodyText: "申请人：张三\n使用地点：多功能室\n使用时间：2026年6月4日 14:00\n使用目的：班会\n参与人数：20人"
      })
    );

    const processed = await processMessage({ repo, ai: new NoopAiClient(), mailer }, message);

    expect(processed.category).toBe("room_usage");
    expect(processed.status).toBe("auto_approved");
    expect(processed.needsReview).toBe(false);
    expect(mailer.sent).toHaveLength(2);
    expect(mailer.sent[1]?.to).toEqual(["student@example.com"]);
  });

  it("moves incomplete room usage to manual review with a draft", async () => {
    const message = await repo.upsertMessage(
      baseMessage({
        subject: "功能房使用报备",
        bodyText: "申请人：张三\n使用地点：多功能室"
      })
    );

    const processed = await processMessage({ repo, ai: new NoopAiClient(), mailer }, message);
    const draft = await repo.getDraftForMessage(message.id);

    expect(processed.status).toBe("manual_required");
    expect(processed.needsReview).toBe(true);
    expect(draft?.status).toBe("manual_required");
  });

  it("uses knowledge base answers for consultation drafts", async () => {
    await repo.upsertKnowledgeEntry({
      id: "kb-1",
      category: "party_consultation",
      question: "党组织关系怎么转接",
      answer: "请按学院党委通知提交介绍信和系统转接信息。",
      enabled: true
    });
    const message = await repo.upsertMessage(
      baseMessage({
        subject: "党组织关系怎么转接",
        bodyText: "老师您好，请问党组织关系怎么转接？"
      })
    );

    const processed = await processMessage({ repo, ai: new NoopAiClient(), mailer }, message);
    const draft = await repo.getDraftForMessage(message.id);

    expect(processed.status).toBe("awaiting_review");
    expect(draft?.body).toContain("请按学院党委通知");
  });

  it("creates a reviewed checkout draft without auto-sending", async () => {
    const message = await repo.upsertMessage(
      baseMessage({
        subject: "毕业退宿申请",
        bodyText: "姓名：张三\n学号：2026123456\n联系方式：13800000000\n退宿原因：毕业离校\n退宿时间：2026年6月20日"
      })
    );

    const processed = await processMessage({ repo, ai: new NoopAiClient(), mailer }, message);
    const draft = await repo.getDraftForMessage(message.id);

    expect(processed.category).toBe("checkout");
    expect(processed.status).toBe("awaiting_review");
    expect(processed.needsReview).toBe(true);
    expect(draft?.status).toBe("draft");
    expect(mailer.sent).toHaveLength(0);
  });

  it("forwards dorm transfer summaries and marks missing fields", async () => {
    await repo.saveSettings({
      ...(await repo.getSettings()),
      ownerEmails: { dorm_transfer: "dorm@example.edu.cn" }
    });
    const message = await repo.upsertMessage(
      baseMessage({
        subject: "换宿申请",
        bodyText: "姓名：张三\n学号：2026123456\n当前宿舍：A101\n换宿原因：作息冲突"
      })
    );

    const processed = await processMessage({ repo, ai: new NoopAiClient(), mailer }, message);

    expect(processed.category).toBe("dorm_transfer");
    expect(processed.status).toBe("forwarded");
    expect(JSON.stringify(processed.extracted)).toContain("targetDorm");
    expect(mailer.sent[0]?.to).toEqual(["dorm@example.edu.cn"]);
  });

  it("flags scholarship body and attachment mismatch", async () => {
    const message = await repo.upsertMessage(
      baseMessage({
        subject: "奖学金申请材料",
        bodyText: "姓名：张三\n奖项名称：数学竞赛一等奖\n获奖等级：一等奖\n颁发单位：数学学会",
        hasAttachments: true
      })
    );
    await repo.addAttachment({
      messageId: message.id,
      graphAttachmentId: "a1",
      name: "award.jpg",
      contentType: "image/jpeg",
      size: 1000,
      storagePath: "/tmp/award.jpg"
    });

    const processed = await processMessage({ repo, ai: new AwardAi(), mailer }, message);

    expect(processed.category).toBe("scholarship");
    expect(processed.status).toBe("forwarded");
    expect(JSON.stringify(processed.extracted)).toContain("正文奖项名称与附件识别结果不一致");
  });
});
