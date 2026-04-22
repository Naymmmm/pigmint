import type { Env } from "../env";

const REF_URL_TTL_SECONDS = 24 * 60 * 60;

export async function createSignedRefUrl(env: Env, key: string): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + REF_URL_TTL_SECONDS;
  const sig = await signRefKey(env, key, exp);
  return `${env.APP_URL}/api/generations/refs/${encodeURIComponent(key)}?exp=${exp}&sig=${sig}`;
}

export async function verifySignedRefUrl(
  env: Env,
  key: string,
  expText: string | undefined,
  sig: string | undefined,
): Promise<boolean> {
  if (!key.startsWith("refs/") || !expText || !sig) return false;

  const exp = Number(expText);
  if (!Number.isInteger(exp) || exp < Math.floor(Date.now() / 1000)) return false;

  const expected = await signRefKey(env, key, exp);
  return timingSafeEqual(expected, sig);
}

async function signRefKey(env: Env, key: string, exp: number): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.WORKOS_COOKIE_PASSWORD),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    new TextEncoder().encode(`${key}.${exp}`),
  );
  return bytesToHex(new Uint8Array(signature));
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
