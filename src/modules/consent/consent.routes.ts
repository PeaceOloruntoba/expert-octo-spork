import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/asyncHandler';
import { requireAuth } from '../../middleware/auth';
import { ok } from '../../utils/apiResponse';
import { query } from '../../db/pool';
import { recordAudit } from '../../utils/audit';
import { ApiError } from '../../types';

const router = Router();

// CL-3: jurisdiction-specific agreement text, served per confirmed jurisdiction.
router.get(
  '/agreements/:type',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const result = await query(
      `SELECT * FROM legal_agreements WHERE jurisdiction_code = $1 AND agreement_type = $2
       ORDER BY version DESC LIMIT 1`,
      [req.user!.jurisdiction, req.params.type]
    );
    if (!result.rowCount) throw new ApiError(404, 'No agreement found for this jurisdiction/type');
    return ok(res, { agreement: result.rows[0] });
  })
);

const signSchema = z.object({
  agreementId: z.string().uuid(),
  conversationId: z.string().uuid().optional(),
});

// CL-1: e-signature, required before clinic handoff can proceed.
router.post(
  '/agreements/sign',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const { agreementId, conversationId } = signSchema.parse(req.body);
    const result = await query(
      `INSERT INTO agreement_signatures (agreement_id, conversation_id, user_id)
       VALUES ($1, $2, $3) RETURNING *`,
      [agreementId, conversationId ?? null, req.user!.id]
    );
    await recordAudit({ actorId: req.user!.id, action: 'consent.sign_agreement', resourceType: 'legal_agreement', resourceId: agreementId });
    return ok(res, { signature: result.rows[0] });
  })
);

// CL-3: full version history + signer identity, retrievable.
router.get(
  '/agreements/:type/history',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const result = await query(
      `SELECT la.version, s.user_id, s.signed_at
       FROM agreement_signatures s
       JOIN legal_agreements la ON la.id = s.agreement_id
       WHERE la.agreement_type = $1 AND s.user_id = $2
       ORDER BY s.signed_at DESC`,
      [req.params.type, req.user!.id]
    );
    return ok(res, { history: result.rows });
  })
);

export default router;
