export const USD_PER_CREDIT = 0.02;
export const MARGIN_MULTIPLIER = 2.0;
export const ASSUMED_MEGAPIXELS = 1;
export const ASSUMED_VIDEO_SECONDS = 5;

export type GenType = "image" | "video";
export type AspectParam = "aspect_ratio" | "image_size" | "none";
export type RefImageParamKind = "single" | "array";

export interface FalModel {
  endpoint_id: string;
  metadata?: {
    display_name?: string;
    description?: string;
    category?: string;
    status?: string;
    thumbnail_url?: string;
    highlighted?: boolean;
    pinned?: boolean;
  };
  openapi?: {
    info?: {
      "x-fal-metadata"?: {
        endpointId?: string;
        category?: string;
        thumbnailUrl?: string;
      };
    };
    components?: {
      schemas?: Record<string, JsonSchema>;
    };
  };
}

export interface FalPrice {
  endpoint_id: string;
  unit_price: number;
  unit: string;
  currency: string;
}

export interface CatalogModel {
  key: string;
  endpoint: string;
  displayName: string;
  description: string | null;
  category: string;
  status: string;
  thumbnailUrl: string | null;
  type: GenType;
  aspects: string[];
  defaultAspect: string;
  supportsRefImages: boolean;
  requiresRefImage: boolean;
  aspectParam: AspectParam;
  refImageParam: string | null;
  refImageParamKind: RefImageParamKind | null;
  negativePromptParam: string | null;
  supportsSeed: boolean;
  numImagesOptions: number[];
  defaultNumImages: number | null;
  resolutionOptions: string[];
  defaultResolution: string | null;
  qualityOptions: string[];
  defaultQuality: string | null;
  isFeatured: boolean;
  featuredRank: number | null;
  pricingUnit: string;
  pricingUnitPrice: number;
  falCostUsd: number;
  credits: number;
}

type JsonSchema = {
  type?: string | string[];
  title?: string;
  required?: string[];
  properties?: Record<string, JsonSchema>;
  enum?: unknown[];
  default?: unknown;
  minimum?: number;
  maximum?: number;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  allOf?: JsonSchema[];
  items?: JsonSchema;
  _fal_ui_field?: string;
  ui?: { field?: string };
  "x-fal"?: Record<string, unknown>;
  $ref?: string;
};

const GENERATION_CATEGORIES = new Set([
  "text-to-image",
  "image-to-image",
  "text-to-video",
  "image-to-video",
]);

const IMAGE_DEFAULT_ASPECTS = ["1:1", "16:9", "9:16", "4:3", "3:4"];
const VIDEO_DEFAULT_ASPECTS = ["16:9", "9:16", "1:1"];

const IMAGE_SIZE_TO_ASPECT: Record<string, string> = {
  square: "1:1",
  square_hd: "1:1",
  landscape_16_9: "16:9",
  portrait_16_9: "9:16",
  landscape_4_3: "4:3",
  portrait_4_3: "3:4",
};

const REF_IMAGE_PARAM_PRIORITY = [
  "image_url",
  "image_urls",
  "start_image_url",
  "first_frame_image_url",
  "input_image_url",
  "source_image_url",
  "reference_image_url",
  "reference_image_urls",
  "init_image_url",
  "control_image_url",
];

const FALLBACK_FEATURED_ENDPOINTS = [
  "fal-ai/gpt-image-2",
  "fal-ai/gpt-image-2/edit",
  "fal-ai/flux/schnell",
  "fal-ai/flux/dev",
  "fal-ai/flux-pro/v1.1-ultra",
  "fal-ai/flux-2-pro",
  "fal-ai/nano-banana-2",
  "fal-ai/ideogram/v3",
  "fal-ai/kling-video/v2.6/pro/text-to-video",
  "fal-ai/kling-video/v2.6/pro/image-to-video",
  "fal-ai/veo3.1/fast",
  "fal-ai/veo3.1",
  "bytedance/seedance-2.0/fast/text-to-video",
  "bytedance/seedance-2.0/fast/image-to-video",
];

export function isGenerationCategory(category: string | undefined): boolean {
  return !!category && GENERATION_CATEGORIES.has(category);
}

export function slugKey(endpoint: string): string {
  return endpoint
    .replace(/^fal-ai\//, "")
    .replace(/\//g, "-");
}

export function buildCatalogModel(model: FalModel, price: FalPrice): CatalogModel {
  const metadata = normalizedMetadata(model);
  const category = metadata.category;
  if (!isGenerationCategory(category)) {
    throw new Error(`unsupported category: ${category ?? "unknown"}`);
  }

  const input = findInputSchema(model);
  if (!input?.properties?.prompt) {
    throw new Error(`no prompt input schema for ${model.endpoint_id}`);
  }

  const type: GenType = category.endsWith("-video") ? "video" : "image";
  const aspect = deriveAspect(type, input);
  const ref = deriveRefImageParam(input);
  const numImages = deriveNumImages(input);
  const resolution = deriveResolution(input);
  const quality = deriveQuality(input);
  const featuredRank = deriveFeaturedRank(model);
  const costUsd = normalizeCost(price, type);

  return {
    key: slugKey(model.endpoint_id),
    endpoint: model.endpoint_id,
    displayName: metadata.displayName,
    description: metadata.description,
    category,
    status: metadata.status,
    thumbnailUrl: metadata.thumbnailUrl,
    type,
    aspects: aspect.aspects,
    defaultAspect: aspect.defaultAspect,
    supportsRefImages: ref.param !== null,
    requiresRefImage: ref.param !== null && (input.required ?? []).includes(ref.param),
    aspectParam: aspect.param,
    refImageParam: ref.param,
    refImageParamKind: ref.kind,
    negativePromptParam: input.properties.negative_prompt ? "negative_prompt" : null,
    supportsSeed: !!input.properties.seed,
    numImagesOptions: numImages.options,
    defaultNumImages: numImages.defaultValue,
    resolutionOptions: resolution.options,
    defaultResolution: resolution.defaultValue,
    qualityOptions: quality.options,
    defaultQuality: quality.defaultValue,
    isFeatured: featuredRank !== null,
    featuredRank,
    pricingUnit: price.unit,
    pricingUnitPrice: price.unit_price,
    falCostUsd: costUsd,
    credits: creditsFromCost(costUsd),
  };
}

export function isModelCatalogCompatible(model: FalModel): boolean {
  if (!isGenerationCategory(normalizedMetadata(model).category)) return false;
  return !!findInputSchema(model)?.properties?.prompt;
}

export function normalizeCost(price: FalPrice, type: GenType): number {
  const unit = price.unit.toLowerCase().replace(/s$/, "");
  switch (unit) {
    case "image":
    case "request":
    case "call":
    case "generation":
    case "video":
    case "unit":
      return price.unit_price;
    case "megapixel":
    case "processed megapixel":
    case "mp":
      return price.unit_price * ASSUMED_MEGAPIXELS;
    case "second":
      return price.unit_price * (type === "video" ? ASSUMED_VIDEO_SECONDS : 1);
    default:
      return price.unit_price;
  }
}

export function creditsFromCost(costUsd: number): number {
  return Math.max(1, Math.ceil((costUsd * MARGIN_MULTIPLIER) / USD_PER_CREDIT));
}

function findInputSchema(model: FalModel): JsonSchema | null {
  const schemas = model.openapi?.components?.schemas;
  if (!schemas) return null;

  const candidates = Object.entries(schemas).filter(([, schema]) => {
    if (!schema.properties?.prompt) return false;
    const title = `${schema.title ?? ""}`.toLowerCase();
    return title.includes("input") || title.includes("request") || !!schema.required;
  });

  candidates.sort(([nameA, schemaA], [nameB, schemaB]) => {
    const score = (name: string, schema: JsonSchema) => {
      let value = 0;
      if (/input$/i.test(name)) value += 4;
      if (/request$/i.test(name)) value += 3;
      if ((schema.required ?? []).includes("prompt")) value += 2;
      if (schema.properties?.images || schema.properties?.video) value -= 5;
      return value;
    };
    return score(nameB, schemaB) - score(nameA, schemaA);
  });

  return candidates[0]?.[1] ?? null;
}

function deriveAspect(
  type: GenType,
  input: JsonSchema,
): { param: AspectParam; aspects: string[]; defaultAspect: string } {
  const aspectRatio = input.properties?.aspect_ratio;
  if (aspectRatio) {
    const aspects = collectEnums(aspectRatio).filter(isAspectRatio);
    if (aspects.length > 0) {
      return {
        param: "aspect_ratio",
        aspects,
        defaultAspect: defaultFromSchema(aspectRatio, aspects) ?? aspects[0],
      };
    }
  }

  const imageSize = input.properties?.image_size;
  if (imageSize) {
    const aspects = unique(
      collectEnums(imageSize)
        .map((value) => IMAGE_SIZE_TO_ASPECT[value])
        .filter((value): value is string => !!value),
    );
    if (aspects.length > 0) {
      const defaultSize =
        typeof imageSize.default === "string" ? IMAGE_SIZE_TO_ASPECT[imageSize.default] : null;
      return {
        param: "image_size",
        aspects,
        defaultAspect: defaultSize && aspects.includes(defaultSize) ? defaultSize : aspects[0],
      };
    }
  }

  const fallback = type === "video" ? VIDEO_DEFAULT_ASPECTS : IMAGE_DEFAULT_ASPECTS;
  return {
    param: "none",
    aspects: fallback,
    defaultAspect: fallback[0],
  };
}

function deriveRefImageParam(
  input: JsonSchema,
): { param: string | null; kind: RefImageParamKind | null } {
  const properties = input.properties ?? {};
  const names = Object.keys(properties).filter((name) => isImageUrlProperty(name, properties[name]));
  if (names.length === 0) return { param: null, kind: null };

  names.sort((a, b) => {
    const required = input.required ?? [];
    const requiredScore = Number(required.includes(b)) - Number(required.includes(a));
    if (requiredScore !== 0) return requiredScore;
    return priorityIndex(a) - priorityIndex(b);
  });

  const param = names[0];
  const schema = properties[param];
  const kind = isArraySchema(schema) || param.endsWith("_urls") ? "array" : "single";
  return { param, kind };
}

function deriveNumImages(
  input: JsonSchema,
): { options: number[]; defaultValue: number | null } {
  const schema = input.properties?.num_images;
  if (!schema) return { options: [], defaultValue: null };

  const enumOptions = collectNumberEnums(schema).filter(
    (value) => Number.isInteger(value) && value >= 1 && value <= 8,
  );
  const options =
    enumOptions.length > 0
      ? enumOptions
      : rangeFromBounds(schema.minimum, schema.maximum);
  if (options.length === 0) return { options: [], defaultValue: null };

  const defaultValue =
    typeof schema.default === "number" && options.includes(schema.default)
      ? schema.default
      : options[0];

  return { options, defaultValue };
}

function deriveResolution(
  input: JsonSchema,
): { options: string[]; defaultValue: string | null } {
  const schema = input.properties?.resolution;
  if (!schema) return { options: [], defaultValue: null };

  const options = collectEnums(schema);
  if (options.length === 0) return { options: [], defaultValue: null };

  return {
    options,
    defaultValue: defaultFromSchema(schema, options) ?? options[0],
  };
}

function deriveQuality(
  input: JsonSchema,
): { options: string[]; defaultValue: string | null } {
  const schema = input.properties?.quality;
  if (!schema) return { options: [], defaultValue: null };

  const options = collectEnums(schema);
  if (options.length === 0) return { options: [], defaultValue: null };

  return {
    options,
    defaultValue: defaultFromSchema(schema, options) ?? options[0],
  };
}

function deriveFeaturedRank(model: FalModel): number | null {
  if (model.metadata?.pinned) return 0;
  if (model.metadata?.highlighted) return 100;

  const fallbackIndex = FALLBACK_FEATURED_ENDPOINTS.indexOf(model.endpoint_id);
  return fallbackIndex === -1 ? null : 1000 + fallbackIndex;
}

function normalizedMetadata(model: FalModel): {
  category: string | undefined;
  displayName: string;
  description: string | null;
  status: string;
  thumbnailUrl: string | null;
} {
  const openapiMetadata = model.openapi?.info?.["x-fal-metadata"];
  return {
    category: model.metadata?.category ?? openapiMetadata?.category,
    displayName: model.metadata?.display_name ?? titleFromEndpoint(model.endpoint_id),
    description: model.metadata?.description ?? null,
    status: model.metadata?.status ?? "active",
    thumbnailUrl: model.metadata?.thumbnail_url ?? openapiMetadata?.thumbnailUrl ?? null,
  };
}

function titleFromEndpoint(endpoint: string): string {
  return endpoint
    .replace(/^fal-ai\//, "")
    .split("-")
    .flatMap((part) => part.split("/"))
    .map((word) => (word.toLowerCase() === "gpt" ? "GPT" : capitalize(word)))
    .join(" ");
}

function capitalize(value: string): string {
  return value ? `${value[0].toUpperCase()}${value.slice(1)}` : value;
}

function isImageUrlProperty(name: string, schema: JsonSchema): boolean {
  const normalized = name.toLowerCase();
  if (normalized.includes("mask")) return false;
  if (schema._fal_ui_field === "image" || schema.ui?.field === "image") return true;
  if (normalized.includes("image") && (normalized.includes("url") || normalized.endsWith("urls"))) {
    return true;
  }
  return false;
}

function isArraySchema(schema: JsonSchema): boolean {
  if (schema.type === "array") return true;
  return [...(schema.anyOf ?? []), ...(schema.oneOf ?? [])].some(isArraySchema);
}

function priorityIndex(param: string): number {
  const index = REF_IMAGE_PARAM_PRIORITY.indexOf(param);
  return index === -1 ? REF_IMAGE_PARAM_PRIORITY.length : index;
}

function collectEnums(schema: JsonSchema): string[] {
  const own = (schema.enum ?? []).filter((value): value is string => typeof value === "string");
  const nested = [...(schema.anyOf ?? []), ...(schema.oneOf ?? []), ...(schema.allOf ?? [])]
    .flatMap(collectEnums);
  return unique([...own, ...nested]);
}

function collectNumberEnums(schema: JsonSchema): number[] {
  const own = (schema.enum ?? []).filter((value): value is number => typeof value === "number");
  const nested = [...(schema.anyOf ?? []), ...(schema.oneOf ?? []), ...(schema.allOf ?? [])]
    .flatMap(collectNumberEnums);
  return unique([...own, ...nested]);
}

function rangeFromBounds(minimum: number | undefined, maximum: number | undefined): number[] {
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum)) return [];
  const min = Math.max(1, Math.ceil(minimum!));
  const max = Math.min(8, Math.floor(maximum!));
  if (max < min) return [];
  return Array.from({ length: max - min + 1 }, (_, index) => min + index);
}

function isAspectRatio(value: string): boolean {
  return /^\d+:\d+$/.test(value);
}

function defaultFromSchema(schema: JsonSchema, allowed: string[]): string | null {
  return typeof schema.default === "string" && allowed.includes(schema.default)
    ? schema.default
    : null;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}
