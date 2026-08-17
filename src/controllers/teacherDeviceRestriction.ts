import { Router, Request } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/authentication';
import { asyncWrapper, HttpError } from '../utils';
import { StudentDeviceRestrictionService } from '../services/studentDeviceRestriction';

export const router = Router();

const UpdateSchema = z.object({
  student_device_limit: z.enum(['multiple_devices', 'single_device']),
});

function resolveTenantId(req: Request): number {
  const tenantId = req.tenant?.id;
  if (!tenantId) throw new HttpError(400, 'تعذر تحديد المنصة');
  return tenantId;
}

const OPTIONS = [
  {
    value: 'multiple_devices',
    label_ar: 'السماح للطالب باستخدام الحساب من أكثر من جهاز',
    description_ar: 'لا يتم ربط الحساب بعنوان IP. تسجيل الدخول مسموح من أي جهاز.',
  },
  {
    value: 'single_device',
    label_ar: 'السماح للطالب باستخدام الحساب من جهاز واحد فقط',
    description_ar:
      'يُربط الحساب بـ IP أول جهاز يسجّل منه الطالب، ويُرفض الدخول من عنوان مختلف حتى يعيد المدرس تعيين الجهاز.',
  },
];

/**
 * GET /api/teacher/device-restriction-settings
 */
router.get(
  '/',
  authMiddleware(['teacher', 'academy']),
  asyncWrapper(async (req, res) => {
    const settings = await StudentDeviceRestrictionService.getSettings(resolveTenantId(req));
    res.json({
      success: true,
      data: settings,
      options: OPTIONS,
    });
  }),
);

/**
 * PUT /api/teacher/device-restriction-settings
 * Body: { "student_device_limit": "multiple_devices" | "single_device" }
 */
router.put(
  '/',
  authMiddleware(['teacher', 'academy']),
  asyncWrapper(async (req, res) => {
    const parsed = UpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: 'student_device_limit يجب أن يكون multiple_devices أو single_device',
        errors: parsed.error.errors,
      });
    }

    const settings = await StudentDeviceRestrictionService.setSettings(
      resolveTenantId(req),
      parsed.data,
    );

    res.json({
      success: true,
      message:
        settings.student_device_limit === 'single_device'
          ? 'تم تفعيل تقييد الحساب على جهاز واحد'
          : 'تم السماح بتسجيل الدخول من أكثر من جهاز',
      data: settings,
    });
  }),
);
