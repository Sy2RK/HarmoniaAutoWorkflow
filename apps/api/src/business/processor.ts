import type { AppSettings, MailCategory, MailMessage } from "@harmonia/shared";
import type { AiClient, AwardInfo } from "../ai/client.js";
import type { AppRepository } from "../db/repository.js";
import type { OutboundMailer } from "../mail/outbound.js";
import { classifyByRules } from "./classifier.js";
import { extractByRules, mergeExtraction, missingFields } from "./extractors.js";
import { findKnowledgeAnswer } from "./knowledge.js";
import { formatOverview } from "./overview.js";
import { validateRoomUsage } from "./roomRules.js";
import { compareScholarshipMaterial } from "./scholarship.js";

type ProcessorDeps = {
  repo: AppRepository;
  ai: AiClient;
  mailer: OutboundMailer;
};

const categoriesNeedingDraft = new Set<MailCategory>(["checkout", "party_consultation", "admission_consultation", "room_usage"]);

function aiTask(category: MailCategory): string {
  const tasks: Record<MailCategory, string> = {
    checkout: "抽取退宿申请中的姓名、学号、联系方式、退宿原因、退宿时间。",
    tutor_report: "抽取 Tutor 报告中的报告主题、提交人、楼层、时间、主要内容。",
    party_consultation: "抽取党团关系咨询中的问题、身份、材料、时间要求。",
    admission_consultation: "抽取入学季咨询中的问题类型、诉求、时间、联系方式。",
    room_usage: "抽取功能房使用报备中的申请人、使用时间、地点、目的、参与人数、联系方式。",
    dorm_transfer: "抽取换宿申请中的姓名、学号、当前宿舍、目标宿舍、原因、联系方式。",
    tutor_application: "抽取楼层导师申请中的姓名、学号、年级、专业、联系方式、申请理由、相关经历。",
    scholarship: "抽取奖学金申请正文中的奖项名称、获奖等级、获奖人、颁发单位、获奖时间。",
    other: "抽取邮件中的关键身份、诉求、时间和联系方式。"
  };
  return tasks[category];
}

function value(data: Record<string, unknown>, key: string): string {
  const item = data[key];
  return typeof item === "string" ? item : item === null || item === undefined ? "" : String(item);
}

async function classifyMessage(ai: AiClient, message: MailMessage): Promise<MailCategory> {
  const byRules = classifyByRules(message.subject, message.bodyText);
  if (byRules !== "other") return byRules;
  try {
    return (await ai.classify({ subject: message.subject, bodyText: message.bodyText })) ?? "other";
  } catch {
    return "other";
  }
}

async function extractMessage(ai: AiClient, category: MailCategory, message: MailMessage): Promise<Record<string, unknown>> {
  const ruleData = extractByRules(category, message.subject, message.bodyText);
  try {
    const aiData = await ai.extractJson({ task: aiTask(category), subject: message.subject, bodyText: message.bodyText });
    return mergeExtraction(ruleData, aiData);
  } catch {
    return ruleData;
  }
}

async function safeReply(ai: AiClient, input: Parameters<AiClient["generateReply"]>[0], fallback: string): Promise<string> {
  try {
    return (await ai.generateReply(input)) ?? fallback;
  } catch {
    return fallback;
  }
}

async function ensureDraft(
  repo: AppRepository,
  message: MailMessage,
  body: string,
  status: "draft" | "manual_required" = "draft"
): Promise<void> {
  const existing = await repo.getDraftForMessage(message.id);
  if (existing) return;
  await repo.createDraft({
    messageId: message.id,
    toEmail: message.senderEmail,
    ccEmails: [],
    subject: message.subject.startsWith("Re:") ? message.subject : `Re: ${message.subject}`,
    body,
    status,
    createdByAi: true
  });
}

async function notifyOwner(
  repo: AppRepository,
  mailer: OutboundMailer,
  settings: AppSettings,
  message: MailMessage,
  category: MailCategory,
  summary: string
): Promise<void> {
  const toEmail = settings.ownerEmails[category] || settings.defaultManualEmail;
  if (!toEmail) {
    await repo.addAudit({
      messageId: message.id,
      actor: "system",
      action: "notification_skipped",
      detail: { reason: "missing_owner_email", category }
    });
    return;
  }
  const subject = `【邮件概览】${message.subject}`;
  const result = await mailer.send({
    mailboxAddress: settings.mailboxAddress,
    to: [toEmail],
    cc: [],
    subject,
    bodyText: summary
  });
  await repo.createForwardRecord({
    messageId: message.id,
    toEmail,
    subject,
    summary,
    status: result.status === "sent" ? "sent" : result.status === "failed" ? "failed" : "pending",
    error: result.error,
    sentAt: result.sentAt
  });
  await repo.createSendLog({
    messageId: message.id,
    draftId: null,
    kind: "forward",
    toEmail,
    subject,
    status: result.status,
    error: result.error,
    sentAt: result.sentAt
  });
}

function checkoutFallback(extracted: Record<string, unknown>, needsManual: boolean): string {
  const name = value(extracted, "name") || "同学";
  return [
    `${name}：`,
    "",
    "你好。学院已收到你的退宿申请。相关信息将由老师核对后处理，系统当前不会自动给出最终决定。",
    needsManual ? "你提交的信息存在缺失或需要进一步确认，请等待老师联系或按要求补充材料。" : "如信息无误，学院老师将按退宿流程进行审核。",
    "",
    "祝好。"
  ].join("\n");
}

function roomApprovalFallback(extracted: Record<string, unknown>): string {
  return [
    `${value(extracted, "applicant") || "同学"}：`,
    "",
    `你好。你提交的功能房使用报备已收到。使用地点：${value(extracted, "room")}；使用时间：${value(
      extracted,
      "usageTime"
    )}；使用目的：${value(extracted, "purpose")}。`,
    "请按学院功能房使用要求保持场地整洁，活动结束后及时恢复原状。如现场安排另有变化，请及时联系学院老师确认。",
    "",
    "祝好。"
  ].join("\n");
}

function knowledgeFallback(answer: string): string {
  return ["同学：", "", "你好。根据学院当前知识库，可回复如下：", "", answer, "", "如你的情况与上述说明不一致，请等待学院老师进一步确认。", "", "祝好。"].join(
    "\n"
  );
}

async function handleKnowledgeConsultation(
  deps: ProcessorDeps,
  message: MailMessage,
  category: "party_consultation" | "admission_consultation",
  extracted: Record<string, unknown>,
  attachmentCount: number
): Promise<MailMessage> {
  const settings = await deps.repo.getSettings();
  const entries = settings.knowledgeBaseEnabled ? await deps.repo.listKnowledgeEntries(category) : [];
  const answer = findKnowledgeAnswer(`${message.subject}\n${message.bodyText}`, entries);
  const hasAnswer = Boolean(answer);
  const judgment = hasAnswer ? "知识库命中，生成待审核回复草稿" : "知识库无明确答案，转人工处理";
  const overview = formatOverview({ message, category, extracted, attachmentCount, judgment, needsReview: true });
  if (answer) {
    const body = await safeReply(
      deps.ai,
      {
        subject: message.subject,
        bodyText: message.bodyText,
        facts: answer.answer,
        constraints: ["必须基于知识库", "不编造政策、日期、地点、联系人", "不承诺未经确认的事项"]
      },
      knowledgeFallback(answer.answer)
    );
    await ensureDraft(deps.repo, message, body);
  }
  return deps.repo.updateMessageProcessing(message.id, {
    category,
    status: hasAnswer ? "awaiting_review" : "manual_required",
    needsReview: true,
    extracted,
    overview,
    recommendation: hasAnswer ? "请老师审核回复草稿后发送" : "请老师人工确认政策口径后处理",
    processedAt: new Date().toISOString()
  });
}

async function handleScholarship(deps: ProcessorDeps, message: MailMessage, extracted: Record<string, unknown>): Promise<MailMessage> {
  const settings = await deps.repo.getSettings();
  const attachments = await deps.repo.listAttachments(message.id);
  const imageAttachments = attachments.filter((attachment) => {
    const lower = attachment.name.toLowerCase();
    return attachment.contentType.startsWith("image/") || /\.(png|jpe?g|webp|bmp)$/i.test(lower);
  });
  const awards: AwardInfo[] = [];
  for (const attachment of imageAttachments) {
    try {
      const award = await deps.ai.extractAwardFromImage({ filePath: attachment.storagePath, contentType: attachment.contentType });
      if (award) awards.push(award);
    } catch {
      awards.push({ awardName: null, level: null, winner: null, issuer: null, awardedAt: null, confidence: 0 });
    }
  }
  const comparison = compareScholarshipMaterial(extracted, awards);
  const enriched = { ...extracted, materialComparison: comparison };
  const judgment = comparison.matched ? "正文与附件奖项信息未发现明显不匹配" : comparison.issues.join("；");
  const overview = formatOverview({
    message,
    category: "scholarship",
    extracted: enriched,
    attachmentCount: attachments.length,
    judgment,
    needsReview: true
  });
  await notifyOwner(deps.repo, deps.mailer, settings, message, "scholarship", overview);
  return deps.repo.updateMessageProcessing(message.id, {
    category: "scholarship",
    status: "forwarded",
    needsReview: true,
    extracted: enriched,
    overview,
    recommendation: comparison.matched ? "请老师复核材料后继续奖学金流程" : "请老师重点检查附件与正文不一致项",
    processedAt: new Date().toISOString()
  });
}

async function handleForwardOnly(
  deps: ProcessorDeps,
  message: MailMessage,
  category: MailCategory,
  extracted: Record<string, unknown>,
  attachmentCount: number,
  judgment: string
): Promise<MailMessage> {
  const settings = await deps.repo.getSettings();
  const overview = formatOverview({ message, category, extracted, attachmentCount, judgment, needsReview: true });
  await notifyOwner(deps.repo, deps.mailer, settings, message, category, overview);
  return deps.repo.updateMessageProcessing(message.id, {
    category,
    status: category === "other" ? "manual_required" : "forwarded",
    needsReview: true,
    extracted,
    overview,
    recommendation: category === "other" ? "请默认人工处理" : "已整理概要并通知负责老师",
    processedAt: new Date().toISOString()
  });
}

async function handleRoomUsage(
  deps: ProcessorDeps,
  message: MailMessage,
  extracted: Record<string, unknown>,
  attachmentCount: number
): Promise<MailMessage> {
  const settings = await deps.repo.getSettings();
  const existingRooms = await deps.repo.listMessages({ category: "room_usage", limit: 1000 });
  const validation = validateRoomUsage(
    extracted,
    settings,
    existingRooms.items.filter((item) => item.id !== message.id)
  );
  const canAutoApprove = settings.roomAutoApproveEnabled && validation.approved;
  const approvalBody = await safeReply(
    deps.ai,
    {
      subject: message.subject,
      bodyText: message.bodyText,
      facts: JSON.stringify(extracted),
      constraints: ["仅确认功能房使用报备通过", "不添加邮件未给出的时间、地点、联系人", "提醒遵守场地使用要求"]
    },
    roomApprovalFallback(extracted)
  );
  const judgment = validation.approved ? "符合默认批准规则" : validation.reasons.join("；");
  const overview = formatOverview({ message, category: "room_usage", extracted, attachmentCount, judgment, needsReview: !canAutoApprove });

  await notifyOwner(deps.repo, deps.mailer, settings, message, "room_usage", overview);

  if (canAutoApprove) {
    const result = await deps.mailer.send({
      mailboxAddress: settings.mailboxAddress,
      to: [message.senderEmail],
      cc: [],
      subject: message.subject.startsWith("Re:") ? message.subject : `Re: ${message.subject}`,
      bodyText: approvalBody
    });
    await deps.repo.createSendLog({
      messageId: message.id,
      draftId: null,
      kind: "auto_reply",
      toEmail: message.senderEmail,
      subject: message.subject,
      status: result.status,
      error: result.error,
      sentAt: result.sentAt
    });
    if (result.status === "sent") {
      return deps.repo.updateMessageProcessing(message.id, {
        category: "room_usage",
        status: "auto_approved",
        needsReview: false,
        extracted,
        overview,
        recommendation: "已自动批准并发送回复",
        processedAt: new Date().toISOString()
      });
    }
  }

  await ensureDraft(deps.repo, message, approvalBody, validation.approved ? "draft" : "manual_required");
  return deps.repo.updateMessageProcessing(message.id, {
    category: "room_usage",
    status: validation.approved ? "awaiting_review" : "manual_required",
    needsReview: true,
    extracted,
    overview,
    recommendation: validation.approved ? "自动批准开关关闭或邮件发送未启用，请老师审核后发送" : "不满足自动批准条件，请人工处理",
    processedAt: new Date().toISOString()
  });
}

async function handleCheckout(
  deps: ProcessorDeps,
  message: MailMessage,
  extracted: Record<string, unknown>,
  attachmentCount: number
): Promise<MailMessage> {
  const missing = missingFields(extracted, ["name", "studentId", "contact", "reason", "checkoutTime"]);
  const needsManual = missing.length > 0;
  const judgment = needsManual ? `信息不完整：${missing.join("、")}` : "信息基本完整，可供老师审核";
  const overview = formatOverview({ message, category: "checkout", extracted, attachmentCount, judgment, needsReview: true });
  const body = await safeReply(
    deps.ai,
    {
      subject: message.subject,
      bodyText: message.bodyText,
      facts: JSON.stringify(extracted),
      constraints: ["不得直接给出最终退宿结果", "特殊情况和信息缺失必须提示人工审核", "不承诺政策或日期"]
    },
    checkoutFallback(extracted, needsManual)
  );
  await ensureDraft(deps.repo, message, body, needsManual ? "manual_required" : "draft");
  return deps.repo.updateMessageProcessing(message.id, {
    category: "checkout",
    status: needsManual ? "manual_required" : "awaiting_review",
    needsReview: true,
    extracted,
    overview,
    recommendation: needsManual ? "请老师要求学生补充缺失信息后处理" : "请老师审核退宿建议和回复草稿",
    processedAt: new Date().toISOString()
  });
}

export async function processMessage(deps: ProcessorDeps, message: MailMessage): Promise<MailMessage> {
  await deps.repo.updateMessageProcessing(message.id, { status: "processing", error: null });
  const settings = await deps.repo.getSettings();
  const attachments = await deps.repo.listAttachments(message.id);
  const category = await classifyMessage(deps.ai, message);
  const extracted = await extractMessage(deps.ai, category, message);
  const attachmentCount = attachments.length;
  let processed: MailMessage;

  if (category === "checkout") {
    processed = await handleCheckout(deps, message, extracted, attachmentCount);
  } else if (category === "party_consultation" || category === "admission_consultation") {
    processed = await handleKnowledgeConsultation(deps, message, category, extracted, attachmentCount);
  } else if (category === "room_usage") {
    processed = await handleRoomUsage(deps, message, extracted, attachmentCount);
  } else if (category === "scholarship") {
    processed = await handleScholarship(deps, message, extracted);
  } else if (category === "tutor_report") {
    processed = await handleForwardOnly(deps, message, category, extracted, attachmentCount, "已生成 Tutor 报告概览");
  } else if (category === "dorm_transfer") {
    const missing = missingFields(extracted, ["name", "studentId", "currentDorm", "targetDorm", "reason", "contact"]);
    processed = await handleForwardOnly(
      deps,
      message,
      category,
      { ...extracted, missingFields: missing },
      attachmentCount,
      missing.length ? `信息不完整：${missing.join("、")}` : "已整理换宿申请概要"
    );
  } else if (category === "tutor_application") {
    const missing = missingFields(extracted, ["name", "studentId", "grade", "major", "contact", "reason"]);
    processed = await handleForwardOnly(
      deps,
      message,
      category,
      { ...extracted, missingFields: missing },
      attachmentCount,
      missing.length ? `信息不完整：${missing.join("、")}` : "已整理 Tutor 申请概要"
    );
  } else {
    const overview = formatOverview({
      message,
      category: "other",
      extracted,
      attachmentCount,
      judgment: categoriesNeedingDraft.has(category) ? "需人工复核" : "无法归入已知业务类型",
      needsReview: true
    });
    await notifyOwner(deps.repo, deps.mailer, settings, message, "other", overview);
    processed = await deps.repo.updateMessageProcessing(message.id, {
      category: "other",
      status: "manual_required",
      needsReview: true,
      extracted,
      overview,
      recommendation: "请老师人工处理",
      processedAt: new Date().toISOString()
    });
  }

  await deps.repo.addAudit({
    messageId: message.id,
    actor: "system",
    action: "message_processed",
    detail: { category: processed.category, status: processed.status, needsReview: processed.needsReview }
  });
  return processed;
}
