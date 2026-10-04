import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { canTransition, WATCH_TRANSITIONS, type WatchStatus } from "./index.js";

describe("watch state machine", () => {
  it("allows the documented happy path", () => {
    const path: WatchStatus[] = [
      "CREATED",
      "ARMED",
      "MONITORING",
      "TICKETS_DETECTED",
      "MATCHING_OPTIONS",
      "OPTION_SELECTED",
      "RESERVING_SEATS",
      "CHECKOUT",
      "BOOKED",
    ];
    for (let i = 0; i < path.length - 1; i++) {
      assert.ok(
        canTransition(path[i]!, path[i + 1]!),
        `expected ${path[i]} -> ${path[i + 1]} to be allowed`,
      );
    }
  });

  it("rejects illegal transitions", () => {
    assert.equal(canTransition("CREATED", "BOOKED"), false);
    assert.equal(canTransition("BOOKED", "MONITORING"), false);
    assert.equal(canTransition("CANCELLED", "ARMED"), false);
    assert.equal(canTransition("MONITORING", "CHECKOUT"), false);
  });

  it("terminal states have no exits", () => {
    for (const s of ["BOOKED", "EXPIRED", "CANCELLED", "FAILED"] as WatchStatus[]) {
      assert.deepEqual(WATCH_TRANSITIONS[s], [], `${s} should be terminal`);
    }
  });

  it("every non-terminal state can reach a terminal state", () => {
    const terminals = new Set<WatchStatus>(["BOOKED", "EXPIRED", "CANCELLED", "FAILED"]);
    const canReach = (s: WatchStatus, seen = new Set<WatchStatus>()): boolean => {
      if (terminals.has(s)) return true;
      if (seen.has(s)) return false;
      seen.add(s);
      return (WATCH_TRANSITIONS[s] ?? []).some((n) => canReach(n, new Set(seen)));
    };
    for (const s of Object.keys(WATCH_TRANSITIONS) as WatchStatus[]) {
      assert.ok(canReach(s), `${s} cannot reach a terminal state`);
    }
  });
});
