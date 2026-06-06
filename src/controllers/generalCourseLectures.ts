import { Router } from 'express';
import { authMiddleware } from '../middleware/authentication';
import { asyncWrapper } from '../utils';
import pool from '../db/pool';
import { z } from 'zod';

export const router = Router();

// صلاحية إدارة مجموعة: المدرس صاحب المجموعة أو الأدمن
async function canManageGroup(groupId: number, userId: number, role: string): Promise<boolean> {
    if (role === 'admin') return true;
    if (role !== 'teacher') return false;
    const r = await pool.query(
        'SELECT 1 FROM general_course_groups WHERE id = $1 AND teacher_id = $2',
        [groupId, userId],
    );
    return (r.rowCount ?? 0) > 0;
}

// Schemas
const CreateLectureSchema = z.object({
    group_id: z.number({ required_error: 'معرف المجموعة مطلوب' }),
    title: z.string().min(1, 'عنوان المحاضرة مطلوب'),
    description: z.string().optional(),
});

const UpdateLectureSchema = z.object({
    title: z.string().min(1, 'عنوان المحاضرة مطلوب').optional(),
    description: z.string().optional(),
});

const AddVideoSchema = z.object({
    lecture_id: z.number({ required_error: 'معرف المحاضرة مطلوب' }),
    name: z.string().min(1, 'اسم الفيديو مطلوب'),
    url: z.string().url('رابط الفيديو غير صحيح'),
});

// جلب محاضرات مجموعة — للمدرس صاحب المجموعة أو الأدمن
router.get(
    '/by-group/:groupId',
    authMiddleware(['admin', 'teacher']),
    asyncWrapper(async (req, res) => {
        const groupId = Number(req.params.groupId);
        if (isNaN(groupId)) {
            return res.status(400).json({ success: false, message: 'معرف المجموعة غير صحيح' });
        }
        const user = req.user!;
        const allowed = await canManageGroup(groupId, user.id, user.role);
        if (!allowed) {
            return res.status(403).json({
                success: false,
                message: 'ليس لديك صلاحية عرض محاضرات هذه المجموعة',
            });
        }
        const result = await pool.query(
            `SELECT l.id, l.general_course_id, l.group_id, l.title, l.description, l.created_at, l.updated_at,
                    (SELECT COALESCE(json_agg(
                      json_build_object('id', v.id, 'name', v.name, 'url', v.url, 'created_at', v.created_at)
                      ORDER BY v.created_at
                    ), '[]'::json)
                    FROM general_course_videos v WHERE v.lecture_id = l.id) as videos
             FROM general_course_lectures l
             WHERE l.group_id = $1
             ORDER BY l.created_at ASC`,
            [groupId],
        );
        res.json({ success: true, lectures: result.rows });
    }),
);

// إنشاء محاضرة جديدة (خاصة بمجموعة معينة) — للمدرس صاحب المجموعة أو الأدمن
router.post(
    '/',
    authMiddleware(['admin', 'teacher']),
    asyncWrapper(async (req, res) => {
        const parse = CreateLectureSchema.safeParse(req.body);
        if (!parse.success) {
            return res.status(400).json({
                success: false,
                message: 'بيانات غير صحيحة',
                errors: parse.error.errors,
            });
        }
        const { group_id, title, description } = parse.data;
        const user = req.user!;

        const allowed = await canManageGroup(group_id, user.id, user.role);
        if (!allowed) {
            return res.status(403).json({
                success: false,
                message: 'ليس لديك صلاحية إدارة هذه المجموعة',
            });
        }

        const groupCheck = await pool.query(
            'SELECT general_course_id FROM general_course_groups WHERE id = $1',
            [group_id],
        );
        if (groupCheck.rowCount === 0) {
            return res.status(404).json({
                success: false,
                message: 'المجموعة غير موجودة',
            });
        }
        const general_course_id = groupCheck.rows[0].general_course_id;

        const result = await pool.query(
            `INSERT INTO general_course_lectures (general_course_id, group_id, title, description)
             VALUES ($1, $2, $3, $4) RETURNING *`,
            [general_course_id, group_id, title, description || null],
        );

        try {
                  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
            const { NotificationService } = await import('../services/notifications');
            await NotificationService.notifyGeneralCourseLectureAdded(
                general_course_id,
                result.rows[0].id,
                title,
            );
        } catch (notifError) {
            console.error('Error sending lecture notification:', notifError);
        }

        res.status(201).json({
            success: true,
            message: 'تم إنشاء المحاضرة بنجاح',
            lecture: result.rows[0],
        });
    }),
);

// تحديث محاضرة — للمدرس صاحب مجموعة المحاضرة أو الأدمن
router.put(
    '/:id',
    authMiddleware(['admin', 'teacher']),
    asyncWrapper(async (req, res) => {
        const lectureId = Number(req.params.id);
        if (isNaN(lectureId)) {
            return res.status(400).json({ success: false, message: 'معرف المحاضرة غير صحيح' });
        }

        const parse = UpdateLectureSchema.safeParse(req.body);
        if (!parse.success) {
            return res.status(400).json({
                success: false,
                message: 'بيانات غير صحيحة',
                errors: parse.error.errors,
            });
        }
        const { title, description } = parse.data;
        const user = req.user!;

        const check = await pool.query(
            'SELECT * FROM general_course_lectures WHERE id = $1',
            [lectureId],
        );
        if (check.rowCount === 0) {
            return res.status(404).json({ success: false, message: 'المحاضرة غير موجودة' });
        }
        const lecture = check.rows[0] as { group_id: number | null };
        if (lecture.group_id != null) {
            const allowed = await canManageGroup(lecture.group_id, user.id, user.role);
            if (!allowed) {
                return res.status(403).json({
                    success: false,
                    message: 'ليس لديك صلاحية تعديل محاضرات هذه المجموعة',
                });
            }
        } else if (user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                message: 'المحاضرة قديمة ومرتبطة بالكورس فقط؛ التعديل للأدمن',
            });
        }

        const updates: string[] = [];
        const values: any[] = [];
        let idx = 1;

        if (title !== undefined) {
            updates.push(`title = $${idx++}`);
            values.push(title);
        }
        if (description !== undefined) {
            updates.push(`description = $${idx++}`);
            values.push(description);
        }

        updates.push(`updated_at = NOW()`);

        if (values.length > 0) {
            values.push(lectureId);
            const q = `UPDATE general_course_lectures SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`;
            const result = await pool.query(q, values);
            return res.json({
                success: true,
                message: 'تم تحديث المحاضرة بنجاح',
                lecture: result.rows[0],
            });
        }

        res.json({
            success: true,
            message: 'لم يتم إجراء أي تغييرات',
            lecture: check.rows[0],
        });
    }),
);

// حذف محاضرة — للمدرس صاحب مجموعة المحاضرة أو الأدمن
router.delete(
    '/:id',
    authMiddleware(['admin', 'teacher']),
    asyncWrapper(async (req, res) => {
        const id = Number(req.params.id);
        if (isNaN(id)) {
            return res.status(400).json({ success: false, message: 'معرف المحاضرة غير صحيح' });
        }
        const user = req.user!;

        const check = await pool.query(
            'SELECT group_id FROM general_course_lectures WHERE id = $1',
            [id],
        );
        if (check.rowCount === 0) {
            return res.status(404).json({ success: false, message: 'المحاضرة غير موجودة' });
        }
        const groupId = (check.rows[0] as { group_id: number | null }).group_id;
        if (groupId != null) {
            const allowed = await canManageGroup(groupId, user.id, user.role);
            if (!allowed) {
                return res.status(403).json({
                    success: false,
                    message: 'ليس لديك صلاحية حذف محاضرات هذه المجموعة',
                });
            }
        } else if (user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                message: 'حذف المحاضرة القديمة للأدمن فقط',
            });
        }

        const result = await pool.query(
            'DELETE FROM general_course_lectures WHERE id = $1 RETURNING id',
            [id],
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ success: false, message: 'المحاضرة غير موجودة' });
        }

        res.json({ success: true, message: 'تم حذف المحاضرة بنجاح' });
    }),
);

// إضافة فيديو للمحاضرة — للمدرس صاحب مجموعة المحاضرة أو الأدمن
router.post(
    '/video',
    authMiddleware(['admin', 'teacher']),
    asyncWrapper(async (req, res) => {
        const parse = AddVideoSchema.safeParse(req.body);
        if (!parse.success) {
            return res.status(400).json({
                success: false,
                message: 'بيانات غير صحيحة',
                errors: parse.error.errors,
            });
        }
        const { lecture_id, name, url } = parse.data;
        const user = req.user!;

        const lectureCheck = await pool.query(
            'SELECT id, group_id FROM general_course_lectures WHERE id = $1',
            [lecture_id],
        );
        if (lectureCheck.rowCount === 0) {
            return res.status(404).json({ success: false, message: 'المحاضرة غير موجودة' });
        }
        const row = lectureCheck.rows[0] as { group_id: number | null };
        if (row.group_id != null) {
            const allowed = await canManageGroup(row.group_id, user.id, user.role);
            if (!allowed) {
                return res.status(403).json({
                    success: false,
                    message: 'ليس لديك صلاحية إضافة فيديو لمحاضرات هذه المجموعة',
                });
            }
        } else if (user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                message: 'إضافة فيديو للمحاضرات القديمة للأدمن فقط',
            });
        }

        const result = await pool.query(
            'INSERT INTO general_course_videos (lecture_id, name, url) VALUES ($1, $2, $3) RETURNING *',
            [lecture_id, name, url],
        );

        try {
                  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
            const { NotificationService } = await import('../services/notifications');
            const lectureInfo = await pool.query(
                `SELECT gcl.id, gcl.title as lecture_title, gcl.general_course_id
                 FROM general_course_lectures gcl WHERE gcl.id = $1`,
                [lecture_id],
            );
            if (lectureInfo.rowCount) {
                await NotificationService.notifyGeneralCourseVideoAdded(
                    lectureInfo.rows[0].general_course_id,
                    lecture_id,
                    result.rows[0].id,
                    name,
                    lectureInfo.rows[0].lecture_title,
                );
            }
        } catch (notifError) {
            console.error('Error sending video notification:', notifError);
        }

        res.status(201).json({
            success: true,
            message: 'تم إضافة الفيديو بنجاح',
            video: result.rows[0],
        });
    }),
);
