import { query } from '../../db/pool';
import { ApiError } from '../../types';

export async function getUserAccount(userId: string) {
  const result = await query(
    `SELECT id, email, phone, role, jurisdiction_code, email_verified_at, mfa_enabled, created_at
     FROM users WHERE id = $1`,
    [userId]
  );
  if (!result.rowCount) throw new ApiError(404, 'User not found');
  return result.rows[0];
}

export async function updateUserAccount(userId: string, updates: { phone?: string }) {
  const result = await query(
    `UPDATE users SET phone = COALESCE($2, phone) WHERE id = $1
     RETURNING id, email, phone, role, jurisdiction_code, email_verified_at`,
    [userId, updates.phone ?? null]
  );
  return result.rows[0];
}
