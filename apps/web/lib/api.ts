/**
 * Thin BFF helper: the web app never talks to providers, Stripe, or the
 * database directly. Every call goes to the orchestrator API with the
 * user's Clerk session token.
 *
 * Usage (server components / route handlers):
 *   const token = await (await auth()).getToken();
 *   const res = await apiFetch("/watches", { token });
 *
 * Usage (client components — preferred):
 *   const getToken = useFreshToken();
 *   const res = await apiFetchWithAuth("/watches", getToken, { method: "POST", body });
 * `apiFetchWithAuth` always fetches a fresh token (Clerk session tokens live
 * ~60s) and retries once on 401, so long multi-step flows like the watch
 * wizard never die with "session expired".
 */
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export async function apiFetch<T>(
  path: string,
  opts: { token?: string | null; method?: string; body?: unknown } = {},
): Promise<T> {
  const hasBody = opts.body !== undefined;
  const res = await fetch(`${API_URL}/api/v1${path}`, {
    method: opts.method ?? "GET",
    headers: {
      // Only send content-type when there's a body — Fastify rejects
      // empty bodies with content-type: application/json.
      ...(hasBody ? { "content-type": "application/json" } : {}),
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
    },
    body: hasBody ? JSON.stringify(opts.body) : undefined,
    cache: "no-store",
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`API ${res.status} on ${path}: ${detail.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

export type TokenGetter = () => Promise<string | null>;

/**
 * Authenticated fetch with a fresh token per call and one 401 retry.
 * `getToken` should bypass Clerk's cache (see useFreshToken).
 */
export async function apiFetchWithAuth<T>(
  path: string,
  getToken: TokenGetter,
  opts: { method?: string; body?: unknown } = {},
): Promise<T> {
  const token = await getToken();
  if (!token) throw new Error("Session expired — please sign in again.");
  try {
    return await apiFetch<T>(path, { ...opts, token });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("API 401")) {
      // Token may have expired mid-flight; force another refresh and retry once.
      const retryToken = await getToken();
      if (!retryToken) throw new Error("Session expired — please sign in again.");
      return await apiFetch<T>(path, { ...opts, token: retryToken });
    }
    throw err;
  }
}
