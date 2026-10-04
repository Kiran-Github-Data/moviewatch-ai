# ADR-001: Monorepo with split web/API deployment

**Date:** 2026-10-03 · **Status:** accepted

## Context

The product needs a premium web UI, a business-logic API, durable workflow
workers, and browser automation. Vercel cannot run Playwright, hold persistent
connections (Temporal client, Prisma pool), or run long-lived workers.

## Decision

- Turborepo + pnpm workspaces monorepo.
- `apps/web` (Next.js) deploys to Vercel as a thin UI + BFF — no business
  logic, no secrets, no direct DB access.
- `apps/orchestrator-api` (Fastify) and workers deploy to Fly.io as
  persistent processes.
- `packages/contracts` (Zod) is the single source of truth for API shapes and
  the booking state machine; `packages/agent-core` and `packages/policy-engine`
  (later milestones) stay dependency-light and heavily tested.

## Consequences

- Two deploy targets, one CI pipeline.
- Web↔API communicate over HTTPS with Clerk JWTs; the API re-verifies every
  request and enforces resource ownership per route.
