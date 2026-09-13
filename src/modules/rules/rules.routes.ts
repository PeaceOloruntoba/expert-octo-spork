import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/asyncHandler';
import { requireAuth } from '../../middleware/auth';
import { requireRole } from '../../middleware/role';
import { ok, created } from '../../utils/apiResponse';
import { query } from '../../db/pool';
import { ApiError } from '../../types';

const router = Router();

// JE-1: publicly readable so both frontend and other services can validate against
// current rules without duplicating them.
router.get(
  '/',
  requireAuth,
  asyncHandler(async (_req: Request, res: Response) => {
    const result = await query('SELECT * FROM jurisdictions WHERE is_active = true ORDER BY name');
    return ok(res, { jurisdictions: result.rows });
  })
);

router.get(
  '/:code',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const result = await query('SELECT * FROM jurisdictions WHERE code = $1', [req.params.code]);
    if (!result.rowCount) throw new ApiError(404, 'Jurisdiction not found');
    return ok(res, { jurisdiction: result.rows[0] });
  })
);

const upsertSchema = z.object({
  code: z.string().min(2),
  name: z.string().min(1),
  minAge: z.number().int().min(0).default(18),
  compensationCapMinorUnits: z.number().int().min(0),
  currency: z.string().length(3).default('USD'),
  anonymityLaw: z.record(z.unknown()).default({}),
});

// JE-2/JE-3: rules engine is data-driven — admins update rows here rather than
// requiring a deploy, and every publish/transaction check reads live from this table.
router.put(
  '/:code',
  requireAuth,
  requireRole('admin'),
  asyncHandler(async (req: Request, res: Response) => {
    const input = upsertSchema.parse({ ...req.body, code: req.params.code });
    const result = await query(
      `INSERT INTO jurisdictions (code, name, min_age, compensation_cap_minor_units, currency, anonymity_law)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (code) DO UPDATE SET
         name = EXCLUDED.name, min_age = EXCLUDED.min_age,
         compensation_cap_minor_units = EXCLUDED.compensation_cap_minor_units,
         currency = EXCLUDED.currency, anonymity_law = EXCLUDED.anonymity_law
       RETURNING *`,
      [input.code, input.name, input.minAge, input.compensationCapMinorUnits, input.currency, JSON.stringify(input.anonymityLaw)]
    );
    return created(res, { jurisdiction: result.rows[0] });
  })
);

// JE-2: cross-jurisdiction match escalates to ethics review rather than being silently blocked.
const escalateSchema = z.object({
  subjectType: z.enum(['profile', 'match', 'transaction']),
  subjectId: z.string().uuid(),
  triggeringRule: z.string().min(1),
  jurisdictionCode: z.string().min(2),
});

router.post(
  '/ethics-review',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const input = escalateSchema.parse(req.body);
    const result = await query(
      `INSERT INTO ethics_review_cases (subject_type, subject_id, triggering_rule, jurisdiction_code)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [input.subjectType, input.subjectId, input.triggeringRule, input.jurisdictionCode]
    );
    return created(res, { case: result.rows[0] });
  })
);

router.get(
  '/ethics-review/queue',
  requireAuth,
  requireRole('ethics_reviewer', 'admin'),
  asyncHandler(async (_req: Request, res: Response) => {
    const result = await query(`SELECT * FROM ethics_review_cases WHERE status = 'pending' ORDER BY created_at`);
    return ok(res, { queue: result.rows });
  })
);

const decideSchema = z.object({ status: z.enum(['approved', 'rejected']), notes: z.string().max(2000).optional() });

router.patch(
  '/ethics-review/:id',
  requireAuth,
  requireRole('ethics_reviewer', 'admin'),
  asyncHandler(async (req: Request, res: Response) => {
    const { status, notes } = decideSchema.parse(req.body);
    const result = await query(
      `UPDATE ethics_review_cases SET status = $2, decided_by = $3, decision_notes = $4, decided_at = now()
       WHERE id = $1 RETURNING *`,
      [req.params.id, status, req.user!.id, notes ?? null]
    );
    if (!result.rowCount) throw new ApiError(404, 'Case not found');
    return ok(res, { case: result.rows[0] });
  })
);

export default router;
