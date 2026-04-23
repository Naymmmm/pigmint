# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Package manager is **pnpm** (pinned to 9.0.0). Node scripts use `tsx` for TS execution.

- `pnpm dev` — Vite SPA on :5173 with `/api` proxied to the Worker on :8787.
- `pnpm preview` / `pnpm dev:worker` — Wrangler dev for the Worker (serves built SPA from `dist` via the `ASSETS` binding plus `/api/*` routes).
- `pnpm build` — `tsc -b && vite build`. Source maps are off unless `VITE_SOURCEMAP=true`.
- `pnpm typecheck` — `tsc -b --noEmit` across the three project refs (`tsconfig.app.json`, `tsconfig.worker.json`).
- `pnpm test` — runs `node --import tsx --test scripts/*.test.ts`. Single file: `node --import tsx --test scripts/pricing.test.ts`. Single case: append `--test-name-pattern="<regex>"`.
- `pnpm sync:catalog` — runs `scripts/sync-catalog.ts` against FAL; reads `.env.local` for `FAL_KEY`, writes `worker/lib/catalog.generated.json`, caches raw responses in `scripts/.fal-catalog-cache.json` (gitignored). Must be run when model metadata or pricing changes, before deploying.
- `pnpm db:migrate:local` / `pnpm db:migrate` — apply `worker/db/migrations/*.sql` to local or remote D1.
- `pnpm cf-typegen` — regenerate Cloudflare binding types from `wrangler.toml`.
- `pnpm deploy` — build then `wrangler deploy`.

## Architecture

Pigmint is a single Cloudflare Worker that serves a Vite/React SPA and a Hono API on the same origin. Both halves share TypeScript types/constants via `shared/` and Vite aliases `@` (→ `src`) and `@shared` (→ `shared`).

### Request routing (`worker/index.ts`)

The default `fetch` handler splits on `/api/` prefix:

- Non-`/api` requests → `env.ASSETS.fetch` (the built SPA, with `not_found_handling = "single-page-application"`).
- `/api/auth/*` and `/api/me` → a small **auth-only** Hono app built eagerly. This is a deliberate fast path so unauthenticated landing-page hits don't pay for importing the full API surface. Covered by `scripts/auth-fast-path.test.ts`.
- All other `/api/*` → lazy-built full API (dynamic `import()` of route modules) cached in a module-level promise. When touching route wiring, preserve this laziness.

Inside the full API: webhook routes (`/webhooks/fal`, `/webhooks/stripe`) are mounted **before** CORS so they have no CORS surface. SPA-facing routes get a strict CORS middleware that only echoes `env.APP_URL` as an allowed origin (credentials required). `requireUser` middleware (WorkOS session) gates everything under `authed` (generations, folders, bookmarks, assistant, billing, `/me`).

`scheduled` runs the daily credit refill job (`worker/jobs/refill.ts`) on the cron in `wrangler.toml`.

### Bindings (see `wrangler.toml`)

- `DB` — D1 database `pigmint` (all metadata, generations, folders, bookmarks, users/credits). Migrations in `worker/db/migrations/`.
- `BUCKET` — R2 `pigmint-assets` for both generated outputs and uploaded reference images (served via signed URLs, see `worker/lib/ref-images.ts` and `serveSignedGenerationRef` in `worker/routes/generations.ts`).
- `SESSIONS` — KV for WorkOS session storage and caching.
- `ASSETS` — static SPA.

### Worker library modules (`worker/lib/`)

- `catalog.generated.json` — source of truth for available FAL models. Do **not** edit by hand; run `pnpm sync:catalog`.
- `pricing.ts` + `catalog-core.ts` (via `scripts/`) — derive credit costs from FAL pricing; tested in `scripts/pricing.test.ts` and `scripts/catalog-core.test.ts`.
- `model-list.ts` — surfaces the catalog to the client, applies featured ordering, free-plan guardrails (image models ≤10 credits gated for free users), batch/resolution/quality options.
- `moderation.ts` — OpenAI-backed prompt + output moderation.
- `ref-images.ts` / `ids.ts` — signed reference URLs and ID generation.
- `plans.ts` — plan/credit config (also referenced from `shared/billing.ts`).

### Providers & jobs

- `worker/providers/fal.ts` — FAL queue submission + input shaping. Input shape regression-tested in `scripts/fal-input.test.ts`.
- `worker/routes/webhooks/fal.ts` — receives FAL completion callbacks (JWKS-verified; no shared secret).
- `worker/routes/webhooks/stripe.ts` — billing webhook using `STRIPE_WEBHOOK_SECRET`.
- `worker/jobs/refill.ts` — cron-driven monthly credit refill.

### Frontend (`src/`)

- `App.tsx` — routes. Landing and Legal are eager; Gallery, GenerationDetail, Assistant, Billing are `React.lazy` (split-bundle behavior is regression-tested in `scripts/client-splitting.test.ts`; keep those four lazy).
- `ProtectedRoute.tsx` wraps authed routes; unauthenticated users bounce to the landing page.
- `src/lib/api.ts` — fetch wrapper for `/api`. TanStack Query is the data layer.
- `src/components/ui/` — shadcn-style Radix primitives; app-level components live alongside.

### Shared

`shared/billing.ts` is imported by both client and worker via the `@shared` alias. Anything needed on both sides belongs here, not duplicated.

## Testing conventions

Tests are plain Node `node:test` files in `scripts/*.test.ts` — no Vitest/Jest. They import production modules directly (including `worker/lib/*`) and run under `tsx`. When changing catalog shape, pricing, FAL input, free-credit caps, legal routes, WorkOS auth flow, the auth fast path, or the client route-splitting manifest, the corresponding regression test in `scripts/` likely needs updating.

## Deployment order

1. `pnpm sync:catalog` (if model metadata/pricing changed) and commit `worker/lib/catalog.generated.json`.
2. `pnpm build`.
3. `pnpm db:migrate` (remote D1) if migrations were added.
4. `pnpm deploy`.
5. Ensure WorkOS/Stripe/FAL webhook URLs point at the deployed `APP_URL`.
