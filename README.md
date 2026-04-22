# Pigmint

Pigmint is an AI image and video generation workspace. It combines a Vite/React client with a Cloudflare Worker API for authentication, billing, model catalog sync, moderation, generation jobs, and saved gallery assets.

## Features

- Image and video generation through FAL models.
- Synced model catalog with pricing-derived credit costs, featured models, thumbnails, aspect ratios, batch image counts, resolution, and quality options.
- GPT Image 2 and GPT Image 2 Edit support.
- Free-plan guardrails for image generations at 10 credits or below.
- Reference image uploads, signed reference URLs, prompt moderation, and output moderation.
- Gallery with folders, bookmarks, thumbnails, detail pages, and downloads.
- Prompt assistant, billing/top-up flows, Terms of Service, and Privacy Policy pages.

## Stack

- Frontend: React 18, Vite, React Router, TanStack Query, Tailwind CSS, Radix UI, cmdk, Framer Motion.
- Worker API: Cloudflare Workers, Hono, D1, R2, KV.
- Auth: WorkOS.
- Billing: Stripe.
- Generation: FAL queue APIs and webhooks.
- Moderation: OpenAI API.

## Project Layout

```text
src/                 React SPA
src/routes/          Route-level pages
src/components/      App UI and shadcn-style primitives
worker/              Cloudflare Worker API
worker/routes/       Hono route modules
worker/lib/          Pricing, catalog, moderation, IDs, signed refs
worker/db/           D1 migrations
shared/              Shared constants used by client and worker
scripts/             Catalog sync and regression tests
docs/plans/          Design notes
```

## Setup

Install dependencies:

```bash
pnpm install
```

Create local environment files as needed:

```bash
cp wrangler.example.toml wrangler.toml
```

Use `.env.local` for local scripts such as catalog sync:

```text
FAL_KEY=...
```

Use Wrangler secrets for Worker runtime secrets:

```bash
wrangler secret put FAL_KEY
wrangler secret put WORKOS_API_KEY
wrangler secret put WORKOS_CLIENT_ID
wrangler secret put WORKOS_COOKIE_PASSWORD
wrangler secret put STRIPE_SECRET_KEY
wrangler secret put STRIPE_WEBHOOK_SECRET
wrangler secret put OPENAI_API_KEY
```

Set `APP_URL` in Wrangler vars for the deployed public origin.

## Development

Run the Vite app:

```bash
pnpm dev
```

Run the Cloudflare Worker preview:

```bash
pnpm preview
```

Apply D1 migrations locally:

```bash
pnpm db:migrate:local
```

Sync the generated FAL catalog:

```bash
pnpm sync:catalog
```

The sync writes `worker/lib/catalog.generated.json` and uses `scripts/.fal-catalog-cache.json` as a local ignored cache.

## Verification

```bash
pnpm test
pnpm typecheck
pnpm build
```

`pnpm test` covers catalog derivation, FAL input shaping, free-generation credit caps, public legal routes, and client route splitting.

## Deployment

1. Sync the model catalog if model metadata or pricing needs refreshing.
2. Run `pnpm build`.
3. Apply remote migrations with `pnpm db:migrate`.
4. Deploy with `pnpm deploy`.
5. Configure WorkOS, Stripe, and FAL webhook URLs for the deployed `APP_URL`.

The Worker serves the built SPA from `dist` and exposes API routes under `/api`.

## Generated and Local Files

These should stay local and are ignored:

- `node_modules`
- `dist`
- `.wrangler`
- `.env`, `.env.local`, `.dev.vars`
- `*.log`
- `scripts/.fal-catalog-cache.json`

Do not commit local secrets or provider credentials.
