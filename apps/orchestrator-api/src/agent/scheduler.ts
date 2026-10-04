/**
 * Agent scheduler: runs the LangGraph deep agent across watches every 15 min.
 *
 * Hybrid design:
 *  - node-cron triggers a cycle (deterministic, cheap).
 *  - Deterministic pre-filter: skip the LLM entirely when a watch has zero
 *    offers (check_showtimes is cheap; the model call is not).
 *  - Candidate watches each get one deep-agent pass with a per-watch
 *    thread_id, so checkpoint state resumes across cycles.
 *  - Resilience: each watch is wrapped in try/catch — one bad watch never
 *    kills the batch.
 *
 * The scheduler is disabled (with a warning) when GROQ_API_KEY is unset.
 * Run: `node dist/agent/scheduler.js` (see fly.toml [processes] agent_worker).
 */
import cron from "node-cron";
import { getPrisma } from "@moviewatch/database";
import type { PrismaClient } from "@moviewatch/database";
import { writeAudit } from "../lib/audit.js";
import {
  selectTicketProvider,
  type TicketProvider,
} from "../lib/monitor.js";
import {
  runWatchAgent,
  buildPreferencesSummary,
  type WatchAgentDeps,
} from "./watchAgent.js";
import { loadWatchForAgent } from "./tools.js";

const CRON_SCHEDULE = process.env.AGENT_CRON ?? "*/15 * * * *";

function agentEnabled(): boolean {
  return Boolean(process.env.GROQ_API_KEY);
}

function provider(db: PrismaClient): TicketProvider {
  return selectTicketProvider(db);
}

/**
 * Per-watch check frequencies (user-configurable at watch creation).
 * The cron tick runs at the finest granularity (15 min); each watch is only
 * checked when it is "due" based on its own frequency + lastCheckedAt.
 */
export const CHECK_FREQUENCY_INTERVAL_MS: Record<string, number> = {
  every_15_min: 15 * 60 * 1000,
  hourly: 60 * 60 * 1000,
  every_6_hours: 6 * 60 * 60 * 1000,
  daily: 24 * 60 * 60 * 1000,
};

const DEFAULT_CHECK_INTERVAL_MS = 15 * 60 * 1000;

export function intervalForFrequency(checkFrequency: string | null | undefined): number {
  if (!checkFrequency) return DEFAULT_CHECK_INTERVAL_MS;
  const ms: number | undefined = CHECK_FREQUENCY_INTERVAL_MS[checkFrequency];
  return ms ?? DEFAULT_CHECK_INTERVAL_MS;
}

/** True when a watch has never been checked or its interval has elapsed. */
export function isWatchDue(
  watch: { checkFrequency?: string | null; lastCheckedAt?: Date | null },
  now: Date = new Date(),
): boolean {
  if (!watch.lastCheckedAt) return true;
  return now.getTime() - watch.lastCheckedAt.getTime() >= intervalForFrequency(watch.checkFrequency);
}

export interface CycleSummary {
  checked: number;
  skipped_not_due: number;
  skipped_no_offers: number;
  no_match: number;
  notified: number;
  booked: number;
  refused: number;
  error: number;
}

/** One full agent cycle over all ARMED/MONITORING watches. */
export async function runAgentCycle(deps?: Partial<WatchAgentDeps>): Promise<CycleSummary> {
  const summary: CycleSummary = {
    checked: 0,
    skipped_not_due: 0,
    skipped_no_offers: 0,
    no_match: 0,
    notified: 0,
    booked: 0,
    refused: 0,
    error: 0,
  };
  const db = deps?.db ?? getPrisma();
  const ticketProvider = deps?.provider ?? provider(db);
  const agentDeps: WatchAgentDeps = { db, provider: ticketProvider, stripeClient: deps?.stripeClient };
  const now = new Date();

  const watches = await db.movieWatch.findMany({
    where: { status: { in: ["ARMED", "MONITORING"] } },
    select: { id: true, checkFrequency: true, lastCheckedAt: true },
  });
  const dueWatches = watches.filter((w) => isWatchDue(w, now));
  summary.skipped_not_due = watches.length - dueWatches.length;

  for (const w of dueWatches) {
    try {
      summary.checked += 1;
      // Deterministic pre-filter: no offers → skip the LLM call entirely.
      const snapshot = await loadWatchForAgent(db, w.id);
      if (!snapshot) {
        summary.error += 1;
        continue;
      }
      const offers = await ticketProvider.findOffers(snapshot);
      if (offers.length === 0) {
        summary.skipped_no_offers += 1;
        continue;
      }
      const result = await runWatchAgent(agentDeps, {
        watchId: w.id,
        preferencesSummary: buildPreferencesSummary(snapshot),
      });
      summary[result.outcome] = (summary[result.outcome] ?? 0) + 1;
      await writeAudit(db, {
        actorType: "system",
        actorId: "agent-scheduler",
        action: `agent.cycle_${result.outcome}`,
        resourceType: "MovieWatch",
        resourceId: w.id,
      }).catch(() => {});
    } catch (err) {
      summary.error += 1;
      await writeAudit(db, {
        actorType: "system",
        actorId: "agent-scheduler",
        action: "agent.cycle_error",
        resourceType: "MovieWatch",
        resourceId: w.id,
      }).catch(() => {});
      void err;
    } finally {
      // Stamp the check time so per-watch frequencies are honored, even
      // when this pass errored (a check was attempted).
      await db.movieWatch
        .update({ where: { id: w.id }, data: { lastCheckedAt: now } })
        .catch(() => {});
    }
  }
  return summary;
}

async function main(): Promise<void> {
  if (!agentEnabled()) {
    console.warn(
      "[agent-scheduler] GROQ_API_KEY is not set — deep agent disabled. " +
        "Set it to enable LLM-powered ticket monitoring.",
    );
    // Keep the process alive but idle so Fly doesn't restart-loop; the
    // deterministic worker (src/worker.ts) still handles monitoring.
    await new Promise(() => {});
    return;
  }
  console.log(`[agent-scheduler] starting, schedule="${CRON_SCHEDULE}"`);
  // Run once at boot, then on the cron schedule.
  const tick = async () => {
    try {
      const summary = await runAgentCycle();
      console.log("[agent-scheduler] cycle complete", JSON.stringify(summary));
    } catch (err) {
      console.error("[agent-scheduler] cycle failed", err);
    }
  };
  await tick();
  cron.schedule(CRON_SCHEDULE, tick);
}

// Only auto-run when executed directly (not when imported by tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error("[agent-scheduler] fatal", err);
    process.exit(1);
  });
}
