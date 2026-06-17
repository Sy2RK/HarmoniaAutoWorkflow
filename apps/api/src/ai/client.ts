import { readFile } from "node:fs/promises";
import type { MailCategory } from "@harmonia/shared";

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

export interface AiClient {
  classify(input: { subject: string; bodyText: string }): Promise<MailCategory | null>;
  extractJson(input: { task: string; subject: string; bodyText: string }): Promise<Record<string, unknown> | null>;
  generateReply(input: { subject: string; bodyText: string; facts: string; constraints: string[] }): Promise<string | null>;
  extractAwardFromImage(input: { filePath: string; contentType: string }): Promise<AwardInfo | null>;
  verifyScholarshipEvidence(input: ScholarshipEvidenceVerificationInput): Promise<ScholarshipEvidenceVerification | null>;
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

  private async chat(provider: OpenAiProviderConfig, messages: unknown[], json = false): Promise<string | null> {
    const response = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${provider.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: provider.model,
        messages,
        temperature: 0.1,
        response_format: json ? { type: "json_object" } : undefined
      })
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`OpenAI-compatible request failed ${response.status}: ${text}`);
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
      this.scholarshipProvider,
      [
        {
          role: "system",
          content:
            "你是高校奖学金/优秀毕业生证明材料核验员。你必须只基于用户提供的申报文本和证明材料图片判断，不得编造。只输出 JSON，字段为 supported, confidence, summary, issues, matchedItems, missingItems。confidence 为 0 到 1。issues、matchedItems、missingItems 必须是字符串数组。"
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
                "请判断这些证明页是否支持申报内容。若发现姓名、日期、角色、组织、奖项、颁发单位不一致，请在 issues 中具体说明。若只能支持部分条目，请在 matchedItems 与 missingItems 中列出。"
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
}

export type OpenAiProviderConfig = {
  apiKey: string;
  baseUrl: string;
  model: string;
};

function normalizeProvider(provider: OpenAiProviderConfig): OpenAiProviderConfig {
  return {
    ...provider,
    baseUrl: provider.baseUrl.replace(/\/$/, "")
  };
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

function clampConfidence(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(1, numeric));
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter(Boolean);
}
