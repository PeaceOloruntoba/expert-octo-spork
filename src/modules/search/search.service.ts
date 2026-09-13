import { query } from '../../db/pool';

export interface SearchFilters {
  q?: string;
  attributeFilters?: Record<string, string>;
  limit?: number;
  offset?: number;
}

/**
 * Recipient search & filter (DM-1, DM-2):
 *  - Only donors with profile_status = 'published' (which itself requires
 *    verification=verified AND screening=eligible, see donors.service.publishDonorProfile)
 *    are ever returned.
 *  - Only attributes the donor has toggled visible are matched against / returned.
 */
export async function searchDonors(filters: SearchFilters) {
  const limit = Math.min(filters.limit ?? 20, 50);
  const offset = filters.offset ?? 0;

  const params: unknown[] = [];
  const conditions: string[] = [`profile_status = 'published'`];

  if (filters.q) {
    params.push(`%${filters.q.toLowerCase()}%`);
    conditions.push(`(LOWER(headline) LIKE $${params.length} OR LOWER(bio) LIKE $${params.length})`);
  }

  // Each attribute filter must both (a) match the stored value and (b) be visible=true,
  // enforced by checking the visibility JSONB alongside the attributes JSONB.
  if (filters.attributeFilters) {
    for (const [key, value] of Object.entries(filters.attributeFilters)) {
      params.push(key);
      params.push(value);
      conditions.push(
        `(visibility->>$${params.length - 1})::boolean IS TRUE AND attributes->>$${params.length - 1} = $${params.length}`
      );
    }
  }

  params.push(limit);
  params.push(offset);

  const sql = `
    SELECT id, headline, photo_urls, attributes, visibility, view_count
    FROM donor_profiles
    WHERE ${conditions.join(' AND ')}
    ORDER BY created_at DESC
    LIMIT $${params.length - 1} OFFSET $${params.length}
  `;

  const result = await query(sql, params);

  return result.rows.map((row: any) => {
    const visibleAttributes: Record<string, unknown> = {};
    for (const [key, isVisible] of Object.entries(row.visibility ?? {})) {
      if (isVisible && key in (row.attributes ?? {})) {
        visibleAttributes[key] = row.attributes[key];
      }
    }
    return {
      id: row.id,
      headline: row.headline,
      photoUrls: row.photo_urls,
      attributes: visibleAttributes,
      // DM-3 compatibility score: MVP starter uses a simple match-count heuristic.
      // TODO: replace with the documented/testable scoring logic once product defines it.
      compatibilityScore: filters.attributeFilters
        ? Object.keys(filters.attributeFilters).length > 0
          ? Math.round(
              (Object.keys(visibleAttributes).filter((k) => filters.attributeFilters?.[k] !== undefined).length /
                Math.max(Object.keys(filters.attributeFilters).length, 1)) *
                100
            )
          : null
        : null,
    };
  });
}
