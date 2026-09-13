import { Router } from 'express';
import { asyncHandler } from '../../middleware/asyncHandler';
import { requireAuth } from '../../middleware/auth';
import * as ctrl from './auth.controller';

const router = Router();

router.post('/register', asyncHandler(ctrl.register));
router.post('/login', asyncHandler(ctrl.login));
router.post('/refresh', asyncHandler(ctrl.refresh));
router.post('/logout', asyncHandler(ctrl.logout));
router.post('/verify-email', asyncHandler(ctrl.verifyEmail));
router.post('/resend-verification', requireAuth, asyncHandler(ctrl.resendVerification));
router.post('/forgot-password', asyncHandler(ctrl.forgotPassword));
router.post('/reset-password', asyncHandler(ctrl.resetPassword));
router.get('/me', requireAuth, asyncHandler(ctrl.me));

export default router;
