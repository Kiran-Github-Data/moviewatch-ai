/**
 * In-process token-bucket rate limiter. TMDB allows ~40 requests per
 * 10 seconds per IP; we stay well under that with 30/10s and queue
 * instead of bursting, so a sync storm never gets the key throttled.
 */
export class TokenBucket {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private readonly capacity: number = 30,
    private readonly refillPerMs: number = 30 / 10_000,
    private readonly now: () => number = Date.now,
  ) {
    this.tokens = capacity;
    this.lastRefill = now();
  }

  private refill(): void {
    const t = this.now();
    const elapsed = t - this.lastRefill;
    if (elapsed > 0) {
      this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerMs);
      this.lastRefill = t;
    }
  }

  /** ms until at least one token is available (0 = available now). */
  msUntilAvailable(): number {
    this.refill();
    if (this.tokens >= 1) return 0;
    return Math.ceil((1 - this.tokens) / this.refillPerMs);
  }

  tryTake(): boolean {
    this.refill();
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }

  async take(): Promise<void> {
    while (!this.tryTake()) {
      await new Promise((r) => setTimeout(r, this.msUntilAvailable()));
    }
  }
}
