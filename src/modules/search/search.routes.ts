import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/asyncHandler';
import { requireAuth } from '../../middleware/auth';
import { requireRole } from '../../middleware/role';
import { ok } from '../../utils/apiResponse';
import { query } from '../../db/pool';
import * as searchService from './search.service';

const router = Router();

const searchSchema = z.object({
  q: z.string().optional(),
  attributes: z.record(z.string()).optional(),
  limit: z.coerce.number().int().positive().optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

router.get(
  '/donors',
  requireAuth,
  requireRole('recipient'),
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = searchSchema.parse({
      q: req.query.q,
      attributes: req.query.attributes ? JSON.parse(req.query.attributes as string) : undefined,
      limit: req.query.limit,
      offset: req.query.offset,
    });
    const results = await searchService.searchDonors({
      q: parsed.q,
      attributeFilters: parsed.attributes,
      limit: parsed.limit,
      offset: parsed.offset,
    });
    return ok(res, { results, count: results.length });
  })
);

router.post(
  '/shortlist/:donorProfileId',
  requireAuth,
  requireRole('recipient'),
  asyncHandler(async (req: Request, res: Response) => {
    await query(
      `INSERT INTO shortlists (recipient_id, donor_id) VALUES ($1, $2)
       ON CONFLICT (recipient_id, donor_id) DO NOTHING`,
      [req.user!.id, req.params.donorProfileId]
    );
    return ok(res, { message: 'Added to shortlist' });
  })
);

router.delete(
  '/shortlist/:donorProfileId',
  requireAuth,
  requireRole('recipient'),
  asyncHandler(async (req: Request, res: Response) => {
    await query('DELETE FROM shortlists WHERE recipient_id = $1 AND donor_id = $2', [
      req.user!.id,
      req.params.donorProfileId,
    ]);
    return ok(res, { message: 'Removed from shortlist' });
  })
);

router.get(
  '/shortlist',
  requireAuth,
  requireRole('recipient'),
  asyncHandler(async (req: Request, res: Response) => {
    const result = await query(
      `SELECT dp.id, dp.headline, dp.photo_urls, dp.profile_status
       FROM shortlists s
       JOIN donor_profiles dp ON dp.id = s.donor_id
       WHERE s.recipient_id = $1
       ORDER BY s.created_at DESC`,
      [req.user!.id]
    );
    return ok(res, { shortlist: result.rows });
  })
);

export default router;
