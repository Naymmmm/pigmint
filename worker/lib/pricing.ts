export type GenType = "image" | "video";

export interface ModelSpec {
  id: string;            // fal endpoint id, e.g. "fal-ai/flux/schnell"
  label: string;
  type: GenType;
  credits: number;       // base credit cost per generation
  maxAspects: string[];  // allowed aspect ratios
  defaultAspect: string;
  supportsRefImages: boolean;
}

export const MODELS: Record<string, ModelSpec> = {
  "flux-schnell": {
    id: "fal-ai/flux/schnell",
    label: "Flux Schnell (fast)",
    type: "image",
    credits: 1,
    maxAspects: ["1:1", "16:9", "9:16", "4:3", "3:4"],
    defaultAspect: "1:1",
    supportsRefImages: false,
  },
  "flux-dev": {
    id: "fal-ai/flux/dev",
    label: "Flux Dev (quality)",
    type: "image",
    credits: 3,
    maxAspects: ["1:1", "16:9", "9:16", "4:3", "3:4"],
    defaultAspect: "1:1",
    supportsRefImages: true,
  },
  "flux-pro": {
    id: "fal-ai/flux-pro/v1.1",
    label: "Flux Pro",
    type: "image",
    credits: 5,
    maxAspects: ["1:1", "16:9", "9:16", "4:3", "3:4", "21:9"],
    defaultAspect: "1:1",
    supportsRefImages: true,
  },
  "kling-video": {
    id: "fal-ai/kling-video/v1/standard/text-to-video",
    label: "Kling Video (5s)",
    type: "video",
    credits: 25,
    maxAspects: ["16:9", "9:16", "1:1"],
    defaultAspect: "16:9",
    supportsRefImages: true,
  },
  "veo-video": {
    id: "fal-ai/veo3",
    label: "Veo 3 (premium)",
    type: "video",
    credits: 60,
    maxAspects: ["16:9", "9:16"],
    defaultAspect: "16:9",
    supportsRefImages: false,
  },
};

export const DEFAULT_FREE_GRANT = 5;
export const ASSISTANT_COST_PER_MESSAGE = 1;
export const PRO_MONTHLY_CREDITS = 500;

export function creditCost(modelKey: string): number {
  const m = MODELS[modelKey];
  if (!m) throw new Error(`Unknown model: ${modelKey}`);
  return m.credits;
}
