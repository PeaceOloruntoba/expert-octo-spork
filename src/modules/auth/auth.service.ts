import { query } from '../../db/pool';
import { comparePassword, generateOpaqueToken, hashPassword, hashToken } from '../../utils/password';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../../utils/jwt';
import { sendEmail, verificationEmailTemplate, passwordResetEmailTemplate } from '../../utils/mailer';
import { recordAudit } from '../../utils/audit';
import { env } from '../../config/env';
import { ApiError, UserRole } from '../../types';
import { v4 as uuidv4 } from 'uuid';

export interface RegisterInput {
  email: string;
  password: string;
  role: UserRole;
  jurisdictionCode: string;
  phone?: string;
}

interface DbUser {
  id: string;
  email: string;
  phone: string | null;
  password_hash: string;
  role: UserRole;
  jurisdiction_code: string;
  email_verified_at: Date | null;
  is_active: boolean;
}

function toPublicUser(u: DbUser) {
  return {
    id: u.id,
    email: u.email,
    phone: u.phone,
    role: u.role,
    jurisdictionCode: u.jurisdiction_code,
    emailVerified: Boolean(u.email_verified_at),
  };
}

export async function registerUser(input: RegisterInput) {
  const existing = await query<DbUser>('SELECT id FROM users WHERE email = $1', [input.email.toLowerCase()]);
  if (existing.rowCount) {
    throw new ApiError(409, 'An account with this email already exists');
  }

  const passwordHash = await hashPassword(input.password);
  const result = await query<DbUser>(
    `INSERT INTO users (email, phone, password_hash, role, jurisdiction_code)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [input.email.toLowerCase(), input.phone ?? null, passwordHash, input.role, input.jurisdictionCode]
  );
  const user = result.rows[0];

  // Donors get a donor_profiles row created up-front so the dashboard has something to track.
  if (input.role === 'donor') {
    await query('INSERT INTO donor_profiles (user_id) VALUES ($1)', [user.id]);
  }

  await issueEmailVerification(user.id, user.email);
  await recordAudit({ actorId: user.id, action: 'user.register', resourceType: 'user', resourceId: user.id });

  return toPublicUser(user);
}

async function issueTokenPair(user: DbUser) {
  const accessToken = signAccessToken({ sub: user.id, role: user.role, jurisdiction: user.jurisdiction_code });

  const jti = uuidv4();
  const { raw, hash } = generateOpaqueToken();
  const refreshToken = signRefreshToken({ sub: user.id, jti });
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  await query(
    `INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, $4)`,
    [jti, user.id, hash, expiresAt]
  );

  // We embed the jti in the JWT itself; `raw`/`hash` above double as a revocation guard
  // in case you want to look tokens up by hash instead of jti. Kept simple here.
  void raw;

  return { accessToken, refreshToken };
}

export async function loginUser(email: string, password: string) {
  const result = await query<DbUser>('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
  const user = result.rows[0];
  if (!user || !user.is_active) {
    throw new ApiError(401, 'Invalid email or password');
  }

  const valid = await comparePassword(password, user.password_hash);
  if (!valid) {
    await recordAudit({ actorId: user.id, action: 'user.login_failed', resourceType: 'user', resourceId: user.id });
    throw new ApiError(401, 'Invalid email or password');
  }

  const tokens = await issueTokenPair(user);
  await recordAudit({ actorId: user.id, action: 'user.login', resourceType: 'user', resourceId: user.id });

  return { user: toPublicUser(user), ...tokens };
}

export async function refreshTokens(refreshToken: string) {
  let payload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    throw new ApiError(401, 'Invalid or expired refresh token');
  }

  const tokenRow = await query<{ id: string; revoked_at: Date | null; expires_at: Date }>(
    'SELECT id, revoked_at, expires_at FROM refresh_tokens WHERE id = $1 AND user_id = $2',
    [payload.jti, payload.sub]
  );
  const stored = tokenRow.rows[0];
  if (!stored || stored.revoked_at || stored.expires_at < new Date()) {
    throw new ApiError(401, 'Refresh token is no longer valid');
  }

  const userResult = await query<DbUser>('SELECT * FROM users WHERE id = $1', [payload.sub]);
  const user = userResult.rows[0];
  if (!user || !user.is_active) {
    throw new ApiError(401, 'Account no longer active');
  }

  // Rotate: revoke the old refresh token, issue a new pair.
  await query('UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1', [payload.jti]);
  const tokens = await issueTokenPair(user);

  return { user: toPublicUser(user), ...tokens };
}

export async function logoutUser(refreshToken: string) {
  try {
    const payload = verifyRefreshToken(refreshToken);
    await query('UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1 AND user_id = $2', [
      payload.jti,
      payload.sub,
    ]);
  } catch {
    // A malformed/expired token has nothing to revoke — logout is idempotent either way.
  }
}

async function issueEmailVerification(userId: string, email: string) {
  const { raw, hash } = generateOpaqueToken();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await query(
    `INSERT INTO email_verification_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
    [userId, hash, expiresAt]
  );
  const link = `${env.appUrl}/verify-email?token=${raw}`;
  await sendEmail({ to: email, subject: 'Confirm your email', html: verificationEmailTemplate(link) });
}

export async function resendVerificationEmail(userId: string) {
  const result = await query<DbUser>('SELECT * FROM users WHERE id = $1', [userId]);
  const user = result.rows[0];
  if (!user) throw new ApiError(404, 'User not found');
  if (user.email_verified_at) throw new ApiError(400, 'Email already verified');
  await issueEmailVerification(user.id, user.email);
}

export async function verifyEmail(rawToken: string) {
  const hash = hashToken(rawToken);
  const result = await query<{ id: string; user_id: string; expires_at: Date; used_at: Date | null }>(
    'SELECT * FROM email_verification_tokens WHERE token_hash = $1',
    [hash]
  );
  const record = result.rows[0];
  if (!record || record.used_at || record.expires_at < new Date()) {
    throw new ApiError(400, 'Verification link is invalid or has expired');
  }

  await query('UPDATE users SET email_verified_at = now() WHERE id = $1', [record.user_id]);
  await query('UPDATE email_verification_tokens SET used_at = now() WHERE id = $1', [record.id]);
  await recordAudit({ actorId: record.user_id, action: 'user.verify_email', resourceType: 'user', resourceId: record.user_id });
}

export async function requestPasswordReset(email: string) {
  const result = await query<DbUser>('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
  const user = result.rows[0];
  // Always respond as if successful to avoid leaking which emails are registered.
  if (!user) return;

  const { raw, hash } = generateOpaqueToken();
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
  await query(
    `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
    [user.id, hash, expiresAt]
  );
  const link = `${env.appUrl}/reset-password?token=${raw}`;
  await sendEmail({ to: user.email, subject: 'Reset your password', html: passwordResetEmailTemplate(link) });
}

export async function resetPassword(rawToken: string, newPassword: string) {
  const hash = hashToken(rawToken);
  const result = await query<{ id: string; user_id: string; expires_at: Date; used_at: Date | null }>(
    'SELECT * FROM password_reset_tokens WHERE token_hash = $1',
    [hash]
  );
  const record = result.rows[0];
  if (!record || record.used_at || record.expires_at < new Date()) {
    throw new ApiError(400, 'Reset link is invalid or has expired');
  }

  const passwordHash = await hashPassword(newPassword);
  await query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, record.user_id]);
  await query('UPDATE password_reset_tokens SET used_at = now() WHERE id = $1', [record.id]);
  // Revoke all existing refresh tokens on password change.
  await query('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [record.user_id]);
  await recordAudit({ actorId: record.user_id, action: 'user.reset_password', resourceType: 'user', resourceId: record.user_id });
}

export async function getUserById(userId: string) {
  const result = await query<DbUser>('SELECT * FROM users WHERE id = $1', [userId]);
  const user = result.rows[0];
  if (!user) throw new ApiError(404, 'User not found');
  return toPublicUser(user);
}
