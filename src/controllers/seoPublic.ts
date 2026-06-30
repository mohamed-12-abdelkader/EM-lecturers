import { Router } from 'express';
import { z } from 'zod';
import { asyncWrapper } from '../utils';
import { SeoSearchService } from '../services/seo/search';

export const router = Router();

const SearchQuerySchema = z.object({
  q: z.string().optional(),
  specialty: z.string().optional(),
  subject: z.string().optional(),
  grade: z.string().optional(),
  stage: z.string().optional(),
  keywords: z.string().optional(),
  tenant_id: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

router.get(
  '/search',
  asyncWrapper(async (req, res) => {
    const parsed = SearchQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ success: false, errors: parsed.error.errors });
    }
    const data = await SeoSearchService.search(parsed.data);
    res.json({ success: true, data });
  }),
);

router.get(
  '/search/suggestions',
  asyncWrapper(async (req, res) => {
    const q = String(req.query.q ?? '');
    const tenantId = req.query.tenant_id ? Number(req.query.tenant_id) : undefined;
    const suggestions = await SeoSearchService.suggestions(q, tenantId);
    res.json({ success: true, data: { suggestions } });
  }),
);

router.get(
  '/search/trending',
  asyncWrapper(async (req, res) => {
    const tenantId = req.query.tenant_id ? Number(req.query.tenant_id) : undefined;
    const days = req.query.days ? Number(req.query.days) : 7;
    const trending = await SeoSearchService.trending(tenantId, days);
    res.json({ success: true, data: { trending } });
  }),
);

router.get(
  '/popular/teachers',
  asyncWrapper(async (req, res) => {
    const limit = req.query.limit ? Number(req.query.limit) : 10;
    const teachers = await SeoSearchService.popularTeachers(limit);
    res.json({ success: true, data: { teachers } });
  }),
);

router.get(
  '/popular/courses',
  asyncWrapper(async (req, res) => {
    const limit = req.query.limit ? Number(req.query.limit) : 10;
    const tenantId = req.query.tenant_id ? Number(req.query.tenant_id) : undefined;
    const courses = await SeoSearchService.popularCourses(limit, tenantId);
    res.json({ success: true, data: { courses } });
  }),
);
