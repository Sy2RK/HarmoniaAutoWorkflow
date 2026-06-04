import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  InteractionRequiredAuthError,
  PublicClientApplication,
  type AccountInfo,
  type Configuration
} from "@azure/msal-node";

export const graphScopes = ["User.Read", "Mail.ReadWrite.Shared", "Mail.Send.Shared", "offline_access"];

export type GraphAuthConfig = {
  tenantId: string;
  clientId: string;
  tokenCachePath: string;
};

function msalConfig(config: GraphAuthConfig): Configuration {
  return {
    auth: {
      clientId: config.clientId,
      authority: `https://login.microsoftonline.com/${config.tenantId}`
    }
  };
}

async function hydrateCache(app: PublicClientApplication, tokenCachePath: string): Promise<void> {
  try {
    const serialized = await readFile(tokenCachePath, "utf8");
    app.getTokenCache().deserialize(serialized);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

async function persistCache(app: PublicClientApplication, tokenCachePath: string): Promise<void> {
  await mkdir(dirname(tokenCachePath), { recursive: true });
  await writeFile(tokenCachePath, app.getTokenCache().serialize(), "utf8");
}

export async function createGraphPublicClient(config: GraphAuthConfig): Promise<PublicClientApplication> {
  if (!config.clientId) {
    throw new Error("GRAPH_CLIENT_ID is required for Microsoft Graph access.");
  }
  const app = new PublicClientApplication(msalConfig(config));
  await hydrateCache(app, config.tokenCachePath);
  return app;
}

export async function getGraphAccessToken(config: GraphAuthConfig): Promise<string> {
  const app = await createGraphPublicClient(config);
  const accounts = await app.getTokenCache().getAllAccounts();
  const account = accounts[0];
  if (!account) {
    throw new Error("Graph token cache is empty. Run `pnpm --filter @harmonia/api graph:login` first.");
  }
  try {
    const result = await app.acquireTokenSilent({ account, scopes: graphScopes });
    if (!result?.accessToken) throw new Error("Graph silent token acquisition returned no access token.");
    await persistCache(app, config.tokenCachePath);
    return result.accessToken;
  } catch (error) {
    if (error instanceof InteractionRequiredAuthError) {
      throw new Error("Graph token needs interaction. Run `pnpm --filter @harmonia/api graph:login` again.");
    }
    throw error;
  }
}

export async function runDeviceCodeLogin(config: GraphAuthConfig, onMessage: (message: string) => void): Promise<AccountInfo> {
  const app = await createGraphPublicClient(config);
  const result = await app.acquireTokenByDeviceCode({
    scopes: graphScopes,
    deviceCodeCallback: (response) => onMessage(response.message)
  });
  if (!result?.account) {
    throw new Error("Device code login finished without account information.");
  }
  await persistCache(app, config.tokenCachePath);
  return result.account;
}
