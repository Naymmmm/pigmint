// Style presets. Picking one appends `promptSuffix` (and `negativeSuffix`)
// to the user's prompt on the client before submitting to /api/generations.
// The server doesn't need to know about presets — it just sees the final prompt.
//
// Keep suffixes short; overlong style tokens can hurt adherence.

export interface Preset {
  key: string;
  label: string;
  emoji: string;           // optional small marker for the UI
  promptSuffix: string;
  negativeSuffix?: string;
  // If set, preset is only shown when the selected model's type is in this list.
  // Defaults to all types.
  appliesTo?: Array<"image" | "video">;
}

export const PRESETS: Preset[] = [
  {
    key: "none",
    label: "No style",
    emoji: "∅",
    promptSuffix: "",
  },
  {
    key: "photoreal",
    label: "Photoreal",
    emoji: "📷",
    promptSuffix: ", photorealistic, natural lighting, sharp focus, shot on 35mm film, high detail",
    negativeSuffix: "illustration, cartoon, painting, low quality",
  },
  {
    key: "ghibli",
    label: "Ghibli",
    emoji: "🍃",
    promptSuffix: ", Studio Ghibli style, hand-painted watercolor backgrounds, soft warm palette, whimsical, Miyazaki-inspired",
    negativeSuffix: "3d render, photorealistic, dark, grim",
  },
  {
    key: "anime",
    label: "Anime",
    emoji: "🎌",
    promptSuffix: ", anime style, cel shading, vibrant saturated colors, dynamic composition, detailed eyes, clean line art",
    negativeSuffix: "photorealistic, western cartoon, 3d, blurry",
  },
  {
    key: "doodle",
    label: "Doodle",
    emoji: "✏️",
    promptSuffix: ", hand-drawn doodle, rough pencil sketch, white background, minimal, playful linework",
    negativeSuffix: "photorealistic, 3d, color fill, detailed shading",
  },
  {
    key: "pixel",
    label: "Pixel art",
    emoji: "🕹️",
    promptSuffix: ", 16-bit pixel art, limited palette, crisp pixels, retro game aesthetic, isometric",
    negativeSuffix: "photorealistic, smooth gradient, blurry, anti-aliased",
  },
  {
    key: "cyberpunk",
    label: "Cyberpunk",
    emoji: "🌆",
    promptSuffix: ", cyberpunk, neon-lit rainy streets, dense holographic signage, atmospheric haze, cinematic moody lighting",
    negativeSuffix: "daylight, pastoral, bright and cheerful",
  },
  {
    key: "watercolor",
    label: "Watercolor",
    emoji: "🎨",
    promptSuffix: ", loose watercolor painting, soft bleeding edges, paper texture, pastel palette, natural pigment",
    negativeSuffix: "photorealistic, 3d, digital art, crisp lines",
  },
  {
    key: "lineart",
    label: "Line art",
    emoji: "🖊️",
    promptSuffix: ", clean black line art, minimal shading, white background, bold confident strokes",
    negativeSuffix: "color, gradient, photorealistic",
  },
  {
    key: "claymation",
    label: "Claymation",
    emoji: "🟠",
    promptSuffix: ", stop-motion claymation, fingerprints visible in plasticine, slight imperfections, warm studio lighting",
    negativeSuffix: "2d, flat, photorealistic",
  },
  {
    key: "3d-render",
    label: "3D render",
    emoji: "🧊",
    promptSuffix: ", 3D render, octane-style global illumination, subtle subsurface scattering, product photography lighting",
    negativeSuffix: "2d, sketch, painting",
  },
  {
    key: "vaporwave",
    label: "Vaporwave",
    emoji: "🌴",
    promptSuffix: ", vaporwave aesthetic, magenta and cyan gradient sky, palm silhouettes, retro VHS grain, 80s sunset",
    negativeSuffix: "modern, minimalist, grayscale",
  },
];

export function applyPreset(prompt: string, preset: Preset | undefined): string {
  if (!preset || preset.key === "none") return prompt;
  return `${prompt.trim()}${preset.promptSuffix}`;
}

export function applyNegativePreset(
  negative: string | undefined,
  preset: Preset | undefined,
): string | undefined {
  if (!preset || preset.key === "none" || !preset.negativeSuffix) return negative;
  if (!negative || !negative.trim()) return preset.negativeSuffix;
  return `${negative.trim()}, ${preset.negativeSuffix}`;
}
