import catalog from "./catalog.generated.json" with { type: "json" };
export {
  ASSISTANT_COST_PER_MESSAGE,
  DEFAULT_FREE_GRANT,
  FREE_GENERATION_CREDIT_CAP,
  PRO_MONTHLY_CREDITS,
} from "./plans";
import { FREE_GENERATION_CREDIT_CAP } from "./plans";

export type GenType = "image" | "video";

export type AspectParam = "aspect_ratio" | "image_size" | "none";
export type RefImageParamKind = "single" | "array";

export interface ModelSpec {
  key: string;
  endpoint: string;       // fal endpoint id
  label: string;
  description: string | null;
  category: string | null;
  thumbnailUrl: string | null;
  type: GenType;
  credits: number;
  falCostUsd: number;
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
}

export const USD_PER_CREDIT = catalog.usdPerCredit;

const rawModels = catalog.models as Array<{
  key: string;
  endpoint: string;
  displayName: string;
  description: string | null;
  category?: string | null;
  thumbnailUrl: string | null;
  type: GenType;
  credits: number;
  falCostUsd: number;
  aspects: string[];
  defaultAspect: string;
  supportsRefImages: boolean;
  requiresRefImage?: boolean;
  aspectParam: AspectParam;
  refImageParam?: string | null;
  refImageParamKind?: RefImageParamKind | null;
  negativePromptParam?: string | null;
  supportsSeed?: boolean;
  numImagesOptions?: number[];
  defaultNumImages?: number | null;
  resolutionOptions?: string[];
  defaultResolution?: string | null;
  qualityOptions?: string[];
  defaultQuality?: string | null;
  isFeatured?: boolean;
  featuredRank?: number | null;
}>;

export const MODELS: Record<string, ModelSpec> = Object.fromEntries(
  rawModels.map((m) => [
    m.key,
    {
      key: m.key,
      endpoint: m.endpoint,
      label: m.displayName,
      description: m.description,
      category: m.category ?? null,
      thumbnailUrl: m.thumbnailUrl,
      type: m.type,
      credits: m.credits,
      falCostUsd: m.falCostUsd,
      aspects: m.aspects,
      defaultAspect: m.defaultAspect,
      supportsRefImages: m.supportsRefImages,
      requiresRefImage: !!m.requiresRefImage,
      aspectParam: m.aspectParam,
      refImageParam: m.refImageParam ?? null,
      refImageParamKind: m.refImageParamKind ?? null,
      negativePromptParam: m.negativePromptParam ?? "negative_prompt",
      supportsSeed: m.supportsSeed ?? true,
      numImagesOptions: m.numImagesOptions ?? [],
      defaultNumImages: m.defaultNumImages ?? null,
      resolutionOptions: m.resolutionOptions ?? [],
      defaultResolution: m.defaultResolution ?? null,
      qualityOptions: m.qualityOptions ?? [],
      defaultQuality: m.defaultQuality ?? null,
      isFeatured: !!m.isFeatured,
      featuredRank: m.featuredRank ?? null,
    },
  ]),
);

export function creditCost(modelKey: string): number {
  const m = MODELS[modelKey];
  if (!m) throw new Error(`Unknown model: ${modelKey}`);
  return m.credits;
}

export function generationCreditCost(modelKey: string, numImages = 1): number {
  const m = MODELS[modelKey];
  if (!m) throw new Error(`Unknown model: ${modelKey}`);
  return m.credits * Math.max(1, numImages);
}

export function isWithinFreeGenerationCap(requiredCredits: number): boolean {
  return requiredCredits <= FREE_GENERATION_CREDIT_CAP;
}

export function userFacingPrice(modelKey: string): number {
  return creditCost(modelKey) * USD_PER_CREDIT;
}

export function grossMargin(modelKey: string): number {
  const m = MODELS[modelKey];
  if (!m) return 0;
  const revenue = m.credits * USD_PER_CREDIT;
  return (revenue - m.falCostUsd) / revenue;
}
