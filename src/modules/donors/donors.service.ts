import { query } from '../../db/pool';
import { ApiError } from '../../types';

interface DonorProfileRow {
  id: string;
  user_id: string;
  headline: string | null;
  bio: string | null;
  attributes: Record<string, unknown>;
  visibility: Record<string, boolean>;
  photo_urls: string[];
  screening_status: string;
  profile_status: string;
  view_count: number;
}

export async function getOwnDonorProfile(userId: string) {
  const result = await query<DonorProfileRow>('SELECT * FROM donor_profiles WHERE user_id = $1', [userId]);
  if (!result.rowCount) throw new ApiError(404, 'Donor profile not found');
  const profile = result.rows[0];

  const verification = await query<{ status: string }>(
    'SELECT status FROM identity_verifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
    [userId]
  );

  return {
    ...profile,
    verificationStatus: verification.rows[0]?.status ?? 'not_started',
  };
}

interface UpdateProfileInput {
  headline?: string;
  bio?: string;
  attributes?: Record<string, unknown>;
  visibility?: Record<string, boolean>;
  photoUrls?: string[];
}

export async function updateDonorProfile(userId: string, input: UpdateProfileInput) {
  const existing = await query('SELECT id FROM donor_profiles WHERE user_id = $1', [userId]);
  if (!existing.rowCount) throw new ApiError(404, 'Donor profile not found');

  const result = await query(
    `UPDATE donor_profiles SET
       headline = COALESCE($2, headline),
       bio = COALESCE($3, bio),
       attributes = COALESCE($4, attributes),
       visibility = COALESCE($5, visibility),
       photo_urls = COALESCE($6, photo_urls)
     WHERE user_id = $1
     RETURNING *`,
    [
      userId,
      input.headline ?? null,
      input.bio ?? null,
      input.attributes ? JSON.stringify(input.attributes) : null,
      input.visibility ? JSON.stringify(input.visibility) : null,
      input.photoUrls ? JSON.stringify(input.photoUrls) : null,
    ]
  );
  return result.rows[0];
}

export async function publishDonorProfile(userId: string) {
  const profile = await query<DonorProfileRow>('SELECT * FROM donor_profiles WHERE user_id = $1', [userId]);
  if (!profile.rowCount) throw new ApiError(404, 'Donor profile not found');
  const row = profile.rows[0];

  const verification = await query<{ status: string }>(
    'SELECT status FROM identity_verifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
    [userId]
  );
  const verified = verification.rows[0]?.status === 'verified';

  // Mirrors the Donor Dashboard gate in the UX spec: all three trackers must pass.
  if (!verified || row.screening_status !== 'eligible') {
    throw new ApiError(
      400,
      'Profile cannot be published until identity verification and screening are both approved.'
    );
  }

  const result = await query(
    `UPDATE donor_profiles SET profile_status = 'published' WHERE user_id = $1 RETURNING *`,
    [userId]
  );
  return result.rows[0];
}

export async function setAnonymityPreference(userId: string, preference: 'anonymous' | 'known' | 'open_to_future_contact') {
  const donor = await query<{ id: string }>('SELECT id FROM donor_profiles WHERE user_id = $1', [userId]);
  if (!donor.rowCount) throw new ApiError(404, 'Donor profile not found');
  const donorId = donor.rows[0].id;

  const latest = await query<{ version: number }>(
    'SELECT version FROM anonymity_preferences WHERE donor_id = $1 ORDER BY version DESC LIMIT 1',
    [donorId]
  );
  const nextVersion = (latest.rows[0]?.version ?? 0) + 1;

  const result = await query(
    `INSERT INTO anonymity_preferences (donor_id, preference, version) VALUES ($1, $2, $3) RETURNING *`,
    [donorId, preference, nextVersion]
  );
  return result.rows[0];
}

export async function getAnonymityHistory(userId: string) {
  const donor = await query<{ id: string }>('SELECT id FROM donor_profiles WHERE user_id = $1', [userId]);
  if (!donor.rowCount) throw new ApiError(404, 'Donor profile not found');
  const result = await query(
    'SELECT * FROM anonymity_preferences WHERE donor_id = $1 ORDER BY version DESC',
    [donor.rows[0].id]
  );
  return result.rows;
}

export async function getDonorPublicProfile(donorProfileId: string, viewerId?: string) {
  const result = await query<DonorProfileRow>(
    `SELECT * FROM donor_profiles WHERE id = $1 AND profile_status = 'published'`,
    [donorProfileId]
  );
  if (!result.rowCount) throw new ApiError(404, 'Donor profile not found');
  const row = result.rows[0];

  // Only expose attributes the donor has explicitly toggled visible (DM-1).
  const visibleAttributes: Record<string, unknown> = {};
  for (const [key, isVisible] of Object.entries(row.visibility ?? {})) {
    if (isVisible && key in (row.attributes ?? {})) {
      visibleAttributes[key] = (row.attributes as Record<string, unknown>)[key];
    }
  }

  if (viewerId) {
    // Fire-and-forget view count increment; never blocks the response (DM-4 aggregate view count).
    query('UPDATE donor_profiles SET view_count = view_count + 1 WHERE id = $1', [row.id]).catch(() => {});
  }

  return {
    id: row.id,
    headline: row.headline,
    photoUrls: row.photo_urls,
    attributes: visibleAttributes,
    profileStatus: row.profile_status,
  };
}
