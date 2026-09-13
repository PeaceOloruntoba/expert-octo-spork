import { Router, Request, Response } from 'express';
import { asyncHandler } from '../../middleware/asyncHandler';
import { requireAuth } from '../../middleware/auth';
import { requireRole } from '../../middleware/role';
import { ok } from '../../utils/apiResponse';
import { query } from '../../db/pool';
import { recordAudit } from '../../utils/audit';
import { ApiError } from '../../types';

const router = Router();

async function getStaffClinicId(userId: string): Promise<string> {
  const result = await query<{ clinic_id: string }>('SELECT clinic_id FROM clinic_staff WHERE user_id = $1', [userId]);
  if (!result.rowCount) throw new ApiError(403, 'Not associated with a clinic');
  return result.rows[0].clinic_id;
}

// CP-1: scoped queue — only submissions assigned to this clinic, never the full platform.
router.get(
  '/queue',
  requireAuth,
  requireRole('clinic_staff'),
  asyncHandler(async (req: Request, res: Response) => {
    const clinicId = await getStaffClinicId(req.user!.id);
    const result = await query(
      `SELECT s.id, s.donor_id, s.determination, s.submitted_at, dp.headline
       FROM screening_submissions s
       JOIN donor_profiles dp ON dp.id = s.donor_id
       WHERE s.clinic_id = $1
       ORDER BY s.submitted_at ASC`,
      [clinicId]
    );
    return ok(res, { queue: result.rows });
  })
);

// CP-2/CP-3: clinic staff can view intake + lab_results, but this is a break-glass-
// logged read since it's screening/medical data (mirrors Architecture v2 Boundary C).
router.get(
  '/submissions/:id',
  requireAuth,
  requireRole('clinic_staff'),
  asyncHandler(async (req: Request, res: Response) => {
    const clinicId = await getStaffClinicId(req.user!.id);
    const result = await query('SELECT * FROM screening_submissions WHERE id = $1 AND clinic_id = $2', [req.params.id, clinicId]);
    if (!result.rowCount) throw new ApiError(404, 'Submission not found');

    await query(
      `INSERT INTO break_glass_access_log (requester_id, screening_submission_id, reason_code)
       VALUES ($1, $2, 'clinic_review')`,
      [req.user!.id, req.params.id]
    );
    await recordAudit({ actorId: req.user!.id, action: 'clinic.view_submission', resourceType: 'screening_submission', resourceId: req.params.id });

    return ok(res, { submission: result.rows[0] });
  })
);

// CP-3: generate a handoff packet once a determination + signed agreements are in place.
router.get(
  '/handoff/:donorId',
  requireAuth,
  requireRole('clinic_staff'),
  asyncHandler(async (req: Request, res: Response) => {
    const clinicId = await getStaffClinicId(req.user!.id);
    const assignment = await query('SELECT 1 FROM clinic_assignments WHERE clinic_id = $1 AND donor_id = $2', [
      clinicId,
      req.params.donorId,
    ]);
    if (!assignment.rowCount) throw new ApiError(403, 'Donor is not assigned to your clinic');

    const donor = await query('SELECT headline, screening_status FROM donor_profiles WHERE id = $1', [req.params.donorId]);
    const screening = await query(
      'SELECT determination, determination_notes, determined_at FROM screening_submissions WHERE donor_id = $1 ORDER BY submitted_at DESC LIMIT 1',
      [req.params.donorId]
    );
    const signatures = await query(
      `SELECT la.agreement_type, la.version, s.signed_at
       FROM agreement_signatures s JOIN legal_agreements la ON la.id = s.agreement_id
       WHERE s.user_id IN (SELECT user_id FROM donor_profiles WHERE id = $1)`,
      [req.params.donorId]
    );

    return ok(res, {
      handoffPacket: {
        donor: donor.rows[0],
        screening: screening.rows[0] ?? null,
        signedAgreements: signatures.rows,
        generatedAt: new Date().toISOString(),
      },
    });
  })
);

export default router;
