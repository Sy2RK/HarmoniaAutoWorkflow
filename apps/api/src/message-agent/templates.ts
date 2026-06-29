import { randomUUID } from "node:crypto";
import type {
  MessageAgentAudience,
  MessageAgentLanguage,
  MessageAgentQuestion,
  MessageAgentSlot,
  MessageAgentSource,
  MessageAgentSourceRef,
  MessageAgentTemplate,
  MessageAgentTemplateCategory
} from "@harmonia/shared";
import type { MessageAgentTemplateExtraction } from "../ai/client.js";
import type { MessageAgentTemplateSeed } from "./parser.js";
import { categoryFromText, normalizeText } from "./parser.js";

export function fallbackTemplateFromSeed(seed: MessageAgentTemplateSeed, source: MessageAgentSource, extracted?: MessageAgentTemplateExtraction | null): MessageAgentTemplate {
  const now = new Date().toISOString();
  const category = extracted?.category ?? seed.category;
  return {
    id: randomUUID(),
    category,
    title: extracted?.title || seed.title || source.fileName,
    language: extracted?.language ?? detectLanguage(seed.text),
    audience: extracted?.audience ?? audienceForCategory(category),
    subjectPattern: extracted?.subjectPattern ?? inferSubject(seed.text),
    bodySkeleton: extracted?.bodySkeleton || seed.text,
    requiredSlots: extracted?.requiredSlots?.length ? extracted.requiredSlots : requiredSlotsForCategory(category),
    optionalSlots: extracted?.optionalSlots ?? [],
    tone: extracted?.tone || "polite college-office tone",
    signatureStyle: extracted?.signatureStyle ?? inferSignature(seed.text),
    sourceIds: [source.id],
    createdAt: now,
    updatedAt: now
  };
}

export function classifyByText(text: string): {
  category: MessageAgentTemplateCategory;
  language: MessageAgentLanguage;
  audience: MessageAgentAudience;
  intent: string;
  urgency: "low" | "normal" | "high";
} {
  const category = categoryFromText(text);
  return {
    category,
    language: detectLanguage(text),
    audience: audienceForCategory(category),
    intent: firstLine(text) || category,
    urgency: /紧急|尽快|urgent|asap|立即/i.test(text) ? "high" : "normal"
  };
}

export function retrieveTemplates(input: { templates: MessageAgentTemplate[]; query: string; category?: MessageAgentTemplateCategory | null; limit?: number }): MessageAgentTemplate[] {
  const queryTokens = tokenize(input.query);
  if (queryTokens.length === 0) return input.templates.slice(0, input.limit ?? 8);
  const querySet = new Set(queryTokens);
  return input.templates
    .map((template) => ({ template, score: scoreTemplate(template, querySet, input.category ?? null) }))
    .filter((item) => item.score > 0)
    .toSorted((a, b) => b.score - a.score)
    .slice(0, input.limit ?? 8)
    .map((item) => item.template);
}

export function missingSlotsFor(category: MessageAgentTemplateCategory, context: string): MessageAgentSlot[] {
  const text = normalizeText(context);
  const checks: Array<[MessageAgentSlot, RegExp]> = [];
  if (category === "facility_notice") {
    checks.push(
      [slot("project", "项目/施工内容", "例如维修、清洗、停水、消杀或施工事项"), /维护|施工|清洗|停水|消杀|维修|更换|改造|project|maintenance|construction/i],
      [slot("location", "地点/影响范围", "例如 A栋、D栋、功能房或具体区域"), /[A-D]栋|Block [A-D]|功能房|宿舍|楼|房|区域|地点|location|room/i],
      [slot("date", "日期", "例如 6月30日或 Wednesday"), /\d{4}[-/年]\d{1,2}|\d{1,2}月\d{1,2}|周[一二三四五六日]|星期[一二三四五六日]|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday/i],
      [slot("time", "时间段", "例如 9:00-12:00"), /\d{1,2}[:：]\d{2}|上午|下午|晚上|AM|PM|a\.m\.|p\.m\./i]
    );
  } else if (category === "youth_league") {
    checks.push(
      [slot("studentName", "学生姓名", "需要明确来信学生或称呼"), /[一-龥]{2,4}同学|姓名|name/i],
      [slot("documentType", "需补充材料", "例如入团志愿书、团员档案或申请记录"), /入团志愿书|团档案|申请记录|材料|document|archive/i]
    );
  } else if (category === "function_room") {
    checks.push(
      [slot("room", "功能房/房间", "例如 B203、D210"), /[A-D]\d{3}|功能房|房间|room/i],
      [slot("decision", "处理决定", "例如同意、取消记录、拒绝或改期"), /同意|取消|拒绝|改期|无法|批准|approve|reject|cancel/i]
    );
  } else if (category === "bfmo_coordination") {
    checks.push(
      [slot("target", "收件部门/联系人", "例如 BFMO 或具体同事"), /BFMO|楼宇|设施|同事|department|contact/i],
      [slot("request", "请求事项", "需要对方执行或回复的事项"), /烦请|请|希望|协调|提供|调整|request|please/i]
    );
  } else if (category === "recommendation_letter") {
    checks.push(
      [slot("applicant", "申请人", "奖学金申请学生姓名"), /申请人|学生|applicant|student/i],
      [slot("award", "奖项名称", "需要推荐信对应的奖项"), /奖|scholarship|award/i],
      [slot("deadline", "提交截止时间", "推荐信提交期限"), /截止|deadline|\d{1,2}月\d{1,2}|\d{4}/i]
    );
  }
  return checks.filter(([, pattern]) => !pattern.test(text)).map(([item]) => item);
}

export function questionsForMissing(slots: MessageAgentSlot[]): MessageAgentQuestion[] {
  return slots.map((item) => ({
    slotKey: item.key,
    question: `请补充${item.label}${item.description ? `（${item.description}）` : ""}。`,
    required: true
  }));
}

export function sourceRefsForTemplates(templates: MessageAgentTemplate[], sources: MessageAgentSource[], query: string): MessageAgentSourceRef[] {
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const refs: MessageAgentSourceRef[] = [];
  for (const template of templates) {
    for (const sourceId of template.sourceIds) {
      const source = sourceById.get(sourceId);
      if (!source) continue;
      refs.push({
        sourceId: source.id,
        templateId: template.id,
        fileName: source.fileName,
        title: template.title,
        category: template.category,
        snippet: snippetFor(source.text || template.bodySkeleton, query)
      });
    }
  }
  return refs;
}

export function fallbackDraft(input: {
  category: MessageAgentTemplateCategory;
  language: MessageAgentLanguage;
  context: string;
  templates: MessageAgentTemplate[];
}): { subject: string; body: string; attachmentSuggestions: string[]; warnings: string[] } {
  const template = input.templates[0];
  const subject = template?.subjectPattern || subjectForCategory(input.category);
  const signature =
    template?.signatureStyle ||
    "顺祝，\n时祺\n\n祥波书院 | Harmonia College Office\n邮件 | Email: harmonia@cuhk.edu.cn\n书院热线 | College Hotline: (86)0755-23515400";
  const body =
    input.category === "format_reminder"
      ? "同学你好：\n\n邮件已收到。\n\n温馨提醒：今后的邮件请记得加上称呼、正文和落款。规范的格式不仅能体现对他人的尊重，也是未来职场必备的基本素养。\n\n祝好！"
      : `您好：\n\n根据你提供的信息，草稿内容如下。请在发送前核对具体日期、地点、联系人和附件名称：\n\n${summarizeContext(input.context)}\n\n${signature}`;
  return { subject, body, attachmentSuggestions: [], warnings: ["FALLBACK_DRAFT_GENERATED"] };
}

function scoreTemplate(template: MessageAgentTemplate, queryTokens: Set<string>, category: MessageAgentTemplateCategory | null): number {
  const text = `${template.category}\n${template.title}\n${template.subjectPattern ?? ""}\n${template.bodySkeleton}\n${template.requiredSlots.map((item) => item.label).join(" ")}`;
  const tokens = tokenize(text);
  const counts = new Map<string, number>();
  for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);
  let score = category && template.category === category ? 5 : 0;
  for (const token of queryTokens) {
    const count = counts.get(token) ?? 0;
    if (count > 0) score += 1 + Math.log2(count + 1);
  }
  return score;
}

function tokenize(value: string): string[] {
  const normalized = value.toLowerCase();
  const tokens = [...normalized.matchAll(/[a-z0-9_]{2,}/g)].map((match) => match[0]);
  const cjk = [...normalized].filter((char) => /[\u3400-\u9FFF]/.test(char));
  tokens.push(...cjk);
  for (let index = 0; index < cjk.length - 1; index += 1) tokens.push(`${cjk[index]}${cjk[index + 1]}`);
  return tokens.filter((token) => !["的", "了", "是", "和", "与", "及", "请", "你", "我"].includes(token));
}

function detectLanguage(text: string): MessageAgentLanguage {
  const hasCjk = /[\u3400-\u9FFF]/.test(text);
  const hasEnglish = /[A-Za-z]{4,}/.test(text);
  if (hasCjk && hasEnglish) return /Dear|Best regards|Harmonia College/i.test(text) ? "bilingual" : "mixed";
  return hasEnglish ? "en" : "zh";
}

function audienceForCategory(category: MessageAgentTemplateCategory): MessageAgentAudience {
  if (category === "facility_notice" || category === "electricity_subsidy") return "teachers_students";
  if (category === "bfmo_coordination") return "department";
  if (category === "recommendation_letter") return "recommender";
  if (category === "property_staff") return "staff";
  return "student";
}

function requiredSlotsForCategory(category: MessageAgentTemplateCategory): MessageAgentSlot[] {
  return {
    facility_notice: [slot("project", "项目/施工内容"), slot("location", "地点/影响范围"), slot("date", "日期"), slot("time", "时间段")],
    youth_league: [slot("studentName", "学生姓名"), slot("documentType", "需补充材料")],
    electricity_subsidy: [slot("academicYear", "学年/年度")],
    function_room: [slot("room", "功能房/房间"), slot("decision", "处理决定")],
    property_staff: [slot("feedback", "反馈事项")],
    bfmo_coordination: [slot("target", "收件部门/联系人"), slot("request", "请求事项")],
    recommendation_letter: [slot("applicant", "申请人"), slot("award", "奖项名称"), slot("deadline", "提交截止时间")],
    event_registration: [slot("event", "活动名称")],
    format_reminder: [],
    general_reply: []
  }[category];
}

function slot(key: string, label: string, description?: string): MessageAgentSlot {
  return description ? { key, label, description } : { key, label };
}

function inferSubject(text: string): string | null {
  const line = firstLine(text);
  if (/^(Notice|Notification|Harmonia|祥波|回复|Re:|主题)/i.test(line)) return line.replace(/^主题[:：]\s*/, "").slice(0, 120);
  return null;
}

function inferSignature(text: string): string | null {
  const match = /(顺祝，[\s\S]{0,200}|祥波书院 \| Harmonia College Office[\s\S]{0,250})/.exec(text);
  return match?.[0]?.trim() ?? null;
}

function subjectForCategory(category: MessageAgentTemplateCategory): string {
  return {
    facility_notice: "Harmonia College Facilities Maintenance Notice 祥波书院设施维护温馨提示",
    youth_league: "祥波书院团组织关系资料补充",
    electricity_subsidy: "Notice on Electricity Subsidy Allocation at Harmonia College 祥波书院送电操作通知",
    function_room: "关于功能房使用事宜的回复",
    property_staff: "关于物业服务反馈的回复",
    bfmo_coordination: "祥波书院事项沟通",
    recommendation_letter: "Harmonia College Scholarship Recommendation Letter Request",
    event_registration: "关于祥波书院活动报名的回复",
    format_reminder: "邮件格式温馨提醒",
    general_reply: "关于来信事项的回复"
  }[category];
}

function firstLine(value: string): string {
  return value.split("\n").map((line) => line.trim()).find(Boolean)?.slice(0, 120) ?? "";
}

function snippetFor(text: string, query: string): string {
  const normalized = normalizeText(text).replace(/\s+/g, " ");
  if (normalized.length <= 220) return normalized;
  const token = tokenize(query).find((item) => normalized.toLowerCase().includes(item.toLowerCase()));
  const index = token ? normalized.toLowerCase().indexOf(token.toLowerCase()) : 0;
  const start = Math.max(0, index - 60);
  return `${start > 0 ? "..." : ""}${normalized.slice(start, start + 220)}${start + 220 < normalized.length ? "..." : ""}`;
}

function summarizeContext(context: string): string {
  const text = normalizeText(context);
  return text.length > 900 ? `${text.slice(0, 900)}...` : text;
}
