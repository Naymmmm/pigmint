import type { Env } from "../env";

export interface FalSubmitInput {
  modelEndpoint: string;       // e.g. "fal-ai/flux/schnell"
  input: Record<string, unknown>;
  webhookUrl: string;
}

export interface FalSubmitResult {
  requestId: string;
}

export async function submit(env: Env, args: FalSubmitInput): Promise<FalSubmitResult> {
  const res = await fetch(queueSubmitUrl(args.modelEndpoint, args.webhookUrl), {
    method: "POST",
    headers: falJsonHeaders(env),
    body: JSON.stringify(args.input),
  });
  if (!res.ok) {
    throw new Error(`fal queue submit failed: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as { request_id?: string };
  if (!body.request_id) throw new Error("fal queue submit missing request_id");
  return { requestId: body.request_id };
}

export async function fetchResult(
  env: Env,
  modelEndpoint: string,
  requestId: string,
): Promise<unknown> {
  const res = await fetch(queueResultUrl(modelEndpoint, requestId), {
    method: "GET",
    headers: falJsonHeaders(env),
  });
  if (!res.ok) {
    throw new Error(`fal queue result failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

export function queueSubmitUrl(modelEndpoint: string, webhookUrl: string): string {
  const url = new URL(`https://queue.fal.run/${normalizeEndpoint(modelEndpoint)}`);
  url.searchParams.set("fal_webhook", webhookUrl);
  return url.toString();
}

export function queueResultUrl(modelEndpoint: string, requestId: string): string {
  return `https://queue.fal.run/${normalizeEndpoint(modelEndpoint)}/requests/${encodeURIComponent(requestId)}`;
}

function normalizeEndpoint(modelEndpoint: string): string {
  return modelEndpoint.replace(/^\/+/, "").replace(/\/+$/, "");
}

function falJsonHeaders(env: Env): HeadersInit {
  return {
    Authorization: `Key ${env.FAL_KEY}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
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

// Canonical "W:H" → flux-family image_size preset.
const IMAGE_SIZE_PRESETS: Record<string, string> = {
  "1:1": "square_hd",
  "16:9": "landscape_16_9",
  "9:16": "portrait_16_9",
  "4:3": "landscape_4_3",
  "3:4": "portrait_4_3",
  "21:9": "landscape_16_9", // fal's flux presets don't ship a 21:9 — closest match
};

/** Shape the per-model input from our canonical generate params. */
export function buildInput(opts: {
  prompt: string;
  negativePrompt?: string | null;
  aspectRatio: string;
  aspectParam: "aspect_ratio" | "image_size" | "none";
  refImageUrls: string[];
  refImageParam?: string | null;
  refImageParamKind?: "single" | "array" | null;
  negativePromptParam?: string | null;
  supportsSeed?: boolean;
  numImages?: number | null;
  supportsNumImages?: boolean;
  resolution?: string | null;
  supportsResolution?: boolean;
  quality?: string | null;
  supportsQuality?: boolean;
  seed?: number | null;
}): Record<string, unknown> {
  const input: Record<string, unknown> = { prompt: opts.prompt };

  if (opts.aspectParam === "image_size") {
    input.image_size = IMAGE_SIZE_PRESETS[opts.aspectRatio] ?? "square_hd";
  } else if (opts.aspectParam === "aspect_ratio") {
    input.aspect_ratio = opts.aspectRatio;
  }

  const negativePromptParam = opts.negativePromptParam ?? "negative_prompt";
  if (opts.negativePrompt && negativePromptParam) {
    input[negativePromptParam] = opts.negativePrompt;
  }
  if (opts.seed != null && opts.supportsSeed !== false) input.seed = opts.seed;
  if (opts.numImages != null && opts.supportsNumImages) input.num_images = opts.numImages;
  if (opts.resolution && opts.supportsResolution) input.resolution = opts.resolution;
  if (opts.quality && opts.supportsQuality) input.quality = opts.quality;
  if (opts.refImageUrls.length > 0 && opts.refImageParam) {
    input[opts.refImageParam] =
      opts.refImageParamKind === "array" ? opts.refImageUrls : opts.refImageUrls[0];
  }
  return input;
}
