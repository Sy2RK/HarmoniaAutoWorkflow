import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, normalize, resolve, sep } from "node:path";

export const defaultMessageAgentStorageRoot = "storage/message-agent";

export function messageAgentStorageRoot(storageRoot = defaultMessageAgentStorageRoot): string {
  return isAbsolute(storageRoot) ? storageRoot : resolve(findWorkspaceRoot(), storageRoot);
}

export function sessionRoot(storageRoot: string, sessionId: string): string {
  return join(storageRoot, "sessions", sessionId);
}

export function sessionJsonPath(storageRoot: string, sessionId: string): string {
  return join(sessionRoot(storageRoot, sessionId), "session.json");
}

export function sessionInputDir(storageRoot: string, sessionId: string): string {
  return join(sessionRoot(storageRoot, sessionId), "input");
}

export function sessionGeneratedDir(storageRoot: string, sessionId: string): string {
  return join(sessionRoot(storageRoot, sessionId), "generated");
}

export async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return null;
  }
}

export async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2), "utf8");
}

export async function cleanupPaths(paths: string[]): Promise<void> {
  await Promise.all(paths.map((path) => rm(path, { recursive: true, force: true }).catch(() => undefined)));
}

export function safeFileName(rawName: string): string {
  const baseName = basename(rawName.replace(/\\/g, "/")) || "upload";
  const safe = baseName.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").replace(/^\.+$/, "_").slice(0, 180);
  return safe || `upload-${randomUUID()}`;
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

export function safeStoredPath(root: string, fileName: string, relativePath: string | null): string {
  const safeRelative = sanitizeRelativePath(relativePath);
  const leafName = safeFileName(fileName);
  if (!safeRelative) return join(root, leafName);
  const segments = safeRelative.split("/").filter(Boolean).map(safePathSegment);
  const last = segments.at(-1);
  if (!last || last.toLowerCase() !== leafName.toLowerCase()) segments.push(leafName);
  const candidate = resolve(root, ...segments);
  const resolvedRoot = resolve(root);
  if (candidate !== resolvedRoot && candidate.startsWith(`${resolvedRoot}${sep}`)) return candidate;
  return join(root, leafName);
}

export function isIgnorableUploadName(fileName: string, relativePath?: string | null): boolean {
  const name = basename((relativePath || fileName).replace(/\\/g, "/")).trim();
  return !name || name.startsWith("~$") || name === ".DS_Store" || name === "Thumbs.db" || name === "desktop.ini";
}

export function contentTypeFromName(fileName: string, fallback: string | null): string | null {
  const explicit = fallback?.split(";")[0]?.trim() || "";
  if (explicit && explicit !== "application/octet-stream") return explicit;
  switch (extname(fileName).toLowerCase()) {
    case ".pdf":
      return "application/pdf";
    case ".docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
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
