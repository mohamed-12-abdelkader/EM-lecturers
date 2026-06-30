import { Router } from 'express';
import { asyncWrapper, HttpError } from '../utils';
import {
  getPublicCoursesBySubdomain,
  getPublicFreeLecturesBySubdomain,
} from '../services/publicTeacherPlatform';

export const router = Router();

function normalizeSubdomainParam(raw: string): string {
  const subdomain = String(raw || '').trim().toLowerCase();
  if (!subdomain) throw new HttpError(400, 'subdomain مطلوب');
  return subdomain;
}

router.get(
  '/:subdomain/free-lectures',
  asyncWrapper(async (req, res) => {
    const subdomain = normalizeSubdomainParam(req.params.subdomain);
    const data = await getPublicFreeLecturesBySubdomain(subdomain);
    if (!data) {
      return res.status(404).json({
        success: false,
        code: 'TENANT_NOT_FOUND',
        message: 'منصة المدرّس غير موجودة أو غير نشطة',
      });
    }
    res.json({ success: true, data });
  }),
);

router.get(
  '/:subdomain/courses',
  asyncWrapper(async (req, res) => {
    const subdomain = normalizeSubdomainParam(req.params.subdomain);
    const gradeId = req.query.grade_id ? Number(req.query.grade_id) : null;
    const data = await getPublicCoursesBySubdomain(subdomain, gradeId);
    if (!data) {
      return res.status(404).json({
        success: false,
        code: 'TENANT_NOT_FOUND',
        message: 'منصة المدرّس غير موجودة أو غير نشطة',
      });
    }
    res.json({ success: true, data });
  }),
);
