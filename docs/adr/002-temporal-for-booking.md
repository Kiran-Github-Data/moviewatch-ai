# ADR-002: Temporal for the booking state machine, BullMQ for poll ticks

**Date:** 2026-10-03 · **Status:** accepted

## Context

Two distinct workloads: (a) cheap, high-volume monitoring ticks (~11M/mo at
10k watches), (b) the money-moving booking state machine with human-in-the-loop
branches, retries, and an audit trail. See `research/orchestration-stack.md`.

## Decision

- **Temporal** owns the watch lifecycle + booking path: one workflow per watch,
  signals for cancel/preference-update/auth-completed, queries for the live
  timeline UI, `continueAsNew` every ~1,000 polls, workflow-ID idempotency.
- **BullMQ** (or Inngest cron) owns the poll scheduler: cheap repeatable ticks.
- Booking claims use Postgres advisory transaction locks + idempotency keys —
  atomic with the reservation write, no separate lock service needed.

## Consequences

- Workers and Temporal server run on Fly.io (not Vercel).
- Start on Temporal Cloud paygo for zero ops; migrate to self-hosted when the
  Actions bill justifies it.
