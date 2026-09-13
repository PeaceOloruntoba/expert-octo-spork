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

const intakeSchema = z.object({
  intake: z.record(z.unknown()), // guided multi-step form payload (MG-1)
});

// MG-1: donor submits screening intake. Routes into the assigned clinic's queue.
router.post(
  '/submit',
  requireAuth,
  requireRole('donor'),
  asyncHandler(async (req: Request, res: Response) => {
    const { intake } = intakeSchema.parse(req.body);

    const donor = await query<{ id: string }>('SELECT id FROM donor_profiles WHERE user_id = $1', [req.user!.id]);
    if (!donor.rowCount) throw new ApiError(404, 'Donor profile not found');

    const assignment = await query<{ clinic_id: string }>(
      'SELECT clinic_id FROM clinic_assignments WHERE donor_id = $1 LIMIT 1',
      [donor.rows[0].id]
    );

    // Mock genetic-lab pass-through: in production this calls out to a contracted
    // lab's API and lab_results is populated asynchronously via webhook.
    const mockLabResults = env.geneticLabMockMode
      ? { provider: 'mock-genetic-lab', summary: 'No reportable findings (mock result)', receivedAt: new Date().toISOString() }
      : {};

    const result = await query(
      `INSERT INTO screening_submissions (donor_id, clinic_id, intake, lab_results)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [donor.rows[0].id, assignment.rows[0]?.clinic_id ?? null, JSON.stringify(intake), JSON.stringify(mockLabResults)]
    );

    await query(`UPDATE donor_profiles SET screening_status = 'in_review' WHERE id = $1`, [donor.rows[0].id]);
    await recordAudit({ actorId: req.user!.id, action: 'screening.submit', resourceType: 'screening_submission', resourceId: result.rows[0].id });

    return created(res, { submission: result.rows[0] });
  })
);

router.get(
  '/me',
  requireAuth,
  requireRole('donor'),
  asyncHandler(async (req: Request, res: Response) => {
    const donor = await query<{ id: string }>('SELECT id FROM donor_profiles WHERE user_id = $1', [req.user!.id]);
    if (!donor.rowCount) throw new ApiError(404, 'Donor profile not found');
    const result = await query(
      'SELECT id, determination, determination_notes, submitted_at, determined_at FROM screening_submissions WHERE donor_id = $1 ORDER BY submitted_at DESC',
      [donor.rows[0].id]
    );
    return ok(res, { submissions: result.rows });
  })
);

// MG-2: clinic staff record a determination. MG-3/MG-4 (raw data access control,
// break-glass logging) are enforced in the clinic module which owns this read path.
const determinationSchema = z.object({
  determination: z.enum(['eligible', 'not_eligible', 'needs_more_info']),
  notes: z.string().max(2000).optional(),
});

router.post(
  '/:submissionId/determination',
  requireAuth,
  requireRole('clinic_staff'),
  asyncHandler(async (req: Request, res: Response) => {
    const { determination, notes } = determinationSchema.parse(req.body);

    const result = await query(
      `UPDATE screening_submissions
       SET determination = $2, determination_notes = $3, determined_by = $4, determined_at = now()
       WHERE id = $1 RETURNING donor_id`,
      [req.params.submissionId, determination, notes ?? null, req.user!.id]
    );
    if (!result.rowCount) throw new ApiError(404, 'Screening submission not found');

    const screeningStatus = determination === 'eligible' ? 'eligible' : determination === 'not_eligible' ? 'not_eligible' : 'needs_more_info';
    await query('UPDATE donor_profiles SET screening_status = $2 WHERE id = $1', [result.rows[0].donor_id, screeningStatus]);

    await recordAudit({
      actorId: req.user!.id,
      action: 'screening.determination',
      resourceType: 'screening_submission',
      resourceId: req.params.submissionId,
      metadata: { determination },
    });

    return ok(res, { message: 'Determination recorded' });
  })
);

export default router;
