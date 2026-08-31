import { Router, Request, Response } from 'express';
import { authMiddleware } from '../../middleware/authentication';
import { asyncWrapper, HttpError } from '../../utils';
import { parseNumberInput } from '../../utils/requestParsers';
import { resolveTeacherId } from '../centerMgmt/middleware/access';
import { TeacherTrashService } from './trash.service';
import { TRASH_ENTITY_TYPES } from './types';

const TEACHER_TRASH_ROLES = ['teacher', 'admin'] as const;

export const teacherTrashRouter = Router();

teacherTrashRouter.use(authMiddleware([...TEACHER_TRASH_ROLES]));
teacherTrashRouter.use((req, _res, next) => {
  (req as Request & { teacherId?: number }).teacherId = resolveTeacherId(req);
  next();
});

function handleServiceError(res: Response, error: unknown) {
  if (error instanceof HttpError) {
    return res.status(error.status).json({
      success: false,
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
    });
  }
  return null;
}

teacherTrashRouter.get(
  '/',
  asyncWrapper(async (req, res) => {
    const teacherId = resolveTeacherId(req);
    const type = typeof req.query.type === 'string' ? req.query.type : undefined;
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;
    const page = parseNumberInput(req.query.page as string) ?? 1;
    const limit = parseNumberInput(req.query.limit as string) ?? 30;
    const includeActivityLog = req.query.include_activity_log !== 'false';

    const data = await TeacherTrashService.list(teacherId, {
      type,
      search,
      page,
      limit,
      includeActivityLog,
    });

    return res.json({
      success: true,
      data,
      supportedTypes: TRASH_ENTITY_TYPES,
    });
  }),
);

teacherTrashRouter.get(
  '/summary',
  asyncWrapper(async (req, res) => {
    const teacherId = resolveTeacherId(req);
    const summary = await TeacherTrashService.summary(teacherId);
    return res.json({ success: true, data: summary });
  }),
);

teacherTrashRouter.post(
  '/:type/:id/restore',
  asyncWrapper(async (req, res) => {
    const teacherId = resolveTeacherId(req);
    const type = String(req.params.type || '').trim();
    const id = parseNumberInput(req.params.id);
    if (!type) {
      return res.status(400).json({ success: false, message: 'نوع العنصر مطلوب' });
    }
    if (!id || id <= 0) {
      return res.status(400).json({ success: false, message: 'معرف العنصر غير صالح' });
    }

    const source =
      req.query.source === 'snapshot' || req.body?.source === 'snapshot'
        ? ('snapshot' as const)
        : undefined;

    try {
      const result = await TeacherTrashService.restore(teacherId, type, id, { source });
      return res.json({
        success: true,
        message: 'تمت استعادة العنصر بنجاح',
        data: result,
      });
    } catch (error) {
      const handled = handleServiceError(res, error);
      if (handled) return handled;
      throw error;
    }
  }),
);
