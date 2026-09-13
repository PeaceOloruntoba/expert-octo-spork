import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/asyncHandler';
import { requireAuth } from '../../middleware/auth';
import { requireRole } from '../../middleware/role';
import { ok, created } from '../../utils/apiResponse';
import { query } from '../../db/pool';
import { recordAudit } from '../../utils/audit';
import { ApiError } from '../../types';

const router = Router();

// TS-2/TS-3: unified queue for automated flags (from messaging redaction, etc.) and
// manual reports. Admin/Trust & Safety staff triage from here.
router.get(
  '/flags',
  requireAuth,
  requireRole('admin'),
  asyncHandler(async (req: Request, res: Response) => {
    const status = (req.query.status as string) ?? 'open';
    const result = await query('SELECT * FROM trust_safety_flags WHERE status = $1 ORDER BY created_at DESC', [status]);
    return ok(res, { flags: result.rows });
  })
);

const reviewSchema = z.object({ status: z.enum(['dismissed', 'actioned']), notes: z.string().max(2000).optional() });

router.patch(
  '/flags/:id',
  requireAuth,
  requireRole('admin'),
  asyncHandler(async (req: Request, res: Response) => {
    const { status } = reviewSchema.parse(req.body);
    const result = await query(
      `UPDATE trust_safety_flags SET status = $2, reviewed_by = $3, reviewed_at = now() WHERE id = $1 RETURNING *`,
      [req.params.id, status, req.user!.id]
    );
    if (!result.rowCount) throw new ApiError(404, 'Flag not found');
    await recordAudit({ actorId: req.user!.id, action: 'trust_safety.review_flag', resourceType: 'trust_safety_flag', resourceId: req.params.id, metadata: { status } });
    return ok(res, { flag: result.rows[0] });
  })
);

const suspendSchema = z.object({ donorId: z.string().uuid(), reason: z.string().min(1).max(1000) });

// TS-1: suspend a profile pending investigation (e.g. suspected coercion/catfishing).
router.post(
  '/suspend-profile',
  requireAuth,
  requireRole('admin'),
  asyncHandler(async (req: Request, res: Response) => {
    const { donorId, reason } = suspendSchema.parse(req.body);
    await query(`UPDATE donor_profiles SET profile_status = 'suspended' WHERE id = $1`, [donorId]);
    const result = await query(
      `INSERT INTO profile_suspensions (donor_id, suspended_by, reason) VALUES ($1, $2, $3) RETURNING *`,
      [donorId, req.user!.id, reason]
    );
    await recordAudit({ actorId: req.user!.id, action: 'trust_safety.suspend_profile', resourceType: 'donor_profile', resourceId: donorId, metadata: { reason } });
    return created(res, { suspension: result.rows[0] });
  })
);

router.post(
  '/reinstate-profile/:donorId',
  requireAuth,
  requireRole('admin'),
  asyncHandler(async (req: Request, res: Response) => {
    await query(`UPDATE donor_profiles SET profile_status = 'ready' WHERE id = $1`, [req.params.donorId]);
    await query(
      `UPDATE profile_suspensions SET reinstated_at = now() WHERE donor_id = $1 AND reinstated_at IS NULL`,
      [req.params.donorId]
    );
    return ok(res, { message: 'Profile reinstated (set to ready; requires re-publish).' });
  })
);

export default router;
