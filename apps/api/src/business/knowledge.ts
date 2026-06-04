import type { KnowledgeEntry } from "@harmonia/shared";

function normalize(input: string): string {
  return input.toLowerCase().replace(/[^\p{Letter}\p{Number}]+/gu, "");
}

function bigrams(input: string): Set<string> {
  const text = normalize(input);
  const tokens = new Set<string>();
  for (let index = 0; index < text.length - 1; index += 1) {
    tokens.add(text.slice(index, index + 2));
  }
  return tokens;
}

function scoreEntry(query: string, entry: KnowledgeEntry): number {
  if (!entry.enabled) return 0;
  const normalizedQuery = normalize(query);
  const normalizedQuestion = normalize(entry.question);
  if (normalizedQuestion && normalizedQuery.includes(normalizedQuestion)) return 1;
  const queryTokens = bigrams(query);
  const entryTokens = bigrams(entry.question);
  if (!entryTokens.size) return 0;
  let overlap = 0;
  for (const token of entryTokens) {
    if (queryTokens.has(token)) overlap += 1;
  }
  return overlap / entryTokens.size;
}

export function findKnowledgeAnswer(query: string, entries: KnowledgeEntry[]): KnowledgeEntry | null {
  const ranked = entries
    .map((entry) => ({ entry, score: scoreEntry(query, entry) }))
    .filter((item) => item.score >= 0.35)
    .toSorted((a, b) => b.score - a.score);
  return ranked[0]?.entry ?? null;
}
