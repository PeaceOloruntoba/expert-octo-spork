import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/asyncHandler';
import { requireAuth } from '../../middleware/auth';
import { ok } from '../../utils/apiResponse';
import { query } from '../../db/pool';
import { env } from '../../config/env';
import { recordAudit } from '../../utils/audit';
import { ApiError } from '../../types';

const router = Router();

router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const result = await query(
      'SELECT * FROM identity_verifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
      [req.user!.id]
    );
    return ok(res, { verification: result.rows[0] ?? { status: 'not_started' } });
  })
);

const submitSchema = z.object({
  // In production these would be secure file upload references (S3/GCS keys), not raw data.
  idFrontRef: z.string().min(1),
  idBackRef: z.string().min(1),
  livenessRef: z.string().min(1),
  dateOfBirth: z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'Invalid date'),
});

router.post(
  '/me/submit',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const input = submitSchema.parse(req.body);

    // IV-2: age / jurisdiction minimum-age check runs before anything else.
    const jurisdiction = await query<{ min_age: number }>(
      'SELECT min_age FROM jurisdictions WHERE code = $1',
      [req.user!.jurisdiction]
    );
    const minAge = jurisdiction.rows[0]?.min_age ?? 18;
    const age = Math.floor((Date.now() - Date.parse(input.dateOfBirth)) / (365.25 * 24 * 60 * 60 * 1000));
    if (age < minAge) {
      throw new ApiError(400, `Must be at least ${minAge} years old in your jurisdiction to proceed.`);
    }

    const existing = await query<{ id: string; status: string; resubmission_count: number }>(
      'SELECT id, status, resubmission_count FROM identity_verifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
      [req.user!.id]
    );

    // Mock KYC provider: deterministic-but-fake pass/fail (IV-1). Wire up a real
    // provider (e.g. Persona, Onfido, Stripe Identity) by replacing this block —
    // the rest of the flow (status tracking, resubmission, audit log) stays the same.
    const mockDecision = env.kycMockMode ? 'verified' : 'pending';

    let verificationId: string;
    if (existing.rowCount && existing.rows[0].status === 'rejected') {
      // IV-4: one resubmission is allowed before requiring manual/admin review.
      const resubCount = existing.rows[0].resubmission_count + 1;
      const nextStatus = resubCount > 1 ? 'pending' : mockDecision; // second failure would route to admin queue
      const updated = await query(
        `UPDATE identity_verifications
         SET status = $2, resubmission_count = $3, submitted_at = now(), decided_at = now(), provider_reference = $4
         WHERE id = $1 RETURNING id`,
        [existing.rows[0].id, nextStatus, resubCount, `mock-ref-${Date.now()}`]
      );
      verificationId = updated.rows[0].id;
    } else {
      const inserted = await query(
        `INSERT INTO identity_verifications (user_id, status, provider, provider_reference, submitted_at, decided_at)
         VALUES ($1, $2, 'mock-kyc', $3, now(), now()) RETURNING id`,
        [req.user!.id, mockDecision, `mock-ref-${Date.now()}`]
      );
      verificationId = inserted.rows[0].id;
    }

    await recordAudit({
      actorId: req.user!.id,
      action: 'verification.submit',
      resourceType: 'identity_verification',
      resourceId: verificationId,
      metadata: { mockDecision },
    });

    const result = await query('SELECT * FROM identity_verifications WHERE id = $1', [verificationId]);
    return ok(res, { verification: result.rows[0] });
  })
);

export default router;
