import rateLimit from 'express-rate-limit';
import { myFilesConfig } from '../config';

export const teacherFilesUploadRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'تم تجاوز حد رفع الملفات. حاول مرة أخرى لاحقاً.',
  },
});

export const teacherFilesDownloadRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'تم تجاوز حد التحميل. حاول مرة أخرى لاحقاً.',
  },
});

export const teacherFilesBulkUploadRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'تم تجاوز حد الرفع الجماعي. حاول مرة أخرى لاحقاً.',
  },
});

/** Guard against oversized uploads at middleware level (multer also enforces). */
export const teacherFilesMaxSizeBytes = myFilesConfig.maxFileSizeBytes;
