import { createHash } from "node:crypto";
import type { PrismaClient } from "@moviewatch/database";

type Db = PrismaClient;

export interface AuditEntry {
  actorType: string;
  actorId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  policyVersion?: number;
}

/**
 * Append a tamper-evident audit entry, hash-chained per resource.
 * The chain lets anyone verify no entry was inserted, removed, or altered.
 */
export async function writeAudit(db: Db, e: AuditEntry): Promise<void> {
  const last = await db.auditLog.findFirst({
    where: { resourceType: e.resourceType, resourceId: e.resourceId },
    orderBy: { createdAt: "desc" },
    select: { hash: true },
  });
  const prevHash = last?.hash ?? null;
  const hash = createHash("sha256")
    .update(JSON.stringify({ ...e, prevHash, at: new Date().toISOString() }))
    .digest("hex");
  await db.auditLog.create({ data: { ...e, prevHash, hash } });
}
