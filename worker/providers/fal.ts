import { fal } from "@fal-ai/client";
import type { Env } from "../env";

export interface FalSubmitInput {
  modelEndpoint: string;       // e.g. "fal-ai/flux/schnell"
  input: Record<string, unknown>;
  webhookUrl: string;
}

export interface FalSubmitResult {
  requestId: string;
}

function configure(env: Env) {
  fal.config({ credentials: env.FAL_KEY });
}

export async function submit(env: Env, args: FalSubmitInput): Promise<FalSubmitResult> {
  configure(env);
  const { request_id } = await fal.queue.submit(args.modelEndpoint, {
    input: args.input,
    webhookUrl: args.webhookUrl,
  });
  return { requestId: request_id };
}

export async function fetchResult(
  env: Env,
  modelEndpoint: string,
  requestId: string,
): Promise<unknown> {
  configure(env);
  return fal.queue.result(modelEndpoint, { requestId });
}

/**
 * Verify fal webhook signature. fal signs each webhook with Ed25519 using
 * their own private key; we verify with their public key, fetched from their
 * JWKS endpoint. The signed payload is the concatenation (with newlines) of:
 *   request_id, user_id, timestamp, hex(sha256(body))
 * Signatures are hex-encoded and delivered in `x-fal-webhook-signature`.
 */
const FAL_JWKS_URL = "https://rest.alpha.fal.ai/.well-known/jwks.json";
const JWKS_CACHE_KEY = "fal:jwks";
const JWKS_CACHE_TTL = 3600; // seconds

interface Jwk {
  kty: string;
  crv?: string;
  x?: string;
  alg?: string;
  kid?: string;
}

async function getFalJwks(env: Env): Promise<Jwk[]> {
  const cached = await env.SESSIONS.get(JWKS_CACHE_KEY, { type: "json" });
  if (cached && Array.isArray((cached as { keys: Jwk[] }).keys)) {
    return (cached as { keys: Jwk[] }).keys;
  }
  const res = await fetch(FAL_JWKS_URL);
  if (!res.ok) throw new Error(`fal JWKS fetch failed: ${res.status}`);
  const doc = (await res.json()) as { keys: Jwk[] };
  await env.SESSIONS.put(JWKS_CACHE_KEY, JSON.stringify(doc), {
    expirationTtl: JWKS_CACHE_TTL,
  });
  return doc.keys;
}

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error("bad hex");
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function verifyWebhook(
  env: Env,
  req: Request,
  rawBody: string,
): Promise<boolean> {
  const requestId = req.headers.get("x-fal-webhook-request-id");
  const userId = req.headers.get("x-fal-webhook-user-id");
  const timestamp = req.headers.get("x-fal-webhook-timestamp");
  const signatureHex = req.headers.get("x-fal-webhook-signature");

  if (!requestId || !userId || !timestamp || !signatureHex) return false;

  // Reject replays older than 5 minutes.
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) return false;

  // Recompute the signing payload.
  const bodyHash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(rawBody),
  );
  const bodyHashHex = bytesToHex(new Uint8Array(bodyHash));
  const message = new TextEncoder().encode(
    `${requestId}\n${userId}\n${timestamp}\n${bodyHashHex}`,
  );

  let signature: Uint8Array;
  try {
    signature = hexToBytes(signatureHex.trim());
  } catch {
    return false;
  }

  const keys = await getFalJwks(env);
  for (const jwk of keys) {
    if (jwk.kty !== "OKP" || jwk.crv !== "Ed25519" || !jwk.x) continue;
    try {
      const key = await crypto.subtle.importKey(
        "jwk",
        { kty: "OKP", crv: "Ed25519", x: jwk.x },
        { name: "Ed25519" },
        false,
        ["verify"],
      );
      const ok = await crypto.subtle.verify("Ed25519", key, signature, message);
      if (ok) return true;
    } catch {
      /* try next key */
    }
  }
  return false;
}

/** Download a result URL and stream it into R2. Returns the R2 key. */
export async function saveToR2(
  env: Env,
  url: string,
  r2Key: string,
): Promise<{ key: string; contentType: string | null; size: number }> {
  const res = await fetch(url);
  if (!res.ok || !res.body) {
    throw new Error(`fal asset download failed: ${res.status}`);
  }
  const contentType = res.headers.get("content-type");
  const buf = await res.arrayBuffer();
  await env.BUCKET.put(r2Key, buf, {
    httpMetadata: contentType ? { contentType } : undefined,
  });
  return { key: r2Key, contentType, size: buf.byteLength };
}

/** Shape the per-model input from our canonical generate params. */
export function buildInput(opts: {
  prompt: string;
  negativePrompt?: string | null;
  aspectRatio: string;
  refImageUrls: string[];
  seed?: number | null;
}): Record<string, unknown> {
  const input: Record<string, unknown> = {
    prompt: opts.prompt,
    aspect_ratio: opts.aspectRatio,
  };
  if (opts.negativePrompt) input.negative_prompt = opts.negativePrompt;
  if (opts.seed != null) input.seed = opts.seed;
  if (opts.refImageUrls.length > 0) {
    input.image_url = opts.refImageUrls[0];
    input.image_urls = opts.refImageUrls;
  }
  return input;
}
