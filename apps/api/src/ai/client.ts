import { readFile } from "node:fs/promises";
import type {
  MailCategory,
  MessageAgentAudience,
  MessageAgentLanguage,
  MessageAgentSlot,
  MessageAgentTemplateCategory
} from "@harmonia/shared";

export type AwardInfo = {
  awardName: string | null;
  level: string | null;
  winner: string | null;
  issuer: string | null;
  awardedAt: string | null;
  confidence: number;
};

export type ScholarshipEvidenceImage = {
  fileName: string;
  pageNumber: number | null;
  dataUrl: string;
};

export type ScholarshipEvidenceVerificationInput = {
  applicantName: string;
  studentId: string;
  categoryLabel: string;
  declaredText: string;
  fileNames: string[];
  images: ScholarshipEvidenceImage[];
};

export type ScholarshipEvidenceVerification = {
  supported: boolean;
  confidence: number;
  summary: string;
  issues: string[];
  matchedItems: string[];
  missingItems: string[];
};

export type AwardConfidenceTextField =
  | "personalStatement"
  | "collegeContribution"
  | "servicePractice"
  | "dormService"
  | "academic"
  | "studentOrg"
  | "awardsGeneral"
  | "sports"
  | "artsTalent";

export type AwardConfidenceTextEvaluationInput = {
  applicantName: string;
  awardName: string;
  sheetName: string;
  rowNumber: number;
  fields: Record<AwardConfidenceTextField, string>;
  notes: string;
};

export type AwardConfidenceTextEvaluation = {
  fieldScores: Partial<Record<AwardConfidenceTextField, number>>;
  riskPenalty: number;
  summary: string;
};

export type CollegeKnowledgeRerankCandidate = {
  id: string;
  documentName: string;
  locator: string;
  title: string | null;
  text: string;
  lexicalScore: number;
};

export type CollegeKnowledgeRerankInput = {
  question: string;
  imageText: string | null;
  candidates: CollegeKnowledgeRerankCandidate[];
};

export type CollegeKnowledgeRerankResult = {
  selectedIds: string[];
  reasons: Record<string, string>;
};

export type CollegeKnowledgeAnswerInput = {
  question: string;
  imageText: string | null;
  sources: Array<{
    id: string;
    documentName: string;
    locator: string;
    title: string | null;
    text: string;
  }>;
};

export type CollegeKnowledgeAnswerResult = {
  answerable: boolean;
  answer: string;
  sourceIds: string[];
  warnings: string[];
};

export type MessageAgentTemplateExtractionInput = {
  sourceTitle: string;
  categoryHint: MessageAgentTemplateCategory;
  text: string;
};

export type MessageAgentTemplateExtraction = {
  category: MessageAgentTemplateCategory;
  title: string;
  language: MessageAgentLanguage;
  audience: MessageAgentAudience;
  subjectPattern: string | null;
  bodySkeleton: string;
  requiredSlots: MessageAgentSlot[];
  optionalSlots: MessageAgentSlot[];
  tone: string;
  signatureStyle: string | null;
};

export type MessageAgentClassificationInput = {
  message: string;
  context: string;
};

export type MessageAgentClassification = {
  category: MessageAgentTemplateCategory;
  language: MessageAgentLanguage;
  audience: MessageAgentAudience;
  intent: string;
  urgency: "low" | "normal" | "high";
};

export type MessageAgentDraftPlanInput = {
  message: string;
  context: string;
  category: MessageAgentTemplateCategory;
  templates: Array<{ id: string; title: string; category: MessageAgentTemplateCategory; bodySkeleton: string; requiredSlots: MessageAgentSlot[] }>;
};

export type MessageAgentDraftPlan = {
  ready: boolean;
  missingSlots: MessageAgentSlot[];
  questions: Array<{ slotKey: string; question: string; required: boolean }>;
  attachmentSuggestions: string[];
};

export type MessageAgentDraftGenerationInput = {
  message: string;
  context: string;
  category: MessageAgentTemplateCategory;
  language: MessageAgentLanguage;
  audience: MessageAgentAudience;
  templates: Array<{ id: string; title: string; bodySkeleton: string }>;
};

export type MessageAgentDraftGeneration = {
  subject: string;
  body: string;
  attachmentSuggestions: string[];
  warnings: string[];
};

export interface AiClient {
  classify(input: { subject: string; bodyText: string }): Promise<MailCategory | null>;
  extractJson(input: { task: string; subject: string; bodyText: string }): Promise<Record<string, unknown> | null>;
  generateReply(input: { subject: string; bodyText: string; facts: string; constraints: string[] }): Promise<string | null>;
  extractAwardFromImage(input: { filePath: string; contentType: string }): Promise<AwardInfo | null>;
  verifyScholarshipEvidence(input: ScholarshipEvidenceVerificationInput): Promise<ScholarshipEvidenceVerification | null>;
  evaluateAwardConfidence(input: AwardConfidenceTextEvaluationInput): Promise<AwardConfidenceTextEvaluation | null>;
  describeCollegeKnowledgeImage(input: { filePath: string; contentType: string }): Promise<string | null>;
  rerankCollegeKnowledge(input: CollegeKnowledgeRerankInput): Promise<CollegeKnowledgeRerankResult | null>;
  answerCollegeKnowledge(input: CollegeKnowledgeAnswerInput): Promise<CollegeKnowledgeAnswerResult | null>;
  extractMessageAgentTemplate(input: MessageAgentTemplateExtractionInput): Promise<MessageAgentTemplateExtraction | null>;
  classifyMessageAgentRequest(input: MessageAgentClassificationInput): Promise<MessageAgentClassification | null>;
  planMessageAgentDraft(input: MessageAgentDraftPlanInput): Promise<MessageAgentDraftPlan | null>;
  generateMessageAgentDraft(input: MessageAgentDraftGenerationInput): Promise<MessageAgentDraftGeneration | null>;
  describeMessageAgentImage(input: { filePath: string; contentType: string }): Promise<string | null>;
}

export class NoopAiClient implements AiClient {
  async classify(): Promise<MailCategory | null> {
    return null;
  }

  async extractJson(): Promise<Record<string, unknown> | null> {
    return null;
  }

  async generateReply(): Promise<string | null> {
    return null;
  }

  async extractAwardFromImage(): Promise<AwardInfo | null> {
    return null;
  }

  async verifyScholarshipEvidence(_input: ScholarshipEvidenceVerificationInput): Promise<ScholarshipEvidenceVerification | null> {
    return null;
  }

  async evaluateAwardConfidence(_input: AwardConfidenceTextEvaluationInput): Promise<AwardConfidenceTextEvaluation | null> {
    return null;
  }

  async describeCollegeKnowledgeImage(_input: { filePath: string; contentType: string }): Promise<string | null> {
    return null;
  }

  async rerankCollegeKnowledge(_input: CollegeKnowledgeRerankInput): Promise<CollegeKnowledgeRerankResult | null> {
    return null;
  }

  async answerCollegeKnowledge(_input: CollegeKnowledgeAnswerInput): Promise<CollegeKnowledgeAnswerResult | null> {
    return null;
  }

  async extractMessageAgentTemplate(_input: MessageAgentTemplateExtractionInput): Promise<MessageAgentTemplateExtraction | null> {
    return null;
  }

  async classifyMessageAgentRequest(_input: MessageAgentClassificationInput): Promise<MessageAgentClassification | null> {
    return null;
  }

  async planMessageAgentDraft(_input: MessageAgentDraftPlanInput): Promise<MessageAgentDraftPlan | null> {
    return null;
  }

  async generateMessageAgentDraft(_input: MessageAgentDraftGenerationInput): Promise<MessageAgentDraftGeneration | null> {
    return null;
  }

  async describeMessageAgentImage(_input: { filePath: string; contentType: string }): Promise<string | null> {
    return null;
  }
}

export class OpenAiCompatibleClient implements AiClient {
  private readonly textProvider: OpenAiProviderConfig;
  private readonly visionProvider: OpenAiProviderConfig;
  private readonly scholarshipProvider: OpenAiProviderConfig;

  constructor(config: { text: OpenAiProviderConfig; vision: OpenAiProviderConfig; scholarship?: OpenAiProviderConfig }) {
    this.textProvider = normalizeProvider(config.text);
    this.visionProvider = normalizeProvider(config.vision);
    this.scholarshipProvider = normalizeProvider(config.scholarship ?? config.vision);
  }

  private async chat(provider: OpenAiProviderConfig, messages: unknown[], json = false, timeoutMs = 90_000): Promise<string | null> {
    const model = await resolveProviderModel(provider);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetch(`${provider.baseUrl}/chat/completions`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${provider.apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: 0.1,
          response_format: json ? { type: "json_object" } : undefined
        })
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`OpenAI-compatible request timed out after ${timeoutMs}ms with model ${model}`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`OpenAI-compatible request failed ${response.status} with model ${model}: ${text}`);
    }
    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return data.choices?.[0]?.message?.content ?? null;
  }

  async classify(input: { subject: string; bodyText: string }): Promise<MailCategory | null> {
    const content = await this.chat(
      this.textProvider,
      [
        {
          role: "system",
          content:
            "你是学院公共邮箱分类器。只输出 JSON：{\"category\":\"checkout|tutor_report|party_consultation|admission_consultation|room_usage|dorm_transfer|tutor_application|scholarship|other\"}。无法确定输出 other。"
        },
        { role: "user", content: `主题：${input.subject}\n正文：${input.bodyText.slice(0, 6000)}` }
      ],
      true
    );
    if (!content) return null;
    try {
      const parsed = JSON.parse(content) as { category?: MailCategory };
      return parsed.category ?? null;
    } catch {
      return null;
    }
  }

  async extractJson(input: { task: string; subject: string; bodyText: string }): Promise<Record<string, unknown> | null> {
    const content = await this.chat(
      this.textProvider,
      [
        {
          role: "system",
          content:
            "你是学院邮件信息抽取助手。必须只基于邮件原文抽取，未知字段填 null，不得编造。只输出扁平或浅层 JSON。"
        },
        { role: "user", content: `任务：${input.task}\n主题：${input.subject}\n正文：${input.bodyText.slice(0, 8000)}` }
      ],
      true
    );
    if (!content) return null;
    try {
      return JSON.parse(content) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  async generateReply(input: {
    subject: string;
    bodyText: string;
    facts: string;
    constraints: string[];
  }): Promise<string | null> {
    return this.chat(this.textProvider, [
      {
        role: "system",
        content:
          "你是学院老师的邮件回复草稿助手。回复正式、礼貌、简洁。必须只使用给定依据，不得编造政策、时间、地点、联系人或承诺。"
      },
      {
        role: "user",
        content: `原邮件主题：${input.subject}\n原邮件正文：${input.bodyText.slice(0, 5000)}\n可用依据：${input.facts}\n限制：${input.constraints.join("；")}\n请生成中文回复草稿。`
      }
    ]);
  }

  async extractAwardFromImage(input: { filePath: string; contentType: string }): Promise<AwardInfo | null> {
    const buffer = await readFile(input.filePath);
    const dataUrl = `data:${input.contentType};base64,${buffer.toString("base64")}`;
    const content = await this.chat(
      this.visionProvider,
      [
        {
          role: "system",
          content:
            "你是奖项图片 OCR 与信息抽取助手。只输出 JSON：awardName, level, winner, issuer, awardedAt, confidence。无法识别填 null，confidence 0 到 1。"
        },
        {
          role: "user",
          content: [
            { type: "text", text: "请从这张奖项/证书图片中抽取奖项信息。" },
            { type: "image_url", image_url: { url: dataUrl } }
          ]
        }
      ],
      true
    );
    if (!content) return null;
    try {
      return JSON.parse(content) as AwardInfo;
    } catch {
      return null;
    }
  }

  async verifyScholarshipEvidence(input: ScholarshipEvidenceVerificationInput): Promise<ScholarshipEvidenceVerification | null> {
    if (input.images.length === 0) return null;
    const imageParts = input.images.map((image) => ({
      type: "image_url",
      image_url: { url: image.dataUrl }
    }));
    const content = await this.chat(
      this.textProvider,
      [
        {
          role: "system",
          content:
            "你是高校奖学金/优秀毕业生证明材料核验员。核验原则偏宽松：只要申请人身份、核心奖项/项目名称、年份或学年大体能对上，即视为证明支持申报。精确到日的日期、简称/中英文译名、单位法定名差异、角色名称近义表述、轻微错别字或证明形式不够正式，不算不匹配，只可写入 summary 提醒。只有不同人、完全不同奖项/项目、年份或学年明显冲突、奖项等级/名次明显冲突、证明指向完全不同经历时，才写入 issues。只输出 JSON，字段为 supported, confidence, summary, issues, matchedItems, missingItems。confidence 为 0 到 1。issues、matchedItems、missingItems 必须是字符串数组。"
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                `申请人：${input.applicantName || "未知"}\n` +
                `学号：${input.studentId || "未知"}\n` +
                `核对类别：${input.categoryLabel}\n` +
                `申报内容：\n${input.declaredText.slice(0, 4000)}\n\n` +
                `本批证明页来自：${input.fileNames.join("；").slice(0, 1200)}\n\n` +
                "请判断这些证明页是否支持申报内容。优先核对申请人、核心奖项/项目名称、年份或学年；只要主要时间与奖项/项目名称对得上，就应 supported=true。不要因为落款日不可见、日期只到年月/学年、名称一字差、简称/英文译名、同一单位不同表述、角色近义词或截图/照片形式而写入 issues。硬性冲突才写入 issues；只能支持部分条目时，在 matchedItems 与 missingItems 中列出。"
            },
            ...imageParts
          ]
        }
      ],
      true
    );
    if (!content) return null;
    try {
      return normalizeScholarshipVerification(JSON.parse(content) as Record<string, unknown>);
    } catch {
      return null;
    }
  }

  async evaluateAwardConfidence(input: AwardConfidenceTextEvaluationInput): Promise<AwardConfidenceTextEvaluation | null> {
    const content = await this.chat(
      this.scholarshipProvider,
      [
        {
          role: "system",
          content:
            "你是书院奖学金申请材料匹配度评审助手。最高原则：只判断 XLSX 中与书院生活、社会服务、书院活动、书院组织或宿舍生活贡献直接相关的文字材料；GPA、学业成绩、专业竞赛、校外/院系/社会普通奖项、推荐人完整度和初审结果一律不作为加分项。不要验证外部证明文件。必须只输出 JSON：{fieldScores:{personalStatement,collegeContribution,servicePractice,dormService,academic,studentOrg,awardsGeneral,sports,artsTalent},riskPenalty,summary}。每个 field score 是 0 到 1，riskPenalty 是 0 到 0.35。academic 必须为 0；awardsGeneral 只在奖项明确属于书院生活、书院服务或书院活动成果时才可给分。"
        },
        {
          role: "user",
          content:
            `申请人：${input.applicantName || "未知"}\n` +
            `Sheet：${input.sheetName}，行号：${input.rowNumber}\n` +
            `申请奖项：${input.awardName}\n\n` +
            "奖项画像参考：\n" +
            "- 院长嘉许奖：综合看书院生活参与、书院活动贡献、社会服务、宿舍生活服务、书院相关组织贡献。\n" +
            "- 杰出领导力奖：重点看书院相关组织、书院活动、宿舍/社区服务中的领导岗位、组织协调和影响力。\n" +
            "- 优秀服务奖：重点看书院/宿舍/社会服务实践、志愿服务、社区贡献和持续投入。\n" +
            "- 卓越体育贡献奖：只看体育能力如何转化为书院活动、书院队伍、书院体育文化或书院同学服务贡献；纯竞赛成绩不加分。\n" +
            "- 卓越才艺贡献奖：只看才艺能力如何转化为书院活动、书院文化建设、书院同学服务或书院公共展示贡献；纯才艺奖项不加分。\n\n" +
            "请分别判断每个字段在书院相关范围内对该奖项的匹配度。字段为空或内容与书院生活/服务/活动无关应给低分；内容具体、持续、有影响力、与书院奖项画像高度一致应给高分。sports/artsTalent 是从个人陈述、书院活动贡献、学生组织、奖项/其他等文本中综合判断的书院相关专项贡献分；不要因校外或纯个人体育/才艺奖项给高分。\n\n" +
            `个人陈述：\n${input.fields.personalStatement.slice(0, 2500)}\n\n` +
            `书院活动贡献：\n${input.fields.collegeContribution.slice(0, 2500)}\n\n` +
            `社会服务实践和成就：\n${input.fields.servicePractice.slice(0, 2500)}\n\n` +
            `宿舍生活服务：\n${input.fields.dormService.slice(0, 2500)}\n\n` +
            "学业表现：此字段已在前置流程审查，本模块不参与评分，academic 请输出 0。\n\n" +
            `学生组织：\n${input.fields.studentOrg.slice(0, 2500)}\n\n` +
            `奖项/其他（仅可考虑明确属于书院生活、书院服务或书院活动的条目）：\n${input.fields.awardsGeneral.slice(0, 2500)}\n\n` +
            `核对备注说明：\n${input.notes.slice(0, 1500)}`
        }
      ],
      true
    );
    if (!content) return null;
    try {
      return normalizeAwardConfidenceEvaluation(JSON.parse(content) as Record<string, unknown>);
    } catch {
      return null;
    }
  }

  async describeCollegeKnowledgeImage(input: { filePath: string; contentType: string }): Promise<string | null> {
    const buffer = await readFile(input.filePath);
    const dataUrl = `data:${input.contentType};base64,${buffer.toString("base64")}`;
    return this.chat(this.visionProvider, [
      {
        role: "system",
        content:
          "你是书院知识问答的图片理解助手。请只提取图片中与用户提问有关的文字、表格、截图内容或关键信息，不要回答问题，不要编造看不见的内容。"
      },
      {
        role: "user",
        content: [
          { type: "text", text: "请把这张图片中可用于知识库问答检索的信息整理为简洁中文文本。" },
          { type: "image_url", image_url: { url: dataUrl } }
        ]
      }
    ]);
  }

  async rerankCollegeKnowledge(input: CollegeKnowledgeRerankInput): Promise<CollegeKnowledgeRerankResult | null> {
    if (input.candidates.length === 0) return null;
    const candidates = input.candidates.map((candidate, index) => ({
      rank: index + 1,
      id: candidate.id,
      documentName: candidate.documentName,
      locator: candidate.locator,
      title: candidate.title,
      lexicalScore: candidate.lexicalScore,
      text: candidate.text.slice(0, 1200)
    }));
    const content = await this.chat(
      this.textProvider,
      [
        {
          role: "system",
          content:
            "你是书院知识库检索 rerank 助手。只根据候选片段和用户问题判断相关性。必须只输出 JSON：{selectedIds:string[], reasons:{[id]:string}}。selectedIds 最多 8 个，按相关性从高到低排列；不要输出候选外的 id。"
        },
        {
          role: "user",
          content: JSON.stringify(
            {
              question: input.question,
              imageText: input.imageText,
              candidates
            },
            null,
            2
          )
        }
      ],
      true
    );
    if (!content) return null;
    try {
      return normalizeCollegeKnowledgeRerank(JSON.parse(content) as Record<string, unknown>, new Set(input.candidates.map((candidate) => candidate.id)));
    } catch {
      return null;
    }
  }

  async answerCollegeKnowledge(input: CollegeKnowledgeAnswerInput): Promise<CollegeKnowledgeAnswerResult | null> {
    if (input.sources.length === 0) return null;
    const content = await this.chat(
      this.textProvider,
      [
        {
          role: "system",
          content:
            "你是书院知识问答助手。只能基于 sources 中的片段回答，不得使用常识补全政策、时间、地点、联系人或流程。必须只输出 JSON：{answerable:boolean, answer:string, sourceIds:string[], warnings:string[]}。如果资料不足，answerable=false，answer 说明未在已上传资料中找到明确依据，sourceIds 为空或仅保留最相关依据。sourceIds 必须来自 sources 的 id。"
        },
        {
          role: "user",
          content: JSON.stringify(
            {
              question: input.question,
              imageText: input.imageText,
              sources: input.sources.map((source, index) => ({
                label: `S${index + 1}`,
                ...source,
                text: source.text.slice(0, 1800)
              }))
            },
            null,
            2
          )
        }
      ],
      true
    );
    if (!content) return null;
    try {
      return normalizeCollegeKnowledgeAnswer(JSON.parse(content) as Record<string, unknown>, new Set(input.sources.map((source) => source.id)));
    } catch {
      return null;
    }
  }

  async extractMessageAgentTemplate(input: MessageAgentTemplateExtractionInput): Promise<MessageAgentTemplateExtraction | null> {
    const content = await this.chat(
      this.textProvider,
      [
        {
          role: "system",
          content:
            "你是书院办公室邮件模板抽取助手。只基于样例文本抽取可复用模板，不要补充未出现的政策细节。只输出 JSON：{category,title,language,audience,subjectPattern,bodySkeleton,requiredSlots,optionalSlots,tone,signatureStyle}。requiredSlots/optionalSlots 是 {key,label,description} 数组。"
        },
        {
          role: "user",
          content: JSON.stringify(
            {
              sourceTitle: input.sourceTitle,
              categoryHint: input.categoryHint,
              text: input.text.slice(0, 6000)
            },
            null,
            2
          )
        }
      ],
      true,
      30_000
    );
    if (!content) return null;
    try {
      return normalizeMessageAgentTemplateExtraction(JSON.parse(content) as Record<string, unknown>, input);
    } catch {
      return null;
    }
  }

  async classifyMessageAgentRequest(input: MessageAgentClassificationInput): Promise<MessageAgentClassification | null> {
    const content = await this.chat(
      this.textProvider,
      [
        {
          role: "system",
          content:
            "你是书院邮件写作意图分类助手。只输出 JSON：{category,language,audience,intent,urgency}。category 必须为 facility_notice,youth_league,electricity_subsidy,function_room,property_staff,bfmo_coordination,recommendation_letter,event_registration,format_reminder,general_reply 之一。不要编造事实。"
        },
        {
          role: "user",
          content: JSON.stringify({ message: input.message, context: input.context.slice(0, 6000) }, null, 2)
        }
      ],
      true
    );
    if (!content) return null;
    try {
      return normalizeMessageAgentClassification(JSON.parse(content) as Record<string, unknown>);
    } catch {
      return null;
    }
  }

  async planMessageAgentDraft(input: MessageAgentDraftPlanInput): Promise<MessageAgentDraftPlan | null> {
    const content = await this.chat(
      this.textProvider,
      [
        {
          role: "system",
          content:
            "你是书院邮件写作信息完整性检查助手。只基于用户消息、上下文和候选模板判断缺失信息。不要生成邮件正文。只输出 JSON：{ready,missingSlots,questions,attachmentSuggestions}。如果关键信息缺失，ready=false 并提出简短追问。"
        },
        {
          role: "user",
          content: JSON.stringify(
            {
              message: input.message,
              context: input.context.slice(0, 6000),
              category: input.category,
              templates: input.templates.map((template) => ({ ...template, bodySkeleton: template.bodySkeleton.slice(0, 1800) }))
            },
            null,
            2
          )
        }
      ],
      true
    );
    if (!content) return null;
    try {
      return normalizeMessageAgentDraftPlan(JSON.parse(content) as Record<string, unknown>);
    } catch {
      return null;
    }
  }

  async generateMessageAgentDraft(input: MessageAgentDraftGenerationInput): Promise<MessageAgentDraftGeneration | null> {
    const content = await this.chat(
      this.textProvider,
      [
        {
          role: "system",
          content:
            "你是祥波书院办公室邮件写作助手。只基于用户提供信息和候选模板生成可编辑草稿，不得编造政策、日期、地点、联系人、附件名或承诺。输出纯 JSON：{subject,body,attachmentSuggestions,warnings}。body 为纯文本邮件正文，保留自然换行，不要 Markdown。"
        },
        {
          role: "user",
          content: JSON.stringify(
            {
              message: input.message,
              context: input.context.slice(0, 8000),
              category: input.category,
              language: input.language,
              audience: input.audience,
              templates: input.templates.map((template) => ({ ...template, bodySkeleton: template.bodySkeleton.slice(0, 2500) }))
            },
            null,
            2
          )
        }
      ],
      true
    );
    if (!content) return null;
    try {
      return normalizeMessageAgentDraftGeneration(JSON.parse(content) as Record<string, unknown>);
    } catch {
      return null;
    }
  }

  async describeMessageAgentImage(input: { filePath: string; contentType: string }): Promise<string | null> {
    const buffer = await readFile(input.filePath);
    const dataUrl = `data:${input.contentType};base64,${buffer.toString("base64")}`;
    return this.chat(this.visionProvider, [
      {
        role: "system",
        content:
          "你是邮件写作 Agent 的图片理解助手。请提取图片里的邮件内容、截图文字、称呼、日期、地点、要求和附件提示；不要代表用户写邮件，不要编造看不见的信息。"
      },
      {
        role: "user",
        content: [
          { type: "text", text: "请提取这张图片中可用于邮件写作的事实信息。" },
          { type: "image_url", image_url: { url: dataUrl } }
        ]
      }
    ]);
  }
}

export type OpenAiProviderConfig = {
  apiKey: string;
  baseUrl: string;
  model: string;
  modelSelector?: () => Promise<string> | string;
};

function normalizeProvider(provider: OpenAiProviderConfig): OpenAiProviderConfig {
  return {
    ...provider,
    baseUrl: provider.baseUrl.replace(/\/$/, "")
  };
}

async function resolveProviderModel(provider: OpenAiProviderConfig): Promise<string> {
  const selected = provider.modelSelector ? await provider.modelSelector() : provider.model;
  return selected.trim() || provider.model;
}

function normalizeScholarshipVerification(value: Record<string, unknown>): ScholarshipEvidenceVerification {
  return {
    supported: value.supported === true,
    confidence: clampConfidence(value.confidence),
    summary: typeof value.summary === "string" ? value.summary : "",
    issues: stringArray(value.issues),
    matchedItems: stringArray(value.matchedItems),
    missingItems: stringArray(value.missingItems)
  };
}

function normalizeAwardConfidenceEvaluation(value: Record<string, unknown>): AwardConfidenceTextEvaluation {
  const rawScores = isRecord(value.fieldScores) ? value.fieldScores : {};
  const fields: AwardConfidenceTextField[] = [
    "personalStatement",
    "collegeContribution",
    "servicePractice",
    "dormService",
    "academic",
    "studentOrg",
    "awardsGeneral",
    "sports",
    "artsTalent"
  ];
  const fieldScores: Partial<Record<AwardConfidenceTextField, number>> = {};
  for (const field of fields) {
    fieldScores[field] = clampConfidence(rawScores[field]);
  }
  const riskPenalty = Math.max(0, Math.min(0.35, Number(value.riskPenalty ?? 0) || 0));
  return {
    fieldScores,
    riskPenalty,
    summary: typeof value.summary === "string" ? value.summary : ""
  };
}

function normalizeCollegeKnowledgeRerank(value: Record<string, unknown>, allowedIds: Set<string>): CollegeKnowledgeRerankResult {
  const selectedIds = uniqueStrings(value.selectedIds).filter((id) => allowedIds.has(id)).slice(0, 8);
  const rawReasons = isRecord(value.reasons) ? value.reasons : {};
  const reasons: Record<string, string> = {};
  for (const id of selectedIds) {
    const reason = rawReasons[id];
    if (typeof reason === "string" && reason.trim()) reasons[id] = reason.trim();
  }
  return { selectedIds, reasons };
}

function normalizeCollegeKnowledgeAnswer(value: Record<string, unknown>, allowedIds: Set<string>): CollegeKnowledgeAnswerResult {
  const sourceIds = uniqueStrings(value.sourceIds).filter((id) => allowedIds.has(id));
  return {
    answerable: value.answerable === true,
    answer: typeof value.answer === "string" ? value.answer.trim() : "",
    sourceIds,
    warnings: stringArray(value.warnings)
  };
}

const messageAgentCategories: MessageAgentTemplateCategory[] = [
  "facility_notice",
  "youth_league",
  "electricity_subsidy",
  "function_room",
  "property_staff",
  "bfmo_coordination",
  "recommendation_letter",
  "event_registration",
  "format_reminder",
  "general_reply"
];

function normalizeMessageAgentTemplateExtraction(
  value: Record<string, unknown>,
  fallback: MessageAgentTemplateExtractionInput
): MessageAgentTemplateExtraction {
  return {
    category: messageAgentCategory(value.category, fallback.categoryHint),
    title: typeof value.title === "string" && value.title.trim() ? value.title.trim() : fallback.sourceTitle,
    language: messageAgentLanguage(value.language),
    audience: messageAgentAudience(value.audience),
    subjectPattern: typeof value.subjectPattern === "string" && value.subjectPattern.trim() ? value.subjectPattern.trim() : null,
    bodySkeleton: typeof value.bodySkeleton === "string" && value.bodySkeleton.trim() ? value.bodySkeleton.trim() : fallback.text.slice(0, 4000),
    requiredSlots: slotArray(value.requiredSlots),
    optionalSlots: slotArray(value.optionalSlots),
    tone: typeof value.tone === "string" && value.tone.trim() ? value.tone.trim() : "polite college-office tone",
    signatureStyle: typeof value.signatureStyle === "string" && value.signatureStyle.trim() ? value.signatureStyle.trim() : null
  };
}

function normalizeMessageAgentClassification(value: Record<string, unknown>): MessageAgentClassification {
  const urgency = typeof value.urgency === "string" && ["low", "normal", "high"].includes(value.urgency) ? value.urgency : "normal";
  return {
    category: messageAgentCategory(value.category, "general_reply"),
    language: messageAgentLanguage(value.language),
    audience: messageAgentAudience(value.audience),
    intent: typeof value.intent === "string" ? value.intent.trim() : "",
    urgency: urgency as MessageAgentClassification["urgency"]
  };
}

function normalizeMessageAgentDraftPlan(value: Record<string, unknown>): MessageAgentDraftPlan {
  return {
    ready: value.ready === true,
    missingSlots: slotArray(value.missingSlots),
    questions: questionArray(value.questions),
    attachmentSuggestions: stringArray(value.attachmentSuggestions)
  };
}

function normalizeMessageAgentDraftGeneration(value: Record<string, unknown>): MessageAgentDraftGeneration {
  return {
    subject: typeof value.subject === "string" ? value.subject.trim() : "",
    body: typeof value.body === "string" ? value.body.trim() : "",
    attachmentSuggestions: stringArray(value.attachmentSuggestions),
    warnings: stringArray(value.warnings)
  };
}

function messageAgentCategory(value: unknown, fallback: MessageAgentTemplateCategory): MessageAgentTemplateCategory {
  return typeof value === "string" && messageAgentCategories.includes(value as MessageAgentTemplateCategory)
    ? (value as MessageAgentTemplateCategory)
    : fallback;
}

function messageAgentLanguage(value: unknown): MessageAgentLanguage {
  return typeof value === "string" && ["zh", "en", "bilingual", "mixed"].includes(value) ? (value as MessageAgentLanguage) : "zh";
}

function messageAgentAudience(value: unknown): MessageAgentAudience {
  return typeof value === "string" && ["student", "teachers_students", "department", "recommender", "staff", "unknown"].includes(value)
    ? (value as MessageAgentAudience)
    : "unknown";
}

function slotArray(value: unknown): MessageAgentSlot[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!isRecord(item)) return null;
      const key = typeof item.key === "string" ? item.key.trim() : "";
      const label = typeof item.label === "string" ? item.label.trim() : key;
      if (!key || !label) return null;
      const slot: MessageAgentSlot = { key, label };
      if (typeof item.description === "string" && item.description.trim()) slot.description = item.description.trim();
      return slot;
    })
    .filter((item): item is MessageAgentSlot => Boolean(item));
}

function questionArray(value: unknown): Array<{ slotKey: string; question: string; required: boolean }> {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!isRecord(item)) return null;
      const slotKey = typeof item.slotKey === "string" ? item.slotKey.trim() : "";
      const question = typeof item.question === "string" ? item.question.trim() : "";
      if (!slotKey || !question) return null;
      return { slotKey, question, required: item.required !== false };
    })
    .filter((item): item is { slotKey: string; question: string; required: boolean } => Boolean(item));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clampConfidence(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(1, numeric));
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter(Boolean);
}

function uniqueStrings(value: unknown): string[] {
  return [...new Set(stringArray(value))];
}
