export type KnowledgeUploadFile = {
  tempPath: string;
  fileName: string;
  contentType: string | null;
  relativePath: string | null;
};

export type ParsedKnowledgeChunk = {
  title: string | null;
  locator: string;
  sourcePath: string | null;
  text: string;
  markdown: string;
  metadata: Record<string, unknown>;
};

export type ParsedKnowledgeDocument = {
  markdown: string;
  chunks: ParsedKnowledgeChunk[];
  metadata: Record<string, unknown>;
  warnings: string[];
};

export type IndexedKnowledgeChunk = ParsedKnowledgeChunk & {
  id: string;
  documentId: string;
  documentName: string;
  relativePath: string | null;
  lexicalScore: number;
};
