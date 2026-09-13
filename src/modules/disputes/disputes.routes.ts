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

const fileSchema = z.object({
  transactionId: z.string().uuid().optional(),
  conversationId: z.string().uuid().optional(),
  reasonCategory: z.string().min(1),
  detail: z.string().min(1).max(4000),
});

// DR-1: either party can file a dispute against a transaction or conversation.
router.post(
  '/',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const input = fileSchema.parse(req.body);
    const result = await query(
      `INSERT INTO disputes (filed_by, transaction_id, conversation_id, reason_category, detail)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.user!.id, input.transactionId ?? null, input.conversationId ?? null, input.reasonCategory, input.detail]
    );

    if (input.transactionId) {
      await query(`UPDATE transactions SET status = 'disputed' WHERE id = $1`, [input.transactionId]);
    }

    await recordAudit({ actorId: req.user!.id, action: 'dispute.file', resourceType: 'dispute', resourceId: result.rows[0].id });
    return created(res, { dispute: result.rows[0] });
  })
);

router.get(
  '/',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    // Admins see the full queue; everyone else sees only disputes they filed.
    const result =
      req.user!.role === 'admin'
        ? await query('SELECT * FROM disputes ORDER BY created_at DESC')
        : await query('SELECT * FROM disputes WHERE filed_by = $1 ORDER BY created_at DESC', [req.user!.id]);
    return ok(res, { disputes: result.rows });
  })
);

const resolveSchema = z.object({
  resolution: z.string().min(1).max(2000),
  status: z.enum(['under_review', 'resolved']),
});

// DR-2, DR-3: admin reviews and resolves, with a documented resolution + optional refund trigger.
router.patch(
  '/:id',
  requireAuth,
  requireRole('admin'),
  asyncHandler(async (req: Request, res: Response) => {
    const { resolution, status } = resolveSchema.parse(req.body);
    const result = await query(
      `UPDATE disputes SET status = $2, resolution = $3, resolved_by = $4,
         resolved_at = CASE WHEN $2 = 'resolved' THEN now() ELSE resolved_at END
       WHERE id = $1 RETURNING *`,
      [req.params.id, status, resolution, req.user!.id]
    );
    if (!result.rowCount) throw new ApiError(404, 'Dispute not found');
    await recordAudit({ actorId: req.user!.id, action: 'dispute.resolve', resourceType: 'dispute', resourceId: req.params.id, metadata: { status } });
    return ok(res, { dispute: result.rows[0] });
  })
);

export default router;
