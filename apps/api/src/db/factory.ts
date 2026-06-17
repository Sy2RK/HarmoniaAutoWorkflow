import type { Env } from "../config/env.js";
import type { AppRepository } from "./repository.js";
import { PostgresRepository } from "./postgres.js";
import { SQLiteRepository } from "./sqlite.js";

export async function createRepository(env: Env): Promise<AppRepository> {
  if (env.DB_DRIVER === "postgres") {
    return new PostgresRepository(env.DATABASE_URL, env.GRAPH_MAILBOX_ADDRESS);
  }
  return SQLiteRepository.open(env.SQLITE_DB_PATH, env.GRAPH_MAILBOX_ADDRESS);
}
