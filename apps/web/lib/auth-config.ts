/**
 * Central auth-configuration check. The app degrades gracefully when Clerk
 * keys are not configured (marketing pages render, auth routes explain the
 * missing setup) instead of crashing at build/prerender time.
 *
 * Real deployments MUST set NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY (and
 * CLERK_SECRET_KEY for the API) from the Clerk dashboard.
 */
export const CLERK_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "";

const PLACEHOLDER_PATTERNS = ["replace_me", "placeholder", "YOUR_", "example"];

export const isAuthConfigured =
  CLERK_PUBLISHABLE_KEY.startsWith("pk_test_") ||
  CLERK_PUBLISHABLE_KEY.startsWith("pk_live_")
    ? !PLACEHOLDER_PATTERNS.some((p) =>
        CLERK_PUBLISHABLE_KEY.toLowerCase().includes(p.toLowerCase()),
      )
    : false;
