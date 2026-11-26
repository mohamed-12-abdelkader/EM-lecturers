import pool from '../db/pool';
import { buildTenantPublicUrl } from '../config/appUrls';
import {
  arabicTokenVariants,
  extractSearchTokens,
  normalizeArabicForSearch,
  sqlNormalizeArabic,
} from '../utils/arabicSearch';

export type PlatformSearchResult = {
  teacherName: string;
  subdomain: string;
  platformUrl: string;
  displayName: string | null;
  specialty: string | null;
};

export type PlatformSearchResponse = {
  items: PlatformSearchResult[];
  total: number;
  query: string;
};

const MAX_LIMIT = 10;
const MIN_QUERY_LEN = 1;

/**
 * Public directory search for active teacher/academy platforms.
 * Uses Arabic normalization + ranked matching (exact → prefix → partial).
 */
export class TenantPlatformSearchService {
  static async search(rawQuery: string, limitRaw?: number): Promise<PlatformSearchResponse> {
    const query = String(rawQuery || '').trim().slice(0, 120);
    const limit = Math.min(Math.max(Number(limitRaw) || MAX_LIMIT, 1), MAX_LIMIT);

    if (query.length < MIN_QUERY_LEN) {
      return { items: [], total: 0, query };
    }

    const normalizedFull = normalizeArabicForSearch(query);
    const tokens = extractSearchTokens(query);
    if (!tokens.length || !normalizedFull) {
      return { items: [], total: 0, query };
    }

    const params: Array<string | number> = [normalizedFull];
    const nameNorm = sqlNormalizeArabic('COALESCE(u.name, t.display_name)');
    const displayNorm = sqlNormalizeArabic('t.display_name');
    const ownerNorm = sqlNormalizeArabic('u.name');
    const specialtyNorm = sqlNormalizeArabic('t.specialty');
    const subdomainNorm = `translate(lower(COALESCE(t.subdomain, '')), '-', ' ')`;

    const tokenClauses: string[] = [];
    for (const token of tokens) {
      const variants = arabicTokenVariants(token);
      const likes: string[] = [];
      for (const v of variants) {
        params.push(`%${v}%`);
        likes.push(`$${params.length}`);
      }
      tokenClauses.push(`(
        ${likes
          .map(
            (p) => `(
              ${displayNorm} LIKE ${p}
              OR ${ownerNorm} LIKE ${p}
              OR ${specialtyNorm} LIKE ${p}
              OR ${subdomainNorm} LIKE ${p}
            )`,
          )
          .join(' OR ')}
      )`);
    }

    params.push(limit);
    const limitParam = `$${params.length}`;

    const sql = `
      SELECT
        t.id,
        t.subdomain,
        t.display_name,
        t.specialty,
        u.name AS owner_name,
        CASE
          WHEN ${nameNorm} = $1 THEN 0
          WHEN ${displayNorm} = $1 OR ${ownerNorm} = $1 THEN 1
          WHEN ${nameNorm} LIKE $1 || '%' THEN 2
          WHEN ${displayNorm} LIKE $1 || '%' OR ${ownerNorm} LIKE $1 || '%' THEN 3
          WHEN ${subdomainNorm} LIKE $1 || '%' OR replace(lower(t.subdomain), '-', '') LIKE replace($1, ' ', '') || '%' THEN 4
          ELSE 5
        END AS match_rank,
        length(COALESCE(u.name, t.display_name, '')) AS name_len
      FROM tenants t
      LEFT JOIN users u ON u.id = t.owner_user_id
      WHERE t.is_active = TRUE
        AND t.subdomain IS NOT NULL
        AND t.subdomain <> 'default'
        AND t.subdomain NOT LIKE 'deleted-%'
        AND (${tokenClauses.join(' AND ')})
      ORDER BY match_rank ASC, name_len ASC, t.id ASC
      LIMIT ${limitParam}
    `;

    const res = await pool.query(sql, params);
    const seen = new Set<string>();
    const items: PlatformSearchResult[] = [];

    for (const row of res.rows) {
      const subdomain = String(row.subdomain || '').trim().toLowerCase();
      if (!subdomain || seen.has(subdomain)) continue;
      seen.add(subdomain);

      const teacherName =
        String(row.owner_name || '').trim() ||
        String(row.display_name || '').trim() ||
        subdomain;

      items.push({
        teacherName,
        subdomain,
        platformUrl: buildTenantPublicUrl(subdomain),
        displayName: row.display_name ? String(row.display_name) : null,
        specialty: row.specialty ? String(row.specialty) : null,
      });
    }

    return { items, total: items.length, query };
  }
}
