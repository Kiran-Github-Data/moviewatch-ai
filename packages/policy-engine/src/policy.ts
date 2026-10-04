import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import {
  PolicyDocumentSchema,
  type PolicyDocument,
} from "@moviewatch/contracts";

/**
 * Deterministic spending-policy engine (PLAN.md §8). No LLM anywhere in
 * this package: policies are minted from validated inputs, HMAC-signed,
 * and verified with a timing-safe comparison. Fail-closed on any problem.
 */

// Global hard caps — no per-watch policy can override these.
export const MAX_TXN_CENTS = 50_000; // $500 per transaction
export const MAX_USER_DAY_CENTS = 200_000; // $2,000 per user per day (enforced at charge time)

export class PolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PolicyError";
  }
}

export class PolicySigningNotConfiguredError extends Error {
  constructor() {
    super("POLICY_SIGNING_SECRET is not set. Set it on the API server to mint policies.");
    this.name = "PolicySigningNotConfiguredError";
  }
}

function getSecret(override?: string): string {
  const s = override ?? process.env.POLICY_SIGNING_SECRET;
  if (!s) throw new PolicySigningNotConfiguredError();
  return s;
}

/** Canonical JSON with stable key order — signatures must be reproducible. */
export function canonicalJson(doc: PolicyDocument): string {
  const ordered: Record<string, unknown> = {};
  for (const k of Object.keys(doc).sort()) {
    ordered[k] = (doc as Record<string, unknown>)[k];
  }
  return JSON.stringify(ordered);
}

/** sha256 hex of the canonical document — the value the user reviews/accepts. */
export function policyHash(doc: PolicyDocument): string {
  return createHash("sha256").update(canonicalJson(doc)).digest("hex");
}

/**
 * The policy *terms* (everything except issuedAt). The arm handshake binds
 * the user's acceptance to these terms: the client reviews the preview,
 * then sends policyTermsHash back. The server re-mints (fresh issuedAt)
 * and accepts only if the terms hash matches — so the user can never
 * approve limits different from what was minted.
 */
export function policyTerms(doc: PolicyDocument): Omit<PolicyDocument, "issuedAt"> {
  const { issuedAt: _issuedAt, ...terms } = doc;
  return terms;
}

export function policyTermsHash(doc: PolicyDocument): string {
  const terms = policyTerms(doc) as Record<string, unknown>;
  const ordered: Record<string, unknown> = {};
  for (const k of Object.keys(terms).sort()) ordered[k] = terms[k];
  return createHash("sha256").update(JSON.stringify(ordered)).digest("hex");
}

export function signPolicy(doc: PolicyDocument, secret?: string): string {
  return createHmac("sha256", getSecret(secret)).update(canonicalJson(doc)).digest("hex");
}

export function verifyPolicySignature(
  doc: PolicyDocument,
  signature: string,
  secret?: string,
): boolean {
  let expected: string;
  try {
    expected = signPolicy(doc, secret);
  } catch {
    return false;
  }
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function enforceGlobalCaps(doc: PolicyDocument): void {
  if (doc.maxTotalCents > MAX_TXN_CENTS) {
    throw new PolicyError(
      `maxTotalCents ${doc.maxTotalCents} exceeds the $${MAX_TXN_CENTS / 100} per-transaction hard cap`,
    );
  }
  if (doc.maxTicketPriceCents > MAX_TXN_CENTS) {
    throw new PolicyError(
      `maxTicketPriceCents ${doc.maxTicketPriceCents} exceeds the $${MAX_TXN_CENTS / 100} per-transaction hard cap`,
    );
  }
}

export interface MintPolicyInput {
  watchId: string;
  userId: string;
  tmdbId: number;
  preferences: {
    maxTicketPriceCents: number;
    ticketCount: number;
    theaterIds: string[];
  }[];
  expiresAt: string; // ISO datetime
  requireHumanApprovalAboveCents?: number;
  allowedProvider?: string;
}

/**
 * Build (but do not sign) the policy document. Used for previews —
 * the signature is only minted at arm time.
 */
export function buildPolicyDocument(input: MintPolicyInput): PolicyDocument {
  if (input.preferences.length === 0) {
    throw new PolicyError("policy requires at least one preference");
  }
  const allowedTheaterIds = [...new Set(input.preferences.flatMap((p) => p.theaterIds))];
  if (allowedTheaterIds.length === 0) {
    throw new PolicyError("policy requires at least one allowed theater");
  }

  const maxTicketPriceCents = Math.max(...input.preferences.map((p) => p.maxTicketPriceCents));
  const maxTickets = Math.max(...input.preferences.map((p) => p.ticketCount));
  const maxTotalCents = maxTicketPriceCents * maxTickets;

  const document = PolicyDocumentSchema.parse({
    version: 1,
    watchId: input.watchId,
    userId: input.userId,
    tmdbId: input.tmdbId,
    maxTicketPriceCents,
    maxTotalCents,
    maxTickets,
    allowedTheaterIds,
    allowedProvider: input.allowedProvider ?? "atom",
    expiresAt: input.expiresAt,
    requireHumanApprovalAboveCents: input.requireHumanApprovalAboveCents ?? maxTotalCents,
    issuedAt: new Date().toISOString(),
  });

  enforceGlobalCaps(document);
  return document;
}

/**
 * Mint a signed policy from a watch's preferences. Fail-closed:
 * throws PolicyError on any invalid input, PolicySigningNotConfiguredError
 * when the signing secret is missing.
 */
export function mintPolicy(
  input: MintPolicyInput,
  secret?: string,
): { document: PolicyDocument; signature: string } {
  const document = buildPolicyDocument(input);
  return { document, signature: signPolicy(document, secret) };
}
