/**
 * MovieWatch ticket-monitoring deep agent (LangGraph deepagents).
 *
 * Hybrid design: a deterministic cron (scheduler.ts) triggers this agent per
 * watch every 15 minutes. The agent's ONLY LLM job is fuzzy preference
 * matching (offers vs the user's ranked theaters/days/windows/formats). All
 * money decisions — actionMode, consent, spending caps — are enforced in the
 * purchase_tickets tool code and can never be overridden by the model.
 *
 * Each watch gets its own thread_id ("watch-<id>") so the Postgres
 * checkpointer keeps per-watch conversation state across cycles.
 */
import { createDeepAgent, type DeepAgent } from "deepagents";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import type { PrismaClient } from "@moviewatch/database";
import {
  checkShowtimes,
  sendEmailAlert,
  purchaseTickets,
  loadWatchForAgent,
  type AgentDeps,
} from "./tools.js";
import { browseTheaterSite, checkAvailability } from "./browser-tools.js";

const AGENT_MODEL = process.env.AGENT_MODEL ?? "groq:llama-3.3-70b-versatile";

const SYSTEM_PROMPT = `You are MovieWatch's ticket agent. You monitor one movie watch per run.

For the given watch:
1. Call check_showtimes with the watchId to get current offers.
2. Compare each offer against the watch's ranked preferences:
   - theatersRank1 (strongly preferred) and theatersRank2 (acceptable)
   - preferred days, time windows, and formats
   - max price per ticket
   - seat rules
   Pick the best matching offer. Prefer rank1 theaters; among matches prefer
   the cheapest. If NO offer matches the preferences, reply exactly "no_match"
   and stop — do not call any other tool.
3. If an offer matches, look at the watch's actionMode:
   - "notify": call send_email_alert with a beautiful booking alert email
     (movie title, theater, showtime, price, booking link, warm cinematic tone).
     Then reply "notified".
   - "autobook": call purchase_tickets with the watchId and the chosen offerId.
     Spending caps and consent are enforced by the tool itself — if it returns
     REFUSED, report the refusal reason and stop. Then reply "booked" or
     "refused: <reason>".
5. If API data is insufficient (check_showtimes returns no usable offers), you
   may use browse_theater_site to check theater websites directly, and
   check_availability for a deeper read of a specific showtime page. Only
   browse theater sites for this watch's configured theaters. If a tool
   returns BLOCKED (CAPTCHA, login wall, bot protection), stop trying that
   site — never attempt to bypass it. Never purchase through the browser;
   purchasing happens ONLY via purchase_tickets.

Rules you must never break:
- Never invent offers. Only use offers returned by check_showtimes.
- Never exceed the spending cap — the purchase tool enforces it; do not try
  to work around a REFUSED response.
- Never call purchase_tickets for a watch whose actionMode is "notify".
- Keep replies short: one of no_match | notified | booked | refused: <reason>.`;

export interface WatchAgentDeps extends AgentDeps {
  db: PrismaClient;
}

let checkpointerPromise: Promise<PostgresSaver> | null = null;

/** Lazily create (and set up) the Postgres checkpointer. Throws if DATABASE_URL is missing. */
export async function getCheckpointer(): Promise<PostgresSaver> {
  if (!checkpointerPromise) {
    checkpointerPromise = (async () => {
      const connString = process.env.DATABASE_URL;
      if (!connString) throw new Error("DATABASE_URL is required for the watch agent checkpointer");
      const saver = PostgresSaver.fromConnString(connString);
      await saver.setup();
      return saver;
    })();
  }
  return checkpointerPromise;
}

/** For tests: reset the cached checkpointer. */
export function resetCheckpointer(): void {
  checkpointerPromise = null;
}

/**
 * Build the deep agent for ticket monitoring. The agent is cheap (haiku) and
 * stateless across watches except for the per-watch checkpoint thread.
 */
export async function createWatchAgent(deps: WatchAgentDeps): Promise<DeepAgent> {
  const checkpointer = await getCheckpointer();
  return createDeepAgent({
    model: AGENT_MODEL,
    systemPrompt: SYSTEM_PROMPT,
    tools: [
      checkShowtimes(deps),
      sendEmailAlert(deps),
      purchaseTickets(deps),
      browseTheaterSite({ db: deps.db }),
      checkAvailability({ db: deps.db }),
    ],
    checkpointer,
    name: "moviewatch-ticket-agent",
  });
}

export interface AgentRunInput {
  watchId: string;
  /** Snapshot of the watch's preferences for the agent's matching step. */
  preferencesSummary: string;
}

export interface AgentRunResult {
  watchId: string;
  outcome: "no_match" | "notified" | "booked" | "refused" | "error";
  detail: string;
}

/**
 * Run one agent pass for a single watch. Resumable via thread_id per watch.
 * Never throws — errors are captured in the result so one bad watch can't
 * kill a scheduler batch.
 */
export async function runWatchAgent(
  deps: WatchAgentDeps,
  input: AgentRunInput,
): Promise<AgentRunResult> {
  try {
    const watch = await loadWatchForAgent(deps.db, input.watchId);
    if (!watch) {
      return { watchId: input.watchId, outcome: "error", detail: "watch not found" };
    }
    const agent = await createWatchAgent(deps);
    const result = await agent.invoke(
      {
        messages: [
          {
            role: "user",
            content:
              `Check watch ${input.watchId} for "${watch.movieTitle}".\n` +
              `actionMode: ${watch.actionMode}\n` +
              `Preferences: ${input.preferencesSummary}\n` +
              `Max price per ticket: ${watch.maxTicketPriceCents}c, tickets: ${watch.ticketCount}.`,
          },
        ],
      },
      { configurable: { thread_id: `watch-${input.watchId}` } },
    );
    const last = result.messages?.[result.messages.length - 1];
    const text =
      typeof last?.content === "string"
        ? last.content
        : JSON.stringify(last?.content ?? "");
    const lower = text.toLowerCase();
    if (lower.startsWith("no_match")) return { watchId: input.watchId, outcome: "no_match", detail: text };
    if (lower.startsWith("notified")) return { watchId: input.watchId, outcome: "notified", detail: text };
    if (lower.startsWith("booked")) return { watchId: input.watchId, outcome: "booked", detail: text };
    if (lower.startsWith("refused")) return { watchId: input.watchId, outcome: "refused", detail: text };
    return { watchId: input.watchId, outcome: "error", detail: `unrecognized agent reply: ${text.slice(0, 200)}` };
  } catch (err) {
    return {
      watchId: input.watchId,
      outcome: "error",
      detail: err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300),
    };
  }
}

/** Build a compact human-readable preference summary for the agent prompt. */
export function buildPreferencesSummary(watch: {
  theatersRank1: string[];
  theatersRank2: string[];
  maxTicketPriceCents: number;
  ticketCount: number;
}): string {
  const parts: string[] = [];
  if (watch.theatersRank1.length) parts.push(`theaters rank1: ${watch.theatersRank1.join(", ")}`);
  if (watch.theatersRank2.length) parts.push(`theaters rank2: ${watch.theatersRank2.join(", ")}`);
  parts.push(`max ${watch.maxTicketPriceCents}c/ticket`, `${watch.ticketCount} ticket(s)`);
  return parts.join("; ");
}
