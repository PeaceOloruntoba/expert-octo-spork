import { query } from '../db/pool';

interface AuditEntry {
  actorId: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  metadata?: Record<string, unknown>;
}

/** Writes an immutable audit trail entry. Never throws into the caller's request
 * flow — a logging failure shouldn't fail the underlying action, but it is logged
 * to stderr so it isn't silently lost. */
export async function recordAudit(entry: AuditEntry): Promise<void> {
  try {
    await query(
      `INSERT INTO audit_logs (actor_id, action, resource_type, resource_id, metadata)
       VALUES ($1, $2, $3, $4, $5)`,
      [entry.actorId, entry.action, entry.resourceType, entry.resourceId ?? null, JSON.stringify(entry.metadata ?? {})]
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[audit] Failed to write audit log entry', err);
  }
}
