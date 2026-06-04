import { createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import bcrypt from "bcryptjs";
import type { AppRepository, UserRecord } from "../db/repository.js";

const cookieName = "harmonia_session";

type SessionPayload = {
  sub: string;
  email: string;
  role: string;
  exp: number;
};

function base64Url(input: string): string {
  return Buffer.from(input).toString("base64url");
}

function sign(data: string, secret: string): string {
  return createHmac("sha256", secret).update(data).digest("base64url");
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function createSessionToken(user: UserRecord, secret: string): string {
  const payload: SessionPayload = {
    sub: user.id,
    email: user.email,
    role: user.role,
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 12
  };
  const encoded = base64Url(JSON.stringify(payload));
  return `${encoded}.${sign(encoded, secret)}`;
}

export function verifySessionToken(token: string, secret: string): SessionPayload | null {
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return null;
  const expected = sign(encoded, secret);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as SessionPayload;
    return payload.exp >= Math.floor(Date.now() / 1000) ? payload : null;
  } catch {
    return null;
  }
}

export function setSessionCookie(reply: FastifyReply, token: string, secure = false): void {
  reply.setCookie(cookieName, token, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: 60 * 60 * 12
  });
}

export function clearSessionCookie(reply: FastifyReply, secure = false): void {
  reply.clearCookie(cookieName, { path: "/", secure });
}

export function readSession(request: FastifyRequest, secret: string): SessionPayload | null {
  const token = request.cookies[cookieName];
  return token ? verifySessionToken(token, secret) : null;
}

export function requireAuth(repo: AppRepository, secret: string) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const session = readSession(request, secret);
    if (!session) {
      await reply.code(401).send({ error: "UNAUTHORIZED" });
      return;
    }
    const user = await repo.findUserByEmail(session.email);
    if (!user) {
      await reply.code(401).send({ error: "UNAUTHORIZED" });
      return;
    }
    request.user = { id: user.id, email: user.email, role: user.role };
  };
}

declare module "fastify" {
  interface FastifyRequest {
    user?: {
      id: string;
      email: string;
      role: string;
    };
  }
}
