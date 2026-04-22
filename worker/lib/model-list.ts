import { MODELS, type ModelSpec } from "./pricing";

export interface ModelSummary {
  key: string;
  label: string;
  type: ModelSpec["type"];
  category: string | null;
  credits: number;
  aspects: string[];
  defaultAspect: string;
  supportsRefImages: boolean;
  requiresRefImage: boolean;
  numImagesOptions: number[];
  defaultNumImages: number | null;
  resolutionOptions: string[];
  defaultResolution: string | null;
  qualityOptions: string[];
  defaultQuality: string | null;
  isFeatured: boolean;
  featuredRank: number | null;
  hasThumbnail: boolean;
}

interface ListOptions {
  query?: string | null;
  limit?: number;
}

const DEFAULT_LIMIT = 80;
const MAX_LIMIT = 120;

export function listModelSummaries(options: ListOptions = {}): ModelSummary[] {
  const query = options.query?.trim().toLowerCase() ?? "";
  const limit = clampLimit(options.limit);
  const models = Object.values(MODELS);

  const ranked = query
    ? models
        .map((model) => ({ model, score: searchScore(model, query) }))
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score || modelSort(a.model, b.model))
        .map((item) => item.model)
    : [...models].sort(modelSort);

  return ranked.slice(0, limit).map(toModelSummary);
}

function toModelSummary(model: ModelSpec): ModelSummary {
  return {
    key: model.key,
    label: model.label,
    type: model.type,
    category: model.category,
    credits: model.credits,
    aspects: model.aspects,
    defaultAspect: model.defaultAspect,
    supportsRefImages: model.supportsRefImages,
    requiresRefImage: model.requiresRefImage,
    numImagesOptions: model.numImagesOptions,
    defaultNumImages: model.defaultNumImages,
    resolutionOptions: model.resolutionOptions,
    defaultResolution: model.defaultResolution,
    qualityOptions: model.qualityOptions,
    defaultQuality: model.defaultQuality,
    isFeatured: model.isFeatured,
    featuredRank: model.featuredRank,
    hasThumbnail: !!model.thumbnailUrl,
  };
}

function clampLimit(limit = DEFAULT_LIMIT): number {
  if (!Number.isFinite(limit)) return DEFAULT_LIMIT;
  return Math.min(Math.max(Math.trunc(limit), 1), MAX_LIMIT);
}

function modelSort(a: ModelSpec, b: ModelSpec): number {
  const featuredDelta = Number(b.isFeatured) - Number(a.isFeatured);
  if (featuredDelta !== 0) return featuredDelta;

  const rankDelta = (a.featuredRank ?? 9999) - (b.featuredRank ?? 9999);
  if (rankDelta !== 0) return rankDelta;

  const freeTierDelta = Number(isFreeFriendly(b)) - Number(isFreeFriendly(a));
  if (freeTierDelta !== 0) return freeTierDelta;

  const typeDelta = a.type.localeCompare(b.type);
  if (typeDelta !== 0) return typeDelta;

  const creditDelta = a.credits - b.credits;
  if (creditDelta !== 0) return creditDelta;

  return a.label.localeCompare(b.label);
}

function isFreeFriendly(model: ModelSpec): boolean {
  return model.type === "image" && model.credits <= 10;
}

function searchScore(model: ModelSpec, query: string): number {
  const label = model.label.toLowerCase();
  const key = model.key.toLowerCase();
  const category = model.category?.toLowerCase() ?? "";
  const description = model.description?.toLowerCase() ?? "";
  const endpoint = model.endpoint.toLowerCase();
  const haystack = `${label} ${key} ${category} ${description} ${endpoint}`;

  if (!haystack.includes(query)) return 0;
  if (label === query || key === query) return 1000;
  if (label.startsWith(query)) return 800;
  if (key.startsWith(query)) return 700;
  if (category.includes(query)) return 500;
  if (endpoint.includes(query)) return 400;
  return model.isFeatured ? 250 : 100;
}
