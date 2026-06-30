import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import pool from '../db/pool';
import { authMiddleware } from '../middleware/authentication';
import { asyncWrapper, HttpError, uploadToCloudinary } from '../utils';

const uploadDir = path.join(process.cwd(), 'uploads/teacher-free-lectures');
fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '');
      cb(null, `free-lecture-${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp/;
    const ok =
      allowed.test(path.extname(file.originalname).toLowerCase()) && allowed.test(file.mimetype);
    cb(null, ok);
  },
});

function parseBoolean(value: unknown, defaultValue: boolean): boolean {
  if (value === undefined || value === null || value === '') return defaultValue;
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  const v = String(value).trim().toLowerCase();
  return v === 'true' || v === '1' || v === 'yes';
}

function normalizeLink(link: unknown): string {
  const trimmed = String(link ?? '').trim();
  if (!trimmed) throw new HttpError(400, 'رابط المحاضرة مطلوب');
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new HttpError(400, 'الرابط يجب أن يبدأ بـ http:// أو https://');
  }
  return trimmed;
}

function normalizeTitle(title: unknown): string {
  const trimmed = String(title ?? '').trim();
  if (!trimmed) throw new HttpError(400, 'اسم المحاضرة مطلوب');
  return trimmed;
}

async function resolveImageUrl(
  file?: Express.Multer.File,
  bodyImageUrl?: unknown,
): Promise<string | null> {
  if (file) {
    const uploaded = await uploadToCloudinary(file.path);
    return uploaded.secure_url as string;
  }
  const url = String(bodyImageUrl ?? '').trim();
  return url || null;
}

async function verifyOwnership(lectureId: number, teacherId: number) {
  const result = await pool.query(
    'SELECT * FROM teacher_free_lectures WHERE id = $1 AND teacher_id = $2',
    [lectureId, teacherId],
  );
  if (!result.rowCount) throw new HttpError(404, 'المحاضرة غير موجودة');
  return result.rows[0];
}

const publicSelect = `
  SELECT
    l.id,
    l.title,
    l.link,
    l.image_url,
    l.created_at,
    l.updated_at,
    l.teacher_id,
    u.name AS teacher_name,
    u.avatar AS teacher_avatar
  FROM teacher_free_lectures l
  JOIN users u ON u.id = l.teacher_id
`;

export const publicRouter = Router();

publicRouter.get(
  '/',
  asyncWrapper(async (req, res) => {
    const teacherId = req.query.teacher_id ? Number(req.query.teacher_id) : null;
    const params: number[] = [];
    let where = 'WHERE l.is_published = TRUE';

    if (teacherId != null) {
      if (!Number.isInteger(teacherId) || teacherId <= 0) {
        throw new HttpError(400, 'teacher_id غير صحيح');
      }
      params.push(teacherId);
      where += ` AND l.teacher_id = $${params.length}`;
    }

    const result = await pool.query(
      `${publicSelect} ${where} ORDER BY l.created_at DESC`,
      params,
    );

    res.json({ success: true, lectures: result.rows });
  }),
);

publicRouter.get(
  '/:id',
  asyncWrapper(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'id غير صحيح');

    const result = await pool.query(
      `${publicSelect} WHERE l.id = $1 AND l.is_published = TRUE`,
      [id],
    );
    if (!result.rowCount) throw new HttpError(404, 'المحاضرة غير موجودة');

    res.json({ success: true, lecture: result.rows[0] });
  }),
);

// ========== Teacher CRUD ==========

export const teacherRouter = Router();

teacherRouter.post(
  '/',
  authMiddleware(['teacher']),
  upload.single('image'),
  asyncWrapper(async (req, res) => {
    const teacher_id = req.user!.id;
    const title = normalizeTitle(req.body.title);
    const link = normalizeLink(req.body.link);
    const is_published = parseBoolean(req.body.is_published, true);
    const image_url = await resolveImageUrl(req.file, req.body.image_url);

    const result = await pool.query(
      `INSERT INTO teacher_free_lectures (teacher_id, title, link, image_url, is_published)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [teacher_id, title, link, image_url, is_published],
    );

    res.status(201).json({ success: true, lecture: result.rows[0] });
  }),
);

teacherRouter.get(
  '/',
  authMiddleware(['teacher']),
  asyncWrapper(async (req, res) => {
    const teacher_id = req.user!.id;
    const result = await pool.query(
      `SELECT * FROM teacher_free_lectures
       WHERE teacher_id = $1
       ORDER BY created_at DESC`,
      [teacher_id],
    );
    res.json({ success: true, lectures: result.rows });
  }),
);

teacherRouter.get(
  '/:id',
  authMiddleware(['teacher']),
  asyncWrapper(async (req, res) => {
    const lecture = await verifyOwnership(Number(req.params.id), req.user!.id);
    res.json({ success: true, lecture });
  }),
);

teacherRouter.put(
  '/:id',
  authMiddleware(['teacher']),
  upload.single('image'),
  asyncWrapper(async (req, res) => {
    const teacher_id = req.user!.id;
    const lectureId = Number(req.params.id);
    const existing = await verifyOwnership(lectureId, teacher_id);

    const title = req.body.title !== undefined ? normalizeTitle(req.body.title) : existing.title;
    const link = req.body.link !== undefined ? normalizeLink(req.body.link) : existing.link;
    const is_published =
      req.body.is_published !== undefined
        ? parseBoolean(req.body.is_published, existing.is_published)
        : existing.is_published;

    let image_url = existing.image_url;
    if (req.file) {
      image_url = await resolveImageUrl(req.file);
    } else if (req.body.image_url !== undefined) {
      const url = String(req.body.image_url ?? '').trim();
      image_url = url || null;
    }

    const result = await pool.query(
      `UPDATE teacher_free_lectures
       SET title = $1, link = $2, image_url = $3, is_published = $4
       WHERE id = $5 AND teacher_id = $6
       RETURNING *`,
      [title, link, image_url, is_published, lectureId, teacher_id],
    );

    res.json({ success: true, lecture: result.rows[0] });
  }),
);

teacherRouter.delete(
  '/:id',
  authMiddleware(['teacher']),
  asyncWrapper(async (req, res) => {
    const teacher_id = req.user!.id;
    const lectureId = Number(req.params.id);
    await verifyOwnership(lectureId, teacher_id);
    await pool.query('DELETE FROM teacher_free_lectures WHERE id = $1', [lectureId]);
    res.json({ success: true });
  }),
);
