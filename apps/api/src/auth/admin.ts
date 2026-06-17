import type { Env } from "../config/env.js";
import type { AppRepository } from "../db/repository.js";
import { hashPassword } from "./session.js";

type AdminAccount = {
  email: string;
  password: string;
};

export function configuredAdminUsers(env: Pick<Env, "ADMIN_EMAIL" | "ADMIN_PASSWORD" | "ADMIN_USERS">): AdminAccount[] {
  const users = new Map<string, AdminAccount>();
  for (const account of [{ email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD }, ...env.ADMIN_USERS]) {
    users.set(account.email.toLowerCase(), account);
  }
  return [...users.values()];
}

export async function ensureConfiguredAdminUsers(repo: AppRepository, env: Pick<Env, "ADMIN_EMAIL" | "ADMIN_PASSWORD" | "ADMIN_USERS">) {
  for (const account of configuredAdminUsers(env)) {
    await repo.ensureAdminUser(account.email, await hashPassword(account.password));
  }
}
