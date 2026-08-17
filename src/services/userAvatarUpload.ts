import fs from 'fs';
import path from 'path';
import multer from 'multer';
import type { NextFunction, Request, Response } from 'express';
import pool from '../db/pool';
import { uploadToBunnyStorage } from './bunny';
import { buildFileUrl } from '../config/appUrls';

const AVATAR_DIR = path.join('uploads', 'avatars');
const MAX_SIZE = 5 * 1024 * 1024;
const ALLOWED = /jpeg|jpg|png|gif|webp/;

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    fs.mkdirSync(AVATAR_DIR, { recursive: true });
    cb(null, AVATAR_DIR);
  },
  filename: (_req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `avatar-${uniqueSuffix}${path.extname(file.originalname).toLowerCase()}`);
  },
});

export const uploadUserAvatar = multer({
  storage,
  limits: { fileSize: MAX_SIZE, files: 1 },
  fileFilter: (_req, file, cb) => {
    const extOk = ALLOWED.test(path.extname(file.originalname).toLowerCase());
    const mimeOk = ALLOWED.test(file.mimetype);
    if (extOk && mimeOk) {
      cb(null, true);
      return;
    }
    cb(new Error('يُسمح فقط بصور JPG أو PNG أو GIF أو WEBP'));
  },
});

export function pickUploadedAvatar(req: Request): Express.Multer.File | undefined {
  if (req.file) return req.file;
  const files = req.files;
  if (!files) return undefined;
  if (Array.isArray(files)) return files[0];
  const named =
    files.avatar?.[0] || files.image?.[0] || files.photo?.[0] || files.file?.[0];
  return named;
}

export function handleAvatarMulterError(
  err: unknown,
  _req: Request,
  res: Response,
  next: NextFunction,
) {
  if (!err) {
    next();
    return;
  }
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      res.status(400).json({
        success: false,
        message: 'حجم الصورة يجب ألا يتجاوز 5 ميجابايت',
        code: 'AVATAR_TOO_LARGE',
      });
      return;
    }
    res.status(400).json({
      success: false,
      message: 'فشل رفع الصورة',
      code: 'AVATAR_UPLOAD_FAILED',
    });
    return;
  }
  if (err instanceof Error) {
    res.status(400).json({
      success: false,
      message: err.message,
      code: 'INVALID_AVATAR',
    });
    return;
  }
  next(err);
}

export function uploadStudentAvatarMiddleware(req: Request, res: Response, next: NextFunction) {
  const handler = uploadUserAvatar.fields([
    { name: 'avatar', maxCount: 1 },
    { name: 'image', maxCount: 1 },
    { name: 'photo', maxCount: 1 },
    { name: 'file', maxCount: 1 },
  ]);
  handler(req, res, (err: unknown) => {
    if (err) {
      handleAvatarMulterError(err, req, res, next);
      return;
    }
    next();
  });
}

export function uploadMeAvatarMiddleware(req: Request, res: Response, next: NextFunction) {
  uploadUserAvatar.single('avatar')(req, res, (err: unknown) => {
    if (err) {
      handleAvatarMulterError(err, req, res, next);
      return;
    }
    next();
  });
}

/** Bunny أولاً، ثم ملف محلي تحت /uploads/avatars */
export async function persistAvatarFile(file: Express.Multer.File): Promise<string> {
  const ext =
    (path.extname(file.originalname || file.filename) || '.jpg').replace('.', '').slice(0, 8) ||
    'jpg';
  const bunnyCopy = `${file.path}.bunny`;

  try {
    fs.copyFileSync(file.path, bunnyCopy);
    const url = await uploadToBunnyStorage({
      path: bunnyCopy,
      ext,
      mime: file.mimetype || 'image/jpeg',
      originalname: file.originalname,
    });
    try {
      if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
    } catch {
      // ignore
    }
    return url;
  } catch (err: any) {
    console.warn('Avatar Bunny upload failed, using local /uploads/avatars:', err?.message || err);
    try {
      if (fs.existsSync(bunnyCopy)) fs.unlinkSync(bunnyCopy);
    } catch {
      // ignore
    }
    if (!fs.existsSync(file.path)) {
      throw new Error('فشل رفع صورة البروفايل');
    }
    return `/uploads/avatars/${file.filename}`;
  }
}

export function publicAvatarUrl(stored: string | null | undefined): string | null {
  return buildFileUrl(stored);
}

export async function saveAvatarForUser(userId: number, file: Express.Multer.File) {
  const stored = await persistAvatarFile(file);
  const updated = await pool.query(
    `UPDATE users SET avatar = $1 WHERE id = $2
     RETURNING id, name, phone, email, parent_phone, role, avatar, created_at`,
    [stored, userId],
  );
  if (!updated.rowCount) return null;
  const row = updated.rows[0];
  return { ...row, avatar: publicAvatarUrl(row.avatar) };
}

export async function clearAvatarForStudent(userId: number) {
  const updated = await pool.query(
    `UPDATE users SET avatar = NULL WHERE id = $1 AND role = 'student'
     RETURNING id, name, phone, email, parent_phone, role, avatar, created_at`,
    [userId],
  );
  if (!updated.rowCount) return null;
  return { ...updated.rows[0], avatar: null };
}
