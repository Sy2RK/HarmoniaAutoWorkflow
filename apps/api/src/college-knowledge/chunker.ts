import type { ParsedKnowledgeChunk } from "./types.js";

const targetChunkLength = 1200;
const overlapLength = 160;

export function chunkMarkdown(markdown: string, options: { sourcePath: string | null; locatorPrefix: string; defaultTitle?: string | null }): ParsedKnowledgeChunk[] {
  const sections = splitMarkdownSections(markdown, options.defaultTitle ?? null);
  const chunks: ParsedKnowledgeChunk[] = [];
  for (const section of sections) {
    const normalized = normalizeWhitespace(section.text);
    if (!normalized) continue;
    const parts = splitLongText(normalized, targetChunkLength, overlapLength);
    parts.forEach((part, index) => {
      const locator = parts.length > 1 ? `${options.locatorPrefix} chunk ${index + 1}` : options.locatorPrefix;
      const heading = section.title ? `### ${section.title}\n\n` : "";
      chunks.push({
        title: section.title,
        locator,
        sourcePath: options.sourcePath,
        text: part,
        markdown: `${heading}${part}`,
        metadata: { sectionTitle: section.title, part: index + 1, partCount: parts.length }
      });
    });
  }
  return chunks;
}

export function estimateTokenCount(value: string): number {
  const asciiWords = value.match(/[A-Za-z0-9_]+/g)?.length ?? 0;
  const cjkChars = value.match(/[\u3400-\u9FFF]/g)?.length ?? 0;
  const other = Math.ceil(value.replace(/[A-Za-z0-9_\u3400-\u9FFF]/g, "").trim().length / 4);
  return Math.max(1, asciiWords + cjkChars + other);
}

export function normalizeWhitespace(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/\t/g, " ")
    .replace(/[ \u00A0]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function splitMarkdownSections(markdown: string, defaultTitle: string | null): Array<{ title: string | null; text: string }> {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const sections: Array<{ title: string | null; lines: string[] }> = [];
  let current: { title: string | null; lines: string[] } = { title: defaultTitle, lines: [] };
  for (const line of lines) {
    const heading = /^(#{1,4})\s+(.+?)\s*$/.exec(line);
    if (heading && current.lines.some((item) => item.trim())) {
      sections.push(current);
      current = { title: heading[2]?.trim() || defaultTitle, lines: [line] };
    } else {
      if (heading) current.title = heading[2]?.trim() || current.title;
      current.lines.push(line);
    }
  }
  sections.push(current);
  return sections.map((section) => ({ title: section.title, text: section.lines.join("\n") }));
}

function splitLongText(value: string, maxLength: number, overlap: number): string[] {
  if (value.length <= maxLength) return [value];
  const parts: string[] = [];
  let start = 0;
  while (start < value.length) {
    const hardEnd = Math.min(value.length, start + maxLength);
    const breakAt = chooseBreak(value, start, hardEnd);
    const part = value.slice(start, breakAt).trim();
    if (part) parts.push(part);
    if (breakAt >= value.length) break;
    start = Math.max(start + 1, breakAt - overlap);
  }
  return parts;
}

function chooseBreak(value: string, start: number, hardEnd: number): number {
  if (hardEnd >= value.length) return value.length;
  const window = value.slice(start, hardEnd);
  const candidates = ["\n\n", "\n", "。", "；", ";", ".", " "];
  for (const marker of candidates) {
    const index = window.lastIndexOf(marker);
    if (index > Math.floor(window.length * 0.55)) return start + index + marker.length;
  }
  return hardEnd;
}
