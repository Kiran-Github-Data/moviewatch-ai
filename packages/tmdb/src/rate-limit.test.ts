import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { TokenBucket } from "./rate-limit.js";

describe("TokenBucket", () => {
  it("allows bursts up to capacity then blocks", () => {
    const bucket = new TokenBucket(3, 0); // no refill
    assert.equal(bucket.tryTake(), true);
    assert.equal(bucket.tryTake(), true);
    assert.equal(bucket.tryTake(), true);
    assert.equal(bucket.tryTake(), false, "fourth take blocked at capacity 3");
  });

  it("refills over time", () => {
    let now = 0;
    const bucket = new TokenBucket(2, 1 / 1000, () => now); // 1 token/sec
    assert.equal(bucket.tryTake(), true);
    assert.equal(bucket.tryTake(), true);
    assert.equal(bucket.tryTake(), false);
    now += 1500;
    assert.equal(bucket.tryTake(), true, "one token refilled after 1.5s");
    assert.equal(bucket.tryTake(), false);
  });

  it("msUntilAvailable returns 0 when a token is ready", () => {
    const bucket = new TokenBucket(5, 0);
    assert.equal(bucket.msUntilAvailable(), 0);
  });

  it("msUntilAvailable estimates the wait when empty", () => {
    let now = 0;
    const bucket = new TokenBucket(1, 1 / 1000, () => now);
    bucket.tryTake();
    const wait = bucket.msUntilAvailable();
    assert.ok(wait > 0 && wait <= 1000, `expected ~1000ms, got ${wait}`);
  });
});
