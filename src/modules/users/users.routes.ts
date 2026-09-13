import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/asyncHandler';
import { requireAuth } from '../../middleware/auth';
import { ok } from '../../utils/apiResponse';
import * as usersService from './users.service';
import { ApiError } from '../../types';

const router = Router();

router.get(
  '/me/account',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new ApiError(401, 'Authentication required');
    const account = await usersService.getUserAccount(req.user.id);
    return ok(res, { account });
  })
);

const updateSchema = z.object({ phone: z.string().optional() });

router.patch(
  '/me/account',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new ApiError(401, 'Authentication required');
    const input = updateSchema.parse(req.body);
    const account = await usersService.updateUserAccount(req.user.id, input);
    return ok(res, { account });
  })
);

export default router;
