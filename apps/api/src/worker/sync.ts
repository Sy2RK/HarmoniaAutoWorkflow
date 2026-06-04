import type { AiClient } from "../ai/client.js";
import type { AppRepository, MessageInput } from "../db/repository.js";
import type { GraphMailClient } from "../graph/client.js";
import type { OutboundMailer } from "../mail/outbound.js";
import { processMessage } from "../business/processor.js";
import { saveAttachmentFile } from "../storage/attachments.js";

export type SyncOptions = {
  repo: AppRepository;
  graph: GraphMailClient;
  ai: AiClient;
  mailer: OutboundMailer;
  attachmentRoot: string;
};

async function downloadAttachments(options: SyncOptions, message: MessageInput, persistedId: string): Promise<void> {
  if (!message.hasAttachments) return;
  const attachments = await options.graph.listAttachments(message.mailboxAddress, message.graphMessageId);
  for (const attachment of attachments) {
    if (!attachment.isFile) continue;
    const data = await options.graph.downloadAttachment(message.mailboxAddress, message.graphMessageId, attachment.id);
    const storagePath = await saveAttachmentFile({
      rootDir: options.attachmentRoot,
      mailboxAddress: message.mailboxAddress,
      messageId: persistedId,
      attachmentId: attachment.id,
      fileName: attachment.name,
      data
    });
    await options.repo.addAttachment({
      messageId: persistedId,
      graphAttachmentId: attachment.id,
      name: attachment.name,
      contentType: attachment.contentType,
      size: attachment.size,
      storagePath
    });
  }
}

export async function syncMailbox(options: SyncOptions): Promise<{ received: number; processed: number }> {
  const settings = await options.repo.getSettings();
  if (!settings.mailSyncEnabled || !settings.mailboxAddress) return { received: 0, processed: 0 };
  const previousDelta = await options.repo.getSyncState(settings.mailboxAddress);
  const delta = await options.graph.listInboxDelta(settings.mailboxAddress, previousDelta);
  let processed = 0;

  for (const message of delta.messages) {
    const persisted = await options.repo.upsertMessage(message);
    await downloadAttachments(options, message, persisted.id);
    if (persisted.processedAt && persisted.status !== "failed") continue;
    try {
      await processMessage(options, persisted);
      processed += 1;
    } catch (error) {
      await options.repo.updateMessageProcessing(persisted.id, {
        status: "failed",
        needsReview: true,
        error: error instanceof Error ? error.message : String(error),
        processedAt: new Date().toISOString()
      });
      await options.repo.addAudit({
        messageId: persisted.id,
        actor: "system",
        action: "process_failed",
        detail: { error: error instanceof Error ? error.message : String(error) }
      });
    }
  }

  if (delta.deltaLink) await options.repo.setSyncState(settings.mailboxAddress, delta.deltaLink);
  return { received: delta.messages.length, processed };
}

export function startSyncWorker(options: SyncOptions, intervalSeconds: number): NodeJS.Timeout {
  const run = () => {
    void syncMailbox(options).catch((error) => {
      console.error("mail sync failed", error);
    });
  };
  run();
  return setInterval(run, intervalSeconds * 1000);
}
