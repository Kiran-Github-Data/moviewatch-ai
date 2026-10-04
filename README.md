# MovieWatch AI

AI-powered future movie ticket auto-booking: set your movie preferences now, our AI watches
for ticket releases, tickets get booked automatically when they go live.

## Milestone 2 — movie discovery (current)

- `packages/tmdb` — typed server-side TMDB client (v4 bearer / v3 key), in-process
  token-bucket rate limiter, image-URL helpers, Zod-validated responses.
- `apps/orchestrator-api` — public `GET /api/v1/movies/upcoming|trending|now-playing|search|/:id`
  (TMDB-backed; 10-min in-memory list cache; `/:id` is DB-first with TTL enforcement —
  7 days for unreleased, 90 days for released, 6-month cap per TMDB terms).
- `apps/web` — `/movies` browse page (Upcoming / Trending / Now Playing tabs + search)
  and `/movies/[id]` detail page (cast, trailer, TMDB attribution), Framer Motion cards.
- `packages/database` — `Movie` gains `popularity`, `voteAverage`, `detailsJson`
  (JSON details cache); baseline migration `prisma/migrations/0001_init/`.

Without `TMDB_READ_ACCESS_TOKEN`/`TMDB_API_KEY` the API returns 503 on `/movies/*`
and the web shows a setup notice — no crashes, no key leaks.

## Launch blockers (tracked, not yet resolved)

- **TMDB commercial agreement** — the free tier is non-commercial only; a paid/commercial
  agreement is required before public launch (PLAN.md §6 Tier 0).
- **Atom Tickets partnership** — the Partner API is read-only + `checkoutUrl` handoff;
  platform-executed purchase is partnership-gated (PLAN.md §0, corrected 2026-10-03).

## Milestone 1 — foundation + auth

- `apps/web` — Next.js (App Router) on Vercel. Run `pnpm --filter @moviewatch/web dev`.
- `apps/orchestrator-api` — Fastify service on Fly.io. Run `pnpm --filter @moviewatch/orchestrator-api dev`.
- `packages/database` — Prisma + PostgreSQL. `pnpm --filter @moviewatch/database db:push` (dev) or `db:migrate`.
- `packages/contracts` — shared Zod schemas + the booking state machine (`canTransition`).
- `packages/ui` — cinematic design system (Button, StatusBadge, EmptyState, theme tokens).
- `packages/agent-core`, `packages/policy-engine`, `packages/security` — land in later milestones.

## Setup

1. `cp .env.example .env` and fill in:
   - **Clerk**: create an application at [clerk.com](https://clerk.com), put the publishable key in
     `apps/web` (`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`) and the secret key + JWKS URL/issuer in the API env.
     Until real keys are set, sign-in pages render but authentication will fail — expected.
   - **Database**: `DATABASE_URL` pointing at Postgres (Neon for prod, local Docker for dev).
   - **TMDB**: create an API key at [themoviedb.org](https://www.themoviedb.org/settings/api)
     and set `TMDB_READ_ACCESS_TOKEN` (v4, preferred) or `TMDB_API_KEY` (v3) in the API env.
     Until set, `/movies/*` returns 503 and the web browse page shows a setup notice.
2. `pnpm install`
3. `pnpm --filter @moviewatch/database db:generate && pnpm --filter @moviewatch/database db:push`
4. `pnpm dev` (turbo runs web + api)

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Run everything in watch mode |
| `pnpm build` | Build all packages/apps |
| `pnpm typecheck` | Typecheck everything |
| `pnpm test` | Run unit tests (node:test via tsx) |
| `pnpm lint` | Lint (per-package, wired up as packages add eslint) |

## Security notes (Milestone 1)

- The API verifies Clerk JWTs via JWKS on every protected route; the web app never sees the DB.
- Logger redaction is configured at emit time; the secret-scan CI step fails the build on committed secrets.
- Theater credentials and card data: **never stored** — see `../PLAN.md` §7–§8 for the architecture.

Full product/architecture plan: [`../PLAN.md`](../PLAN.md).
