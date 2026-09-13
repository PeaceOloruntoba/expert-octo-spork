import { Router, Request, Response } from 'express';
import { asyncHandler } from '../../middleware/asyncHandler';
import { requireAuth } from '../../middleware/auth';
import { requireRole } from '../../middleware/role';
import { ok } from '../../utils/apiResponse';
import { query } from '../../db/pool';

const router = Router();

// AD-1: unified case queue across disputes, trust & safety flags, and ethics review —
// the single admin inbox described in the UX doc's Admin Console IA.
router.get(
  '/case-queue',
  requireAuth,
  requireRole('admin'),
  asyncHandler(async (_req: Request, res: Response) => {
    const [disputes, flags, ethics] = await Promise.all([
      query(`SELECT id, 'dispute' AS case_type, reason_category AS summary, status, created_at FROM disputes WHERE status != 'resolved'`),
      query(`SELECT id, 'trust_safety' AS case_type, reason AS summary, status, created_at FROM trust_safety_flags WHERE status = 'open'`),
      query(`SELECT id, 'ethics_review' AS case_type, triggering_rule AS summary, status, created_at FROM ethics_review_cases WHERE status = 'pending'`),
    ]);
    const combined = [...disputes.rows, ...flags.rows, ...ethics.rows].sort(
      (a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
    return ok(res, { queue: combined });
  })
);

// AD-2: platform-wide user directory/search.
router.get(
  '/users',
  requireAuth,
  requireRole('admin'),
  asyncHandler(async (req: Request, res: Response) => {
    const q = (req.query.q as string) ?? '';
    const result = await query(
      `SELECT id, email, role, jurisdiction_code, is_active, email_verified_at, created_at
       FROM users WHERE email ILIKE $1 ORDER BY created_at DESC LIMIT 50`,
      [`%${q}%`]
    );
    return ok(res, { users: result.rows });
  })
);

router.post(
  '/users/:id/deactivate',
  requireAuth,
  requireRole('admin'),
  asyncHandler(async (req: Request, res: Response) => {
    await query('UPDATE users SET is_active = false WHERE id = $1', [req.params.id]);
    return ok(res, { message: 'User deactivated' });
  })
);

router.post(
  '/users/:id/reactivate',
  requireAuth,
  requireRole('admin'),
  asyncHandler(async (req: Request, res: Response) => {
    await query('UPDATE users SET is_active = true WHERE id = $1', [req.params.id]);
    return ok(res, { message: 'User reactivated' });
  })
);

// AD-3: audit log viewer, filterable by resource type / actor.
router.get(
  '/audit-logs',
  requireAuth,
  requireRole('admin'),
  asyncHandler(async (req: Request, res: Response) => {
    const resourceType = req.query.resourceType as string | undefined;
    const actorId = req.query.actorId as string | undefined;
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (resourceType) {
      params.push(resourceType);
      conditions.push(`resource_type = $${params.length}`);
    }
    if (actorId) {
      params.push(actorId);
      conditions.push(`actor_id = $${params.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await query(`SELECT * FROM audit_logs ${where} ORDER BY created_at DESC LIMIT 200`, params);
    return ok(res, { auditLogs: result.rows });
  })
);

export default router;
