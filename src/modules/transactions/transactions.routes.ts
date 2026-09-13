import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/asyncHandler';
import { requireAuth } from '../../middleware/auth';
import { requireRole } from '../../middleware/role';
import { ok, created } from '../../utils/apiResponse';
import { query } from '../../db/pool';
import { env } from '../../config/env';
import { recordAudit } from '../../utils/audit';
import { ApiError } from '../../types';

const router = Router();

const createSchema = z.object({
  donorId: z.string().uuid(),
  amountMinorUnits: z.number().int().positive(),
  currency: z.string().length(3).default('USD'),
  conversationId: z.string().uuid().optional(),
  milestones: z.array(z.object({ name: z.string(), amountMinorUnits: z.number().int().positive() })).min(1),
  // Tokenized reference from the (mock) payment/escrow provider — never a raw card number (TX-4).
  paymentProviderToken: z.string().min(1),
});

// TX-1: compensation is capped per jurisdiction before a transaction can be created.
router.post(
  '/',
  requireAuth,
  requireRole('recipient'),
  asyncHandler(async (req: Request, res: Response) => {
    const input = createSchema.parse(req.body);

    const jurisdiction = await query<{ compensation_cap_minor_units: number }>(
      'SELECT compensation_cap_minor_units FROM jurisdictions WHERE code = $1',
      [req.user!.jurisdiction]
    );
    const cap = jurisdiction.rows[0]?.compensation_cap_minor_units;
    if (cap !== undefined && input.amountMinorUnits > cap) {
      throw new ApiError(400, `Amount exceeds the compensation cap (${cap}) for your jurisdiction.`);
    }

    const milestonesTotal = input.milestones.reduce((sum, m) => sum + m.amountMinorUnits, 0);
    if (milestonesTotal !== input.amountMinorUnits) {
      throw new ApiError(400, 'Milestone amounts must sum to the total transaction amount.');
    }

    const txResult = await query(
      `INSERT INTO transactions (recipient_id, donor_id, conversation_id, amount_minor_units, currency, jurisdiction_cap_minor_units, status, payment_provider_token, provider)
       VALUES ($1, $2, $3, $4, $5, $6, 'funded', $7, $8) RETURNING *`,
      [
        req.user!.id,
        input.donorId,
        input.conversationId ?? null,
        input.amountMinorUnits,
        input.currency,
        cap ?? 0,
        input.paymentProviderToken,
        env.escrowMockMode ? 'mock-escrow' : 'escrow-provider',
      ]
    );
    const transaction = txResult.rows[0];

    for (const m of input.milestones) {
      await query(
        `INSERT INTO escrow_milestones (transaction_id, name, amount_minor_units) VALUES ($1, $2, $3)`,
        [transaction.id, m.name, m.amountMinorUnits]
      );
    }

    await recordAudit({ actorId: req.user!.id, action: 'transaction.create', resourceType: 'transaction', resourceId: transaction.id });
    return created(res, { transaction });
  })
);

// TX-3: real-time status for both parties.
router.get(
  '/:id',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const tx = await query('SELECT * FROM transactions WHERE id = $1', [req.params.id]);
    if (!tx.rowCount) throw new ApiError(404, 'Transaction not found');
    const milestones = await query('SELECT * FROM escrow_milestones WHERE transaction_id = $1 ORDER BY created_at', [req.params.id]);
    return ok(res, { transaction: tx.rows[0], milestones: milestones.rows });
  })
);

router.get(
  '/',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const result = await query(
      'SELECT * FROM transactions WHERE recipient_id = $1 OR donor_id = $1 ORDER BY created_at DESC',
      [req.user!.id]
    );
    return ok(res, { transactions: result.rows });
  })
);

// TX-2: payout requires milestone-completion confirmation from an authorized role.
router.post(
  '/milestones/:milestoneId/confirm',
  requireAuth,
  requireRole('recipient', 'admin', 'clinic_staff'),
  asyncHandler(async (req: Request, res: Response) => {
    const result = await query(
      `UPDATE escrow_milestones SET status = 'confirmed', confirmed_by = $2 WHERE id = $1 RETURNING *`,
      [req.params.milestoneId, req.user!.id]
    );
    if (!result.rowCount) throw new ApiError(404, 'Milestone not found');
    await recordAudit({ actorId: req.user!.id, action: 'transaction.milestone_confirm', resourceType: 'escrow_milestone', resourceId: req.params.milestoneId });
    return ok(res, { milestone: result.rows[0] });
  })
);

router.post(
  '/milestones/:milestoneId/release',
  requireAuth,
  requireRole('admin'),
  asyncHandler(async (req: Request, res: Response) => {
    // Mock escrow payout release — swap for a real provider call (e.g. Stripe Connect,
    // Modern Treasury) while keeping this same confirm → release audit trail.
    const result = await query(
      `UPDATE escrow_milestones SET status = 'released', released_at = now() WHERE id = $1 AND status = 'confirmed' RETURNING *`,
      [req.params.milestoneId]
    );
    if (!result.rowCount) throw new ApiError(400, 'Milestone must be confirmed before it can be released');
    await recordAudit({ actorId: req.user!.id, action: 'transaction.milestone_release', resourceType: 'escrow_milestone', resourceId: req.params.milestoneId });
    return ok(res, { milestone: result.rows[0] });
  })
);

export default router;
