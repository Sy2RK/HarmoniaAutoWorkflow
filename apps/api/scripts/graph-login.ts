import { env } from "../src/config/env.js";
import { runDeviceCodeLogin } from "../src/graph/auth.js";

const account = await runDeviceCodeLogin(
  {
    tenantId: env.GRAPH_TENANT_ID,
    clientId: env.GRAPH_CLIENT_ID,
    tokenCachePath: env.GRAPH_TOKEN_CACHE_PATH
  },
  (message) => {
    console.log(message);
  }
);

console.log(`Graph login complete: ${account.username}`);
