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

export interface AiClient {
  classify(input: { subject: string; bodyText: string }): Promise<MailCategory | null>;
  extractJson(input: { task: string; subject: string; bodyText: string }): Promise<Record<string, unknown> | null>;
  generateReply(input: { subject: string; bodyText: string; facts: string; constraints: string[] }): Promise<string | null>;
  extractAwardFromImage(input: { filePath: string; contentType: string }): Promise<AwardInfo | null>;
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
}

export class OpenAiCompatibleClient implements AiClient {
  private readonly textProvider: OpenAiProviderConfig;
  private readonly visionProvider: OpenAiProviderConfig;

  constructor(config: { text: OpenAiProviderConfig; vision: OpenAiProviderConfig }) {
    this.textProvider = normalizeProvider(config.text);
    this.visionProvider = normalizeProvider(config.vision);
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
