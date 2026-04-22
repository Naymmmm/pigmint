/**
 * Pulls all active fal image/video generation models from `GET /v1/models`,
 * expands OpenAPI schemas for input capabilities, joins pricing from
 * `GET /v1/models/pricing`, computes credit costs, and writes
 * `worker/lib/catalog.generated.json`.
 *
 * Requires FAL_KEY env var.
 *
 * Run with: pnpm sync:catalog
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ASSUMED_MEGAPIXELS,
  ASSUMED_VIDEO_SECONDS,
  MARGIN_MULTIPLIER,
  USD_PER_CREDIT,
  buildCatalogModel,
  isModelCatalogCompatible,
  type CatalogModel,
  type FalModel,
  type FalPrice,
} from "./catalog-core";

const API = "https://api.fal.ai";
const GENERATION_CATEGORIES = [
  "text-to-image",
  "image-to-image",
  "text-to-video",
  "image-to-video",
];
const FORCE_INCLUDE_ENDPOINTS = [
  "fal-ai/gpt-image-2",
  "fal-ai/gpt-image-2/edit",
];
const PAGE_LIMIT = 10;
const PRICING_CHUNK_SIZE = 50;
const CACHE_PATH = resolve("scripts/.fal-catalog-cache.json");

interface SyncCache {
  modelsByCategory: Record<string, FalModel[]>;
  prices: Record<string, FalPrice>;
  expanded: Record<string, FalModel>;
  noPrice: string[];
  noSchema?: string[];
}

function readCache(): SyncCache {
  if (!existsSync(CACHE_PATH)) {
    return { modelsByCategory: {}, prices: {}, expanded: {}, noPrice: [], noSchema: [] };
  }
  const cache = JSON.parse(readFileSync(CACHE_PATH, "utf8")) as SyncCache;
  cache.noSchema ??= [];
  return cache;
}

function writeCache(cache: SyncCache): void {
  writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
}

function requireKey(): string {
  const key = process.env.FAL_KEY;
  if (!key) {
    console.error("FAL_KEY env var is required.");
    process.exit(2);
  }
  return key;
}

async function fetchModelsByCategory(
  category: string,
  key: string,
  cache: SyncCache,
): Promise<FalModel[]> {
  if (cache.modelsByCategory[category]) return cache.modelsByCategory[category];

  const all: FalModel[] = [];
  let cursor: string | null = null;
  let pages = 0;

  do {
    const url = new URL(`${API}/v1/models`);
    url.searchParams.set("category", category);
    url.searchParams.set("status", "active");
    url.searchParams.set("limit", String(PAGE_LIMIT));
    if (cursor) url.searchParams.set("cursor", cursor);

    const res = await fetchWithRetry(url, key);
    if (!res.ok) {
      throw new Error(`GET /v1/models failed for ${category}: ${res.status} ${await res.text()}`);
    }
    const doc = (await res.json()) as {
      models: FalModel[];
      next_cursor: string | null;
      has_more: boolean;
    };
    all.push(...doc.models);
    cursor = doc.has_more ? doc.next_cursor : null;
    pages++;
    if (pages > 50) throw new Error(`pagination safety cap hit for ${category}`);
  } while (cursor);

  cache.modelsByCategory[category] = all;
  writeCache(cache);
  return all;
}

async function fetchGenerationModels(key: string, cache: SyncCache): Promise<FalModel[]> {
  const groups: FalModel[][] = [];
  for (const category of GENERATION_CATEGORIES) {
    groups.push(await fetchModelsByCategory(category, key, cache));
  }
  const byEndpoint = new Map<string, FalModel>();
  for (const model of groups.flat()) byEndpoint.set(model.endpoint_id, model);
  for (const endpoint of FORCE_INCLUDE_ENDPOINTS) {
    if (!byEndpoint.has(endpoint)) byEndpoint.set(endpoint, { endpoint_id: endpoint });
  }
  return [...byEndpoint.values()].sort((a, b) => a.endpoint_id.localeCompare(b.endpoint_id));
}

async function fetchExpandedModels(
  ids: string[],
  key: string,
  cache: SyncCache,
): Promise<Map<string, FalModel>> {
  const models = new Map<string, FalModel>(Object.entries(cache.expanded));
  const noSchema = new Set(cache.noSchema ?? []);
  for (let i = 0; i < ids.length; i += PAGE_LIMIT) {
    const chunk = ids.slice(i, i + PAGE_LIMIT).filter((id) => !models.has(id) && !noSchema.has(id));
    if (chunk.length === 0) continue;
    for (const model of await fetchExpandedChunk(chunk, key, cache)) {
      models.set(model.endpoint_id, model);
    }
  }
  return models;
}

async function fetchExpandedChunk(
  ids: string[],
  key: string,
  cache: SyncCache,
): Promise<FalModel[]> {
  const url = new URL(`${API}/v1/models`);
  for (const id of ids) url.searchParams.append("endpoint_id", id);
  url.searchParams.set("limit", String(ids.length));
  url.searchParams.append("expand", "openapi-3.0");

  const res = await fetchWithRetry(url, key);
  if (res.ok) {
    const doc = (await res.json()) as { models: FalModel[] };
    for (const model of doc.models) cache.expanded[model.endpoint_id] = model;
    writeCache(cache);
    return doc.models;
  }
  if (res.status === 404 && ids.length > 1) {
    const mid = Math.ceil(ids.length / 2);
    const left = await fetchExpandedChunk(ids.slice(0, mid), key, cache);
    const right = await fetchExpandedChunk(ids.slice(mid), key, cache);
    return [...left, ...right];
  }
  if (res.status === 404 && ids.length === 1) {
    cache.noSchema = [...new Set([...(cache.noSchema ?? []), ids[0]])];
    writeCache(cache);
    return [];
  }
  throw new Error(`GET /v1/models expand failed: ${res.status} ${await res.text()}`);
}

async function fetchPrices(
  ids: string[],
  key: string,
  cache: SyncCache,
): Promise<Map<string, FalPrice>> {
  const prices = new Map<string, FalPrice>(Object.entries(cache.prices));
  const noPrice = new Set(cache.noPrice);
  const missingIds = ids.filter((id) => !prices.has(id) && !noPrice.has(id));

  for (let i = 0; i < missingIds.length; i += PRICING_CHUNK_SIZE) {
    const chunk = missingIds.slice(i, i + PRICING_CHUNK_SIZE);
    for (const price of await fetchPriceChunk(chunk, key, cache)) {
      prices.set(price.endpoint_id, price);
    }
  }
  return prices;
}

async function fetchPriceChunk(ids: string[], key: string, cache: SyncCache): Promise<FalPrice[]> {
  const url = new URL(`${API}/v1/models/pricing`);
  for (const id of ids) url.searchParams.append("endpoint_id", id);
  const res = await fetchWithRetry(url, key);
  if (res.ok) {
    const doc = (await res.json()) as { prices: FalPrice[] };
    for (const price of doc.prices) cache.prices[price.endpoint_id] = price;
    writeCache(cache);
    return doc.prices;
  }
  if (res.status === 404 && ids.length > 1) {
    const mid = Math.ceil(ids.length / 2);
    const left = await fetchPriceChunk(ids.slice(0, mid), key, cache);
    const right = await fetchPriceChunk(ids.slice(mid), key, cache);
    return [...left, ...right];
  }
  if (res.status === 404 && ids.length === 1) {
    cache.noPrice = [...new Set([...cache.noPrice, ids[0]])];
    writeCache(cache);
    return [];
  }
  throw new Error(`GET /v1/models/pricing failed: ${res.status} ${await res.text()}`);
}

async function fetchWithRetry(url: URL, key: string): Promise<Response> {
  let last: Response | null = null;
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(url, { headers: { Authorization: `Key ${key}` } });
    if (res.status !== 429) return res;

    last = res;
    const retryAfter = Number(res.headers.get("retry-after"));
    const delayMs = Number.isFinite(retryAfter)
      ? retryAfter * 1000
      : Math.min(1500 * 2 ** attempt, 15000);
    await sleep(delayMs);
  }
  return last!;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Endpoint-prefix aliases — fal exposes some legacy paths alongside the
// canonical one (e.g. fal-ai/flux-1/X aliases fal-ai/flux/X). Canonicalizing
// here lets us collapse duplicate listings down to one entry.
const ENDPOINT_ALIASES: Array<[RegExp, string]> = [
  [/^fal-ai\/flux-1\//, "fal-ai/flux/"],
];

// Display names fal commonly reuses across many unrelated endpoints.
// When we see these we always append a distinguishing suffix.
const GENERIC_LABELS = new Set(
  [
    "bytedance",
    "bitdance",
    "fooocus",
    "bagel",
    "flux 2",
    "flux 2 lora gallery",
    "kling image",
    "ernie image",
    "hunyuan image",
    "ideogram",
    "bria",
  ].map((s) => s.toLowerCase()),
);

const CATEGORY_ABBREV: Record<string, string> = {
  "text-to-image": "t2i",
  "image-to-image": "i2i",
  "text-to-video": "t2v",
  "image-to-video": "i2v",
};

function canonicalEndpoint(endpoint: string): string {
  let s = endpoint;
  for (const [rx, replacement] of ENDPOINT_ALIASES) s = s.replace(rx, replacement);
  return s;
}

function prettifyToken(token: string): string {
  if (CATEGORY_ABBREV[token]) return CATEGORY_ABBREV[token];
  return token
    .split("-")
    .filter(Boolean)
    .map((w) => (w.length <= 3 ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join("-");
}

function displayNameTokens(displayName: string): Set<string> {
  return new Set(
    displayName
      .toLowerCase()
      .replace(/[[\](){}.·,:]/g, " ")
      .split(/\s+/)
      .filter(Boolean),
  );
}

function suffixForEndpoint(
  endpoint: string,
  displayName: string,
  category: string,
  opts: { dropDnTokens: boolean } = { dropDnTokens: true },
): string {
  const stripped = endpoint
    .replace(/^fal-ai\//, "")
    .replace(/^bytedance\//, "")
    .replace(/^rundiffusion-fal\//, "");
  const pathSegments = stripped.split("/").filter(Boolean);
  const dnTokens = displayNameTokens(displayName);

  const distinguishing = pathSegments
    .filter((token) => {
      const norm = token.toLowerCase().replace(/[^a-z0-9.-]/g, "");
      if (!norm) return false;
      if (CATEGORY_ABBREV[norm]) return true;
      if (!opts.dropDnTokens) return true;
      if (dnTokens.has(norm)) return false;
      const parts = norm.split("-").filter(Boolean);
      if (parts.length > 1 && parts.every((p) => dnTokens.has(p))) return false;
      return true;
    })
    .map(prettifyToken);

  if (distinguishing.length > 0) return distinguishing.join(" ");
  // Deepest fallback: explicit "base" for single-segment endpoints,
  // otherwise the raw tail segment.
  return pathSegments.length <= 1
    ? "base"
    : prettifyToken(pathSegments[pathSegments.length - 1]);
}

function deduplicateAndDisambiguate(
  input: CatalogModel[],
): { models: CatalogModel[]; collapsed: number; disambiguated: number } {
  // --- 1. Collapse endpoint aliases ---------------------------------------
  const byCanonical = new Map<string, CatalogModel[]>();
  for (const model of input) {
    const key = canonicalEndpoint(model.endpoint);
    const bucket = byCanonical.get(key);
    if (bucket) bucket.push(model);
    else byCanonical.set(key, [model]);
  }

  let collapsed = 0;
  const pickedModels: CatalogModel[] = [];
  for (const bucket of byCanonical.values()) {
    if (bucket.length === 1) {
      pickedModels.push(bucket[0]);
      continue;
    }
    // Prefer most-featured, then shortest endpoint path.
    bucket.sort((a, b) => {
      const featuredA = a.featuredRank ?? Number.POSITIVE_INFINITY;
      const featuredB = b.featuredRank ?? Number.POSITIVE_INFINITY;
      if (featuredA !== featuredB) return featuredA - featuredB;
      return a.endpoint.length - b.endpoint.length;
    });
    pickedModels.push(bucket[0]);
    collapsed += bucket.length - 1;
  }

  // --- 2. Disambiguate remaining label collisions / generic labels --------
  // Remember the original displayName so pass 2 can rebuild the label from
  // scratch if pass 1 didn't add enough entropy.
  const originalName = new WeakMap<CatalogModel, string>();
  for (const model of pickedModels) originalName.set(model, model.displayName);

  const labelCount = new Map<string, number>();
  for (const model of pickedModels) {
    labelCount.set(model.displayName, (labelCount.get(model.displayName) ?? 0) + 1);
  }

  let disambiguated = 0;
  // Pass 1: drop tokens that are redundant with the display name.
  for (const model of pickedModels) {
    const count = labelCount.get(model.displayName) ?? 1;
    const generic = GENERIC_LABELS.has(model.displayName.toLowerCase().trim());
    if (count <= 1 && !generic) continue;
    const suffix = suffixForEndpoint(model.endpoint, model.displayName, model.category);
    model.displayName = `${model.displayName} · ${suffix}`;
    disambiguated++;
  }

  // Pass 2: any residual collisions (pass-1 suffixes weren't enough) get the
  // full-path suffix without dn-redundancy filtering.
  const secondCount = new Map<string, number>();
  for (const model of pickedModels) {
    secondCount.set(model.displayName, (secondCount.get(model.displayName) ?? 0) + 1);
  }
  for (const model of pickedModels) {
    if ((secondCount.get(model.displayName) ?? 1) <= 1) continue;
    const base = originalName.get(model) ?? model.displayName;
    const suffix = suffixForEndpoint(model.endpoint, base, model.category, {
      dropDnTokens: false,
    });
    model.displayName = `${base} · ${suffix}`;
  }

  return { models: pickedModels, collapsed, disambiguated };
}

function sortCatalogModels(models: CatalogModel[]): CatalogModel[] {
  const categoryRank = new Map([
    ["text-to-image", 0],
    ["image-to-image", 1],
    ["text-to-video", 2],
    ["image-to-video", 3],
  ]);

  return models.sort((a, b) => {
    const featuredA = a.featuredRank ?? Number.POSITIVE_INFINITY;
    const featuredB = b.featuredRank ?? Number.POSITIVE_INFINITY;
    if (featuredA !== featuredB) return featuredA - featuredB;
    const rank = (categoryRank.get(a.category) ?? 99) - (categoryRank.get(b.category) ?? 99);
    if (rank !== 0) return rank;
    return a.displayName.localeCompare(b.displayName);
  });
}

async function main() {
  const key = requireKey();
  const cache = readCache();
  const discoveredModels = await fetchGenerationModels(key, cache);
  console.log(`Discovered ${discoveredModels.length} active image/video models`);
  const expandedMap = await fetchExpandedModels(
    discoveredModels.map((model) => model.endpoint_id),
    key,
    cache,
  );
  console.log(`Fetched schemas for ${expandedMap.size} discovered models`);
  const compatibleModels = discoveredModels
    .map((model) => expandedMap.get(model.endpoint_id) ?? model)
    .filter(isModelCatalogCompatible);
  console.log(`Found ${compatibleModels.length} compatible prompt generation models`);
  const priceMap = await fetchPrices(compatibleModels.map((model) => model.endpoint_id), key, cache);
  console.log(`Fetched pricing for ${priceMap.size} models`);

  const models: CatalogModel[] = [];
  const skipped: string[] = [];

  for (const discovered of compatibleModels) {
    const price = priceMap.get(discovered.endpoint_id);
    if (!price) {
      skipped.push(`${discovered.endpoint_id}: missing pricing`);
      continue;
    }
    const model = expandedMap.get(discovered.endpoint_id) ?? discovered;
    try {
      models.push(buildCatalogModel(model, price));
    } catch (error) {
      skipped.push(`${discovered.endpoint_id}: ${(error as Error).message}`);
    }
  }

  const dedup = deduplicateAndDisambiguate(models);
  console.log(
    `Collapsed ${dedup.collapsed} endpoint aliases, disambiguated ${dedup.disambiguated} labels`,
  );

  const output = {
    generatedAt: new Date().toISOString(),
    usdPerCredit: USD_PER_CREDIT,
    marginMultiplier: MARGIN_MULTIPLIER,
    assumptions: {
      megapixels: ASSUMED_MEGAPIXELS,
      videoSeconds: ASSUMED_VIDEO_SECONDS,
    },
    source: {
      modelEndpoint: `${API}/v1/models`,
      pricingEndpoint: `${API}/v1/models/pricing`,
      categories: GENERATION_CATEGORIES,
    },
    models: sortCatalogModels(dedup.models),
  };

  const path = resolve("worker/lib/catalog.generated.json");
  writeFileSync(path, JSON.stringify(output, null, 2));

  console.log(`Wrote ${dedup.models.length} models to ${path}`);
  if (skipped.length) {
    console.warn(`Skipped ${skipped.length} models:`);
    for (const line of skipped) console.warn(`  ${line}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
