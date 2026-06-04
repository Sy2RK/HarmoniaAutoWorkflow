import { env } from "./config/env.js";
import { PostgresRepository } from "./db/postgres.js";
import { hashPassword } from "./auth/session.js";
import { MicrosoftGraphMailClient } from "./graph/client.js";
import { GraphOutboundMailer } from "./mail/outbound.js";
import { NoopAiClient, OpenAiCompatibleClient } from "./ai/client.js";
import { buildApp } from "./app.js";
import { startSyncWorker } from "./worker/sync.js";

const repo = new PostgresRepository(env.DATABASE_URL, env.GRAPH_MAILBOX_ADDRESS);
await repo.migrate();
await repo.ensureAdminUser(env.ADMIN_EMAIL, await hashPassword(env.ADMIN_PASSWORD));

const settings = await repo.getSettings();
if ((env.GRAPH_MAILBOX_ADDRESS && settings.mailboxAddress !== env.GRAPH_MAILBOX_ADDRESS) || (env.GRAPH_SYNC_ENABLED && !settings.mailSyncEnabled)) {
  await repo.saveSettings({
    ...settings,
    mailboxAddress: env.GRAPH_MAILBOX_ADDRESS || settings.mailboxAddress,
    mailSyncEnabled: settings.mailSyncEnabled || env.GRAPH_SYNC_ENABLED
  });
}

const graph = new MicrosoftGraphMailClient({
  tenantId: env.GRAPH_TENANT_ID,
  clientId: env.GRAPH_CLIENT_ID,
  tokenCachePath: env.GRAPH_TOKEN_CACHE_PATH
});
const mailer = new GraphOutboundMailer(graph, env.MAIL_SENDING_ENABLED);
const textApiKey = env.OPENAI_TEXT_API_KEY || env.OPENAI_API_KEY;
const textBaseUrl = env.OPENAI_TEXT_BASE_URL || env.OPENAI_BASE_URL;
const visionApiKey = env.OPENAI_VISION_API_KEY || env.OPENAI_API_KEY;
const visionBaseUrl = env.OPENAI_VISION_BASE_URL || env.OPENAI_BASE_URL;
const ai =
  env.AI_ENABLED && textApiKey && visionApiKey
    ? new OpenAiCompatibleClient({
        text: {
          apiKey: textApiKey,
          baseUrl: textBaseUrl,
          model: env.OPENAI_TEXT_MODEL
        },
        vision: {
          apiKey: visionApiKey,
          baseUrl: visionBaseUrl,
          model: env.OPENAI_VISION_MODEL
        }
      })
    : new NoopAiClient();

const app = await buildApp({ env, repo, ai, mailer, graph, attachmentRoot: env.ATTACHMENT_STORAGE_DIR });

startSyncWorker({ repo, graph, ai, mailer, attachmentRoot: env.ATTACHMENT_STORAGE_DIR }, env.GRAPH_SYNC_INTERVAL_SECONDS);

const close = async () => {
  await app.close();
  await repo.close();
  process.exit(0);
};
process.on("SIGINT", () => void close());
process.on("SIGTERM", () => void close());

await app.listen({ host: "0.0.0.0", port: env.PORT });
