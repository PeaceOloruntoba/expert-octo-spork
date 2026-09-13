import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/asyncHandler';
import { requireAuth } from '../../middleware/auth';
import { requireRole } from '../../middleware/role';
import { ok } from '../../utils/apiResponse';
import { ApiError } from '../../types';
import * as donorsService from './donors.service';

const router = Router();

router.get(
  '/me',
  requireAuth,
  requireRole('donor'),
  asyncHandler(async (req: Request, res: Response) => {
    const profile = await donorsService.getOwnDonorProfile(req.user!.id);
    return ok(res, { profile });
  })
);

const updateSchema = z.object({
  headline: z.string().max(120).optional(),
  bio: z.string().max(2000).optional(),
  attributes: z.record(z.unknown()).optional(),
  visibility: z.record(z.boolean()).optional(),
  photoUrls: z.array(z.string().url()).optional(),
});

router.patch(
  '/me',
  requireAuth,
  requireRole('donor'),
  asyncHandler(async (req: Request, res: Response) => {
    const input = updateSchema.parse(req.body);
    const profile = await donorsService.updateDonorProfile(req.user!.id, input);
    return ok(res, { profile });
  })
);

router.post(
  '/me/publish',
  requireAuth,
  requireRole('donor'),
  asyncHandler(async (req: Request, res: Response) => {
    const profile = await donorsService.publishDonorProfile(req.user!.id);
    return ok(res, { profile });
  })
);

const anonymitySchema = z.object({
  preference: z.enum(['anonymous', 'known', 'open_to_future_contact']),
});

router.post(
  '/me/anonymity-preference',
  requireAuth,
  requireRole('donor'),
  asyncHandler(async (req: Request, res: Response) => {
    const { preference } = anonymitySchema.parse(req.body);
    const record = await donorsService.setAnonymityPreference(req.user!.id, preference);
    return ok(res, { preference: record });
  })
);

router.get(
  '/me/anonymity-preference/history',
  requireAuth,
  requireRole('donor'),
  asyncHandler(async (req: Request, res: Response) => {
    const history = await donorsService.getAnonymityHistory(req.user!.id);
    return ok(res, { history });
  })
);

// Public (recipient-facing) donor profile view — visibility-filtered (DM-1, MG-3).
router.get(
  '/:donorProfileId',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new ApiError(401, 'Authentication required');
    const profile = await donorsService.getDonorPublicProfile(req.params.donorProfileId, req.user.id);
    return ok(res, { profile });
  })
);

export default router;
