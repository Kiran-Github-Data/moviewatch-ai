/**
 * Watch monitoring worker (Milestone 5).
 *
 * Runs `runMonitorCycle` every 15 minutes: every ARMED/MONITORING watch is
 * checked for ticket availability, and auto-booking fires when the user
 * authorized it.
 *
 * Run: `pnpm --filter @moviewatch/orchestrator-api worker`
 *      (tsx src/worker.ts). On Fly, run as a second process next to the API.
 *
 * For demos/tests without a ticketing partnership, set MOCK_TICKETS_JSON
 * to a JSON array of TicketOffer to simulate availability.
 */
import "dotenv/config";
import { getPrisma } from "@moviewatch/database";
import { runMonitorCycle, selectTicketProvider } from "./lib/monitor.js";

const INTERVAL_MS = 15 * 60 * 1000;

async function cycle(): Promise<void> {
  const started = Date.now();
  try {
    const db = getPrisma();
    const summary = await runMonitorCycle({ db, provider: selectTicketProvider(db) });
    console.log(
      JSON.stringify({ at: new Date().toISOString(), event: "monitor.cycle", summary, ms: Date.now() - started }),
    );
  } catch (err) {
    console.error(
      JSON.stringify({
        at: new Date().toISOString(),
        event: "monitor.cycle_error",
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}

console.log(
  JSON.stringify({ at: new Date().toISOString(), event: "monitor.worker_start", intervalMs: INTERVAL_MS }),
);
void cycle();
const timer = setInterval(() => void cycle(), INTERVAL_MS);
timer.unref?.();

// Graceful shutdown (Fly sends SIGINT/SIGTERM).
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    clearInterval(timer);
    process.exit(0);
  });
}
