import type { Env } from "../env";

export interface SessionData {
  userId: string;
  email: string;
  createdAt: number;
}

const COOKIE_NAME = "pgm_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30d

export async function createSession(env: Env, data: SessionData): Promise<string> {
  const token = crypto.randomUUID().replaceAll("-", "");
  await env.SESSIONS.put(`session:${token}`, JSON.stringify(data), {
    expirationTtl: SESSION_TTL_SECONDS,
  });
  const indexKey = `user:${data.userId}:sessions`;
  const existing = ((await env.SESSIONS.get(indexKey, { type: "json" })) ??
    []) as string[];
  existing.push(token);
  await env.SESSIONS.put(indexKey, JSON.stringify(existing), {
    expirationTtl: SESSION_TTL_SECONDS,
  });
  return token;
}

export async function readSession(
  env: Env,
  request: Request,
): Promise<SessionData | null> {
  const cookie = request.headers.get("Cookie") ?? "";
  const match = cookie.match(new RegExp(`${COOKIE_NAME}=([^;]+)`));
  if (!match) return null;
  const raw = await env.SESSIONS.get(`session:${match[1]}`, { type: "json" });
  return (raw as SessionData) ?? null;
}

export function sessionCookie(token: string, appUrl: string): string {
  const secure = appUrl.startsWith("https://") ? "; Secure" : "";
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}${secure}`;
}

export function clearCookie(): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Max-Age=0`;
}
