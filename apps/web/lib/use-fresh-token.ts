"use client";

import { useCallback } from "react";
import { useAuth } from "@clerk/nextjs";
import type { TokenGetter } from "@/lib/api";

/**
 * Returns a token getter that bypasses Clerk's in-memory cache.
 * Clerk session tokens expire after ~60s; the default cached getToken()
 * can hand back an expired token during long multi-step flows (e.g. the
 * watch wizard), surfacing as "session expired". Forcing a refresh per
 * call costs one Clerk roundtrip but guarantees a live token.
 */
export function useFreshToken(): TokenGetter {
  const { getToken } = useAuth();
  return useCallback(() => getToken({ skipCache: true }), [getToken]);
}
