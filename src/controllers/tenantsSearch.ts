import { Router } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { asyncWrapper } from '../utils';
import { TenantPlatformSearchService } from '../services/tenantPlatformSearch';

export const router = Router();

const searchLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const fwd = req.headers['x-forwarded-for'];
    const raw =
      typeof fwd === 'string' && fwd.trim()
        ? fwd.split(',')[0].trim()
        : req.ip || req.socket?.remoteAddress || '127.0.0.1';
    return ipKeyGenerator(raw);
  },
  validate: { xForwardedForHeader: false, trustProxy: false },
  message: {
    success: false,
    message: 'طلبات بحث كثيرة. حاول بعد قليل.',
    code: 'RATE_LIMITED',
  },
});

/**
 * GET /api/tenants/search?q=علاء&limit=10
 * Public live search for active teacher platforms (safe, limited fields).
 */
router.get(
  '/',
  searchLimiter,
  asyncWrapper(async (req, res) => {
    const q = String(req.query.q ?? req.query.query ?? '').trim();
    if (!q) {
      return res.status(400).json({
        success: false,
        message: 'معامل البحث q مطلوب',
        code: 'QUERY_REQUIRED',
      });
    }
    if (q.length > 120) {
      return res.status(400).json({
        success: false,
        message: 'نص البحث طويل جداً',
        code: 'QUERY_TOO_LONG',
      });
    }

    const limitRaw = req.query.limit;
    const result = await TenantPlatformSearchService.search(
      q,
      limitRaw != null ? Number(limitRaw) : undefined,
    );

    res.json({
      success: true,
      data: result.items.map((item) => ({
        teacherName: item.teacherName,
        subdomain: item.subdomain,
        platformUrl: item.platformUrl,
        ...(item.displayName && item.displayName !== item.teacherName
          ? { displayName: item.displayName }
          : {}),
        ...(item.specialty ? { specialty: item.specialty } : {}),
      })),
      meta: {
        total: result.total,
        query: result.query,
        limit: Math.min(Math.max(Number(limitRaw) || 10, 1), 10),
      },
    });
  }),
);
