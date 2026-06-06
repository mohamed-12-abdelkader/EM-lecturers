import { Router } from 'express';
import { asyncWrapper } from '../utils';
import { TenantService } from '../services/tenants';

export const router = Router();

/** Public grades list for a teacher platform by subdomain (no auth). */
router.get(
  '/:subdomain/grades',
  asyncWrapper(async (req, res) => {
    const subdomain = String(req.params.subdomain || '')
      .trim()
      .toLowerCase();
    if (!subdomain) return res.status(400).json({ message: 'subdomain required' });

    const grades = await TenantService.getPublicTeacherGradesBySubdomain(subdomain);
    if (grades === null) return res.status(404).json({ success: false, code: 'TENANT_NOT_FOUND' });

    res.json({ success: true, data: { subdomain, grades } });
  }),
);

/** Public read-model for Next.js / marketing (no auth). */
router.get(
  '/:subdomain',
  asyncWrapper(async (req, res) => {
    const subdomain = String(req.params.subdomain || '')
      .trim()
      .toLowerCase();
    if (!subdomain) return res.status(400).json({ message: 'subdomain required' });

    const bundle = await TenantService.getPublicBundle(subdomain);
    if (!bundle) return res.status(404).json({ success: false, code: 'TENANT_NOT_FOUND' });

    res.json({ success: true, data: bundle });
  }),
);
