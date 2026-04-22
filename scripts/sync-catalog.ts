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
    models: sortCatalogModels(models),
  };

  const path = resolve("worker/lib/catalog.generated.json");
  writeFileSync(path, JSON.stringify(output, null, 2));

  console.log(`Wrote ${models.length} models to ${path}`);
  if (skipped.length) {
    console.warn(`Skipped ${skipped.length} models:`);
    for (const line of skipped) console.warn(`  ${line}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
