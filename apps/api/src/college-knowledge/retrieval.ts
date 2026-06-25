import type { CollegeKnowledgeDocument } from "@harmonia/shared";
import type { CollegeKnowledgeChunkRecord } from "../db/repository.js";
import type { IndexedKnowledgeChunk } from "./types.js";

const cjkPattern = /[\u3400-\u9FFF]/;

export function retrieveCollegeKnowledge(input: {
  question: string;
  imageText: string | null;
  documents: CollegeKnowledgeDocument[];
  chunks: CollegeKnowledgeChunkRecord[];
  limit?: number;
}): IndexedKnowledgeChunk[] {
  const queryText = [input.question, input.imageText].filter(Boolean).join("\n");
  const queryTokens = tokenize(queryText);
  if (queryTokens.length === 0) return [];
  const querySet = new Set(queryTokens);
  const documentById = new Map(input.documents.map((document) => [document.id, document]));
  return input.chunks
    .map((chunk) => {
      const document = documentById.get(chunk.documentId);
      if (!document || !["ready", "partial"].includes(document.status)) return null;
      const score = scoreChunk(querySet, queryText, chunk);
      if (score <= 0) return null;
      return {
        id: chunk.id,
        documentId: chunk.documentId,
        documentName: document.fileName,
        relativePath: document.relativePath,
        title: chunk.title,
        locator: chunk.locator,
        sourcePath: chunk.sourcePath,
        text: chunk.text,
        markdown: chunk.markdown,
        metadata: chunk.metadata,
        lexicalScore: score
      } satisfies IndexedKnowledgeChunk;
    })
    .filter((item): item is IndexedKnowledgeChunk => Boolean(item))
    .toSorted((a, b) => b.lexicalScore - a.lexicalScore)
    .slice(0, input.limit ?? 40);
}

export function snippetFor(text: string, query: string, maxLength = 220): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  const tokens = tokenize(query);
  const lower = normalized.toLowerCase();
  const token = tokens.find((item) => lower.includes(item.toLowerCase()));
  const index = token ? lower.indexOf(token.toLowerCase()) : 0;
  const start = Math.max(0, index - Math.floor(maxLength / 3));
  const end = Math.min(normalized.length, start + maxLength);
  return `${start > 0 ? "..." : ""}${normalized.slice(start, end)}${end < normalized.length ? "..." : ""}`;
}

function scoreChunk(queryTokens: Set<string>, queryText: string, chunk: CollegeKnowledgeChunkRecord): number {
  const text = [chunk.title, chunk.locator, chunk.text].filter(Boolean).join("\n");
  const chunkTokens = tokenize(text);
  const chunkCounts = new Map<string, number>();
  for (const token of chunkTokens) chunkCounts.set(token, (chunkCounts.get(token) ?? 0) + 1);
  let score = 0;
  for (const token of queryTokens) {
    const count = chunkCounts.get(token) ?? 0;
    if (count > 0) score += 1 + Math.log2(1 + count);
  }
  const normalizedText = compact(text);
  const normalizedQuery = compact(queryText);
  if (normalizedQuery.length >= 4 && normalizedText.includes(normalizedQuery.slice(0, 40))) score += 6;
  for (const phrase of extractPhrases(queryText)) {
    if (compact(phrase).length >= 4 && normalizedText.includes(compact(phrase))) score += 3;
  }
  return score / Math.sqrt(Math.max(1, chunkTokens.length / 80));
}

function tokenize(value: string): string[] {
  const normalized = value.toLowerCase();
  const tokens: string[] = [];
  for (const match of normalized.matchAll(/[a-z0-9_]{2,}/g)) tokens.push(match[0]);
  const cjkChars = [...normalized].filter((char) => cjkPattern.test(char));
  for (const char of cjkChars) tokens.push(char);
  for (let index = 0; index < cjkChars.length - 1; index += 1) tokens.push(`${cjkChars[index]}${cjkChars[index + 1]}`);
  for (let index = 0; index < cjkChars.length - 2; index += 1) tokens.push(`${cjkChars[index]}${cjkChars[index + 1]}${cjkChars[index + 2]}`);
  return tokens.filter((token) => !isStopToken(token));
}

function extractPhrases(value: string): string[] {
  return value
    .split(/[\n。；;？！?，,、]/g)
    .map((item) => item.trim())
    .filter((item) => item.length >= 4)
    .slice(0, 8);
}

function compact(value: string): string {
  return value.toLowerCase().replace(/\s+/g, "");
}

function isStopToken(token: string): boolean {
  return ["的", "了", "是", "和", "与", "及", "或", "在", "我", "你", "他", "她", "它", "请", "问", "怎么", "如何"].includes(token);
}
