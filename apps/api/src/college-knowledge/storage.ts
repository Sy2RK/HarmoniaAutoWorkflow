import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, normalize, resolve, sep } from "node:path";

export const defaultCollegeKnowledgeStorageRoot = "storage/college-knowledge";

export function collegeKnowledgeStorageRoot(storageRoot = defaultCollegeKnowledgeStorageRoot): string {
  return isAbsolute(storageRoot) ? storageRoot : resolve(findWorkspaceRoot(), storageRoot);
}

export function documentRoot(storageRoot: string, documentId: string): string {
  return join(storageRoot, "documents", documentId);
}

export function documentOriginalDir(storageRoot: string, documentId: string): string {
  return join(documentRoot(storageRoot, documentId), "original");
}

export function extractedMarkdownPath(storageRoot: string, documentId: string): string {
  return join(documentRoot(storageRoot, documentId), "extracted.md");
}

export function metadataPath(storageRoot: string, documentId: string): string {
  return join(documentRoot(storageRoot, documentId), "metadata.json");
}

export async function ensureDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

export async function sha256File(path: string): Promise<string> {
  const buffer = await readFile(path);
  return createHash("sha256").update(buffer).digest("hex");
}

export async function writeUtf8(path: string, value: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, value, "utf8");
}

export async function writeJson(path: string, value: unknown): Promise<void> {
  await writeUtf8(path, JSON.stringify(value, null, 2));
}

export async function cleanupPaths(paths: string[]): Promise<void> {
  await Promise.all(paths.map((path) => rm(path, { force: true, recursive: true }).catch(() => undefined)));
}

export function safeFileName(rawName: string): string {
  const baseName = basename(rawName.replace(/\\/g, "/")) || "upload";
  const sanitized = baseName.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").replace(/^\.+$/, "_").slice(0, 180);
  return sanitized || `upload-${randomUUID()}`;
}

export function tempUploadFileName(rawName: string, index: number): string {
  return `${index}-${safeFileName(rawName)}`;
}

export function sanitizeRelativePath(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = normalize(value.replace(/\\/g, "/")).replace(/\\/g, "/");
  if (normalized.startsWith("..") || normalized.includes("../") || normalized.includes(":/")) return null;
  return normalized.split("/").filter(Boolean).map(safePathSegment).join("/") || null;
}

export function safeStoredOriginalPath(originalDir: string, fileName: string, relativePath: string | null): string {
  const safeRelative = sanitizeRelativePath(relativePath);
  const leafName = safeFileName(fileName);
  if (!safeRelative) return join(originalDir, leafName);
  const segments = safeRelative.split("/").filter(Boolean).map(safePathSegment);
  const last = segments.at(-1);
  if (!last || last.toLowerCase() !== leafName.toLowerCase()) segments.push(leafName);
  const candidate = resolve(originalDir, ...segments);
  const root = resolve(originalDir);
  if (candidate !== root && candidate.startsWith(`${root}${sep}`)) return candidate;
  return join(originalDir, leafName);
}

export function isIgnorableUploadName(fileName: string, relativePath?: string | null): boolean {
  const name = basename((relativePath || fileName).replace(/\\/g, "/")).trim();
  if (!name) return true;
  if (name.startsWith("~$")) return true;
  if (name === ".DS_Store" || name === "Thumbs.db" || name === "desktop.ini") return true;
  return false;
}

export function contentTypeFromName(fileName: string, fallback: string | null): string | null {
  const explicit = fallback?.split(";")[0]?.trim() || "";
  if (explicit && explicit !== "application/octet-stream") return explicit;
  switch (extname(fileName).toLowerCase()) {
    case ".pdf":
      return "application/pdf";
    case ".docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case ".pptx":
      return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    case ".xlsx":
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    case ".xls":
      return "application/vnd.ms-excel";
    case ".csv":
      return "text/csv";
    case ".md":
      return "text/markdown";
    case ".txt":
      return "text/plain";
    case ".zip":
      return "application/zip";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    default:
      return explicit || null;
  }
}

export function findWorkspaceRoot(): string {
  let current = process.cwd();
  while (true) {
    if (existsSync(join(current, "pnpm-workspace.yaml"))) return current;
    const parent = dirname(current);
    if (parent === current) return process.cwd();
    current = parent;
  }
}

function safePathSegment(value: string): string {
  return safeFileName(value).replace(/\.+$/, "") || "_";
}
