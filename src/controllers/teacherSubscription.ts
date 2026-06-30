import { Router } from 'express';
import { authMiddleware } from '../middleware/authentication';
import { asyncWrapper } from '../utils';
import { TeacherPlatformSubscriptionsService } from '../services/teacherPlatformSubscriptions';
import { TeacherSubscriptionInvoicesService } from '../services/teacherSubscriptionInvoices';
import { getTeacherPlanAccess } from '../services/teacherPlanPolicy';

export const router = Router();

router.use(authMiddleware(['teacher']));

/** صلاحيات الباقة الحالية — للواجهة (إظهار/إخفاء الخدمات) */
router.get(
  '/plan-access',
  asyncWrapper(async (req, res) => {
    const data = await getTeacherPlanAccess((req as any).user.id);
    res.json({ success: true, data });
  }),
);

/** Expiry alert for teacher dashboard — hidden automatically after renewal */
router.get(
  '/expiry-alert',
  asyncWrapper(async (req, res) => {
    const days = req.query.days ? Number(req.query.days) : undefined;
    const graceDays = req.query.grace_days ? Number(req.query.grace_days) : undefined;
    const data = await TeacherPlatformSubscriptionsService.getTeacherExpiryAlert(
      (req as any).user.id,
      days,
      graceDays,
    );
    res.json({ success: true, data });
  }),
);

/** فواتير اشتراكات المدرس */
router.get(
  '/invoices',
  asyncWrapper(async (req, res) => {
    const data = await TeacherSubscriptionInvoicesService.listForTeacher((req as any).user.id, {
      invoice_type: req.query.invoice_type as any,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      offset: req.query.offset ? Number(req.query.offset) : undefined,
    });
    res.json({ success: true, data });
  }),
);

router.get(
  '/invoices/:id',
  asyncWrapper(async (req, res) => {
    const invoice = await TeacherSubscriptionInvoicesService.requireForTeacher(
      Number(req.params.id),
      (req as any).user.id,
    );
    res.json({ success: true, data: invoice });
  }),
);
