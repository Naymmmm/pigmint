# Generation Options And Featured Models Design

## Scope

Add locally synced, model-aware generation options for `num_images` and `resolution`, and surface featured FAL models at the top of the model picker.

## Catalog

The FAL sync derives supported controls from each model's OpenAPI input schema. It persists:

- `numImagesOptions` and `defaultNumImages` when `num_images` has a finite supported range.
- `resolutionOptions` and `defaultResolution` when `resolution` has string enum values.
- `featuredRank`, based on FAL `pinned` / `highlighted` metadata plus an app-maintained fallback endpoint list for popular image and video models.

## Backend

`/api/models` exposes the safe option metadata but not FAL cost. Generation creation validates requested options against the selected model's catalog entry. Credits scale by `numImages` for image batches. Resolution uses the model's existing credit cost unless pricing metadata becomes granular enough to price it separately.

## Provider Input

FAL input building passes through only supported parameters:

- `num_images` when the model supports it.
- `resolution` when the model supports the selected value.
- Existing aspect/ref/negative/seed mapping remains model-aware.

## UI

The model combobox shows a `Featured` group first, capped to a compact set of popular models, followed by `Images` and `Videos`. The generation toolbar shows option selects only when the selected model supports them. Required reference images still gate submit.

## Verification

Tests cover catalog option derivation, featured ranking, and provider input shaping. Final verification runs `pnpm test`, `pnpm typecheck`, and `pnpm build`.
