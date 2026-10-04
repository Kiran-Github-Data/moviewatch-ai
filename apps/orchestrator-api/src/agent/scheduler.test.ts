import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  intervalForFrequency,
  isWatchDue,
  CHECK_FREQUENCY_INTERVAL_MS,
} from "./scheduler.js";

describe("intervalForFrequency", () => {
  it("maps each frequency to its interval", () => {
    assert.equal(intervalForFrequency("every_15_min"), 15 * 60 * 1000);
    assert.equal(intervalForFrequency("hourly"), 60 * 60 * 1000);
    assert.equal(intervalForFrequency("every_6_hours"), 6 * 60 * 60 * 1000);
    assert.equal(intervalForFrequency("daily"), 24 * 60 * 60 * 1000);
  });
  it("defaults unknown/null/undefined to every_15_min", () => {
    assert.equal(intervalForFrequency("bogus"), CHECK_FREQUENCY_INTERVAL_MS.every_15_min);
    assert.equal(intervalForFrequency(null), CHECK_FREQUENCY_INTERVAL_MS.every_15_min);
    assert.equal(intervalForFrequency(undefined), CHECK_FREQUENCY_INTERVAL_MS.every_15_min);
  });
});

describe("isWatchDue", () => {
  const now = new Date("2026-10-04T12:00:00Z");

  it("is due when never checked", () => {
    assert.equal(isWatchDue({ checkFrequency: "daily", lastCheckedAt: null }, now), true);
    assert.equal(isWatchDue({}, now), true);
  });

  it("is not due when the interval has not elapsed", () => {
    const fiveMinAgo = new Date(now.getTime() - 5 * 60 * 1000);
    assert.equal(
      isWatchDue({ checkFrequency: "every_15_min", lastCheckedAt: fiveMinAgo }, now),
      false,
    );
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    assert.equal(
      isWatchDue({ checkFrequency: "daily", lastCheckedAt: oneHourAgo }, now),
      false,
    );
  });

  it("is due when the interval has elapsed", () => {
    const twentyMinAgo = new Date(now.getTime() - 20 * 60 * 1000);
    assert.equal(
      isWatchDue({ checkFrequency: "every_15_min", lastCheckedAt: twentyMinAgo }, now),
      true,
    );
    const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
    assert.equal(
      isWatchDue({ checkFrequency: "daily", lastCheckedAt: twoDaysAgo }, now),
      true,
    );
  });

  it("is due exactly at the boundary", () => {
    const exactly = new Date(now.getTime() - 60 * 60 * 1000);
    assert.equal(
      isWatchDue({ checkFrequency: "hourly", lastCheckedAt: exactly }, now),
      true,
    );
  });
});
