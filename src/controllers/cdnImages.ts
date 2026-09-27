import { Router } from 'express';
import { buildFileUrl } from '../config/appUrls';
import { authMiddleware } from '../middleware/authentication';
import {
  isAllowedImageUpload,
  saveLocalImageFile,
  toLegacyUploadsPath,
} from '../services/localImageStorage';
import { asyncWrapper, HttpError, upload } from '../utils';

export const router = Router();

/**
 * POST /api/cdn/images
 * Auth: admin | teacher
 * multipart field: `image`
 * optional form field: `category` (users|teachers|courses|lessons|questions|general|…)
 *
 * Saves under uploads/<category>/ and returns a public /cdn/... URL (images only).
 */
router.post(
  '/images',
  authMiddleware(['admin', 'teacher']),
  upload.single('image'),
  asyncWrapper(async (req, res) => {
    if (!req.file?.path) {
      throw new HttpError(400, 'أرفق صورة في الحقل image');
    }

    if (!isAllowedImageUpload(req.file.mimetype, req.file.originalname)) {
      throw new HttpError(400, 'يُسمح فقط بصور JPEG / PNG / WEBP / GIF');
    }

    const category =
      String(req.body?.category || req.query.category || 'general').trim().toLowerCase() ||
      'general';

    const saved = saveLocalImageFile(req.file.path, {
      category,
      originalFilename: req.file.originalname,
    });

    const cdnPath = String(saved.secure_url || saved.url);
    const uploadsPath = toLegacyUploadsPath(
      String(saved.folder || category),
      String(saved.original_filename || ''),
    );

    return res.status(201).json({
      success: true,
      data: {
        path: cdnPath,
        url: buildFileUrl(cdnPath),
        uploads_path: uploadsPath,
        category: saved.folder || category,
        bytes: saved.bytes,
        format: saved.format,
      },
    });
  }),
);

/** Also accept field name `file` via a thin alias route */
router.post(
  '/upload',
  authMiddleware(['admin', 'teacher']),
  upload.single('file'),
  asyncWrapper(async (req, res) => {
    if (!req.file?.path) {
      throw new HttpError(400, 'أرفق صورة في الحقل file');
    }
    if (!isAllowedImageUpload(req.file.mimetype, req.file.originalname)) {
      throw new HttpError(400, 'يُسمح فقط بصور JPEG / PNG / WEBP / GIF');
    }

    const category = String(req.body?.category || 'general').trim().toLowerCase() || 'general';
    const saved = saveLocalImageFile(req.file.path, {
      category,
      originalFilename: req.file.originalname,
    });
    const cdnPath = String(saved.secure_url || saved.url);

    return res.status(201).json({
      success: true,
      data: {
        path: cdnPath,
        url: buildFileUrl(cdnPath),
        uploads_path: toLegacyUploadsPath(
          String(saved.folder || category),
          String(saved.original_filename || ''),
        ),
        category: saved.folder || category,
        bytes: saved.bytes,
        format: saved.format,
      },
    });
  }),
);
