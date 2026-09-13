import { Request, Response } from 'express';
import { z } from 'zod';
import * as authService from './auth.service';
import { created, ok } from '../../utils/apiResponse';
import { ApiError } from '../../types';

const roleEnum = z.enum(['donor', 'recipient', 'clinic_staff', 'admin', 'ethics_reviewer']);

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  role: roleEnum,
  jurisdictionCode: z.string().min(2),
  phone: z.string().optional(),
});

export async function register(req: Request, res: Response) {
  const input = registerSchema.parse(req.body);
  const user = await authService.registerUser(input);
  return created(res, { user, message: 'Account created. Check your email to verify your address.' });
}

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function login(req: Request, res: Response) {
  const { email, password } = loginSchema.parse(req.body);
  const result = await authService.loginUser(email, password);
  return ok(res, result);
}

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

export async function refresh(req: Request, res: Response) {
  const { refreshToken } = refreshSchema.parse(req.body);
  const result = await authService.refreshTokens(refreshToken);
  return ok(res, result);
}

export async function logout(req: Request, res: Response) {
  const { refreshToken } = refreshSchema.parse(req.body);
  await authService.logoutUser(refreshToken);
  return ok(res, { message: 'Logged out' });
}

const verifyEmailSchema = z.object({ token: z.string().min(1) });

export async function verifyEmail(req: Request, res: Response) {
  const { token } = verifyEmailSchema.parse(req.body);
  await authService.verifyEmail(token);
  return ok(res, { message: 'Email verified' });
}

export async function resendVerification(req: Request, res: Response) {
  if (!req.user) throw new ApiError(401, 'Authentication required');
  await authService.resendVerificationEmail(req.user.id);
  return ok(res, { message: 'Verification email sent' });
}

const forgotPasswordSchema = z.object({ email: z.string().email() });

export async function forgotPassword(req: Request, res: Response) {
  const { email } = forgotPasswordSchema.parse(req.body);
  await authService.requestPasswordReset(email);
  return ok(res, { message: 'If that email is registered, a reset link has been sent.' });
}

const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

export async function resetPassword(req: Request, res: Response) {
  const { token, password } = resetPasswordSchema.parse(req.body);
  await authService.resetPassword(token, password);
  return ok(res, { message: 'Password updated. Please log in again.' });
}

export async function me(req: Request, res: Response) {
  if (!req.user) throw new ApiError(401, 'Authentication required');
  const user = await authService.getUserById(req.user.id);
  return ok(res, { user });
}
