import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

function safeSegment(input: string): string {
  return input.replace(/[^\w.-]+/g, "_").slice(0, 120) || "item";
}

export async function saveAttachmentFile(input: {
  rootDir: string;
  mailboxAddress: string;
  messageId: string;
  attachmentId: string;
  fileName: string;
  data: Buffer;
}): Promise<string> {
  const folder = join(input.rootDir, safeSegment(input.mailboxAddress), safeSegment(input.messageId));
  await mkdir(folder, { recursive: true });
  const path = join(folder, `${safeSegment(input.attachmentId)}-${safeSegment(input.fileName)}`);
  await writeFile(path, input.data);
  return path;
}
