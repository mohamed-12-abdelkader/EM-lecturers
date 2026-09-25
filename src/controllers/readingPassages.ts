import { Router } from 'express';
import { authMiddleware } from '../middleware/authentication';
import { asyncWrapper, HttpError } from '../utils';
import { TeacherReadingPassagesService } from '../services/teacherReadingPassages';

export const router = Router();

function parsePassageId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw new HttpError(400, 'passageId غير صحيح');
  }
  return id;
}

/**
 * POST /api/questions/reading-passage
 * (also mounted under /api/teacher/questions/reading-passage)
 */
router.post(
  '/reading-passage',
  authMiddleware(['teacher']),
  asyncWrapper(async (req, res) => {
    const data = await TeacherReadingPassagesService.create(req.user!.id, req.body);
    res.status(201).json({
      success: true,
      message: `تمت إضافة قطعة القراءة مع ${data.questionsCount} سؤال بنجاح`,
      data,
    });
  }),
);

/**
 * GET /api/questions/reading-passage/:passageId
 */
router.get(
  '/reading-passage/:passageId',
  authMiddleware(['teacher']),
  asyncWrapper(async (req, res) => {
    const passageId = parsePassageId(req.params.passageId);
    const data = await TeacherReadingPassagesService.getById(req.user!.id, passageId);
    res.json({
      success: true,
      data,
    });
  }),
);

/**
 * PUT /api/questions/reading-passage/:passageId
 */
router.put(
  '/reading-passage/:passageId',
  authMiddleware(['teacher']),
  asyncWrapper(async (req, res) => {
    const passageId = parsePassageId(req.params.passageId);
    const data = await TeacherReadingPassagesService.update(req.user!.id, passageId, req.body);
    res.json({
      success: true,
      message: 'تم تحديث قطعة القراءة والأسئلة بنجاح',
      data,
    });
  }),
);

/**
 * DELETE /api/questions/reading-passage/:passageId
 */
router.delete(
  '/reading-passage/:passageId',
  authMiddleware(['teacher']),
  asyncWrapper(async (req, res) => {
    const passageId = parsePassageId(req.params.passageId);
    const data = await TeacherReadingPassagesService.remove(req.user!.id, passageId);
    res.json({
      success: true,
      message: 'تم حذف قطعة القراءة والأسئلة المرتبطة بها',
      data,
    });
  }),
);
