import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/authentication';
import { validate } from '../middleware/validateReq';
import { asyncWrapper } from '../utils';
import { TeacherScheduleService } from '../services/teacherSchedule';

export const router = Router();

const TaskBody = z.object({
  teacherId: z.coerce.number().int().positive(),
  taskType: z.enum(['lecture', 'live', 'exam', 'homework']),
  title: z.string().min(1),
  courseName: z.string().optional().nullable(),
  relatedCourseId: z.coerce.number().int().positive().optional().nullable(),
  relatedGroupId: z.coerce.number().int().positive().optional().nullable(),
  taskDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTime: z.string().optional().nullable(),
  endTime: z.string().optional().nullable(),
  dueAt: z.string().optional().nullable(),
  meetingUrl: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

const TaskPatchBody = TaskBody.partial().extend({
  teacherId: z.coerce.number().int().positive().optional(),
  taskType: z.enum(['lecture', 'live', 'exam', 'homework']).optional(),
  title: z.string().min(1).optional(),
  taskDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

router.use(authMiddleware(['admin']));

router.get(
  '/teachers',
  asyncWrapper(async (_req, res) => {
    const teachers = await TeacherScheduleService.listTeachers();
    res.json({ success: true, teachers });
  }),
);

router.get(
  '/tasks',
  asyncWrapper(async (req, res) => {
    const teacherId = req.query.teacherId
      ? Number(req.query.teacherId)
      : undefined;
    const tasks = await TeacherScheduleService.listTasks({
      teacherId:
        teacherId && Number.isInteger(teacherId) && teacherId > 0
          ? teacherId
          : undefined,
      from: req.query.from ? String(req.query.from) : undefined,
      to: req.query.to ? String(req.query.to) : undefined,
      date: req.query.date ? String(req.query.date) : undefined,
    });
    res.json({ success: true, tasks });
  }),
);

router.get(
  '/tasks/today',
  asyncWrapper(async (req, res) => {
    const teacherId = req.query.teacherId
      ? Number(req.query.teacherId)
      : undefined;
    const tasks = await TeacherScheduleService.todaySummary(
      teacherId && Number.isInteger(teacherId) && teacherId > 0
        ? teacherId
        : undefined,
    );
    res.json({ success: true, tasks });
  }),
);

router.get(
  '/tasks/:id',
  asyncWrapper(async (req, res) => {
    const task = await TeacherScheduleService.getTask(Number(req.params.id));
    res.json({ success: true, task });
  }),
);

router.post(
  '/tasks',
  validate(TaskBody),
  asyncWrapper(async (req, res) => {
    const task = await TeacherScheduleService.createTask({
      teacherId: req.body.teacherId,
      taskType: req.body.taskType,
      title: req.body.title,
      courseName: req.body.courseName,
      relatedCourseId: req.body.relatedCourseId,
      relatedGroupId: req.body.relatedGroupId,
      taskDate: req.body.taskDate,
      startTime: req.body.startTime,
      endTime: req.body.endTime,
      dueAt: req.body.dueAt,
      meetingUrl: req.body.meetingUrl,
      notes: req.body.notes,
      createdBy: req.user?.id ?? null,
    });
    res.status(201).json({ success: true, task });
  }),
);

router.patch(
  '/tasks/:id',
  validate(TaskPatchBody),
  asyncWrapper(async (req, res) => {
    const task = await TeacherScheduleService.updateTask(Number(req.params.id), {
      teacherId: req.body.teacherId,
      taskType: req.body.taskType,
      title: req.body.title,
      courseName: req.body.courseName,
      relatedCourseId: req.body.relatedCourseId,
      relatedGroupId: req.body.relatedGroupId,
      taskDate: req.body.taskDate,
      startTime: req.body.startTime,
      endTime: req.body.endTime,
      dueAt: req.body.dueAt,
      meetingUrl: req.body.meetingUrl,
      notes: req.body.notes,
    });
    res.json({ success: true, task });
  }),
);

router.delete(
  '/tasks/:id',
  asyncWrapper(async (req, res) => {
    const result = await TeacherScheduleService.deleteTask(Number(req.params.id));
    res.json({ success: true, ...result });
  }),
);
