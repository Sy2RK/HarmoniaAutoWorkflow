import { mailCategoryLabels, type MailCategory, type MailMessage } from "@harmonia/shared";

export function formatOverview(input: {
  message: MailMessage;
  category: MailCategory;
  extracted: Record<string, unknown>;
  attachmentCount: number;
  judgment: string;
  needsReview: boolean;
}): string {
  const extractedLines = Object.entries(input.extracted)
    .filter(([, value]) => value !== null && value !== undefined && value !== "")
    .map(([key, value]) => `- ${key}: ${typeof value === "object" ? JSON.stringify(value) : String(value)}`)
    .join("\n");

  return [
    `邮件类型：${mailCategoryLabels[input.category]}`,
    `发件人：${input.message.senderName ? `${input.message.senderName} <${input.message.senderEmail}>` : input.message.senderEmail}`,
    `邮件主题：${input.message.subject}`,
    `收到时间：${input.message.receivedAt}`,
    `附件数量：${input.attachmentCount}`,
    "关键信息：",
    extractedLines || "- 暂未提取到明确结构化信息",
    `系统判断：${input.judgment}`,
    `建议处理方式：${input.needsReview ? "人工审核" : "系统已按规则处理"}`
  ].join("\n");
}
