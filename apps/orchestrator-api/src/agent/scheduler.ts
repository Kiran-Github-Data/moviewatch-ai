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
 * The scheduler is disabled (with a warning) when ANTHROPIC_API_KEY is unset.
 * Run: `node dist/agent/scheduler.js` (see fly.toml [processes] agent_worker).
 */
import cron from "node-cron";
import { getPrisma } from "@moviewatch/database";
import { writeAudit } from "../lib/audit.js";
import {
  EnvTicketProvider,
  MockTicketProvider,
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
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

function provider(): TicketProvider {
  return process.env.MOCK_TICKETS_JSON ? new EnvTicketProvider() : new MockTicketProvider();
}

export interface CycleSummary {
  checked: number;
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
    skipped_no_offers: 0,
    no_match: 0,
    notified: 0,
    booked: 0,
    refused: 0,
    error: 0,
  };
  const db = deps?.db ?? getPrisma();
  const ticketProvider = deps?.provider ?? provider();
  const agentDeps: WatchAgentDeps = { db, provider: ticketProvider, stripeClient: deps?.stripeClient };

  const watches = await db.movieWatch.findMany({
    where: { status: { in: ["ARMED", "MONITORING"] } },
    select: { id: true },
  });

  for (const w of watches) {
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
    }
  }
  return summary;
}

async function main(): Promise<void> {
  if (!agentEnabled()) {
    console.warn(
      "[agent-scheduler] ANTHROPIC_API_KEY is not set — deep agent disabled. " +
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
