import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/authentication';
import { ScientificChatbotService } from '../services/scientificChatbot';
import pool from '../db/pool';
import { logger, HttpError } from '../utils';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { parseNumberInput } from '../utils/requestParsers';
import { MistralOcrService } from '../services/mistralOcr';
import { enforcePlanFeature } from '../services/teacherPlanPolicy';

const router = Router();

async function assertTeacherScientificSupportForStudent(
  res: Response,
  teacherId: number,
): Promise<boolean> {
  try {
    await enforcePlanFeature(teacherId, 'scientific_support');
    return true;
  } catch (error) {
    if (error instanceof HttpError) {
      res.status(403).json({
        error: error.message,
        success: false,
        code: 'PLAN_FEATURE_NOT_AVAILABLE',
        ...(error.details ?? {}),
      });
      return false;
    }
    throw error;
  }
}

// Configure multer for course content files
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = 'uploads/course-content';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, 'scientific-content-' + uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit for text files
  },
  fileFilter: (req, file, cb) => {
    // Accept text files
    const allowedMimes = [
      'text/plain',
      'text/markdown',
      'application/pdf', // Will need to extract text from PDF
    ];

    if (
      allowedMimes.includes(file.mimetype) ||
      file.originalname.endsWith('.txt') ||
      file.originalname.endsWith('.md') ||
      file.originalname.toLowerCase().endsWith('.pdf')
    ) {
      cb(null, true);
    } else {
      cb(new Error('Only text and PDF files (.txt, .md, .pdf) are allowed'));
    }
  },
});

// Configure multer for chat images
const chatStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = 'uploads/chat-images';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, 'chat-image-' + uniqueSuffix + path.extname(file.originalname));
  },
});

const uploadChat = multer({
  storage: chatStorage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit per image
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only images are allowed'));
    }
  },
});

async function readUploadedContent(file: Express.Multer.File): Promise<string> {
  return fs.promises.readFile(file.path, 'utf-8');
}

async function cleanupUploadedFile(file?: Express.Multer.File): Promise<void> {
  if (file?.path) {
    await fs.promises.unlink(file.path).catch(() => {});
  }
}

async function cleanupChatFiles(files: Express.Multer.File[] | undefined): Promise<void> {
  if (files && Array.isArray(files)) {
    for (const file of files) {
      await fs.promises.unlink(file.path).catch(() => {});
    }
  }
}

function getChatImagePaths(files: Express.Multer.File[] | undefined): string[] {
  if (!files || !Array.isArray(files)) return [];
  return files.map((file) => file.path.replace(/\\/g, '/'));
}

function getTeacherScopeId(req: Request): number | null {
  const user = (req as any).user;
  if (user.role === 'teacher') return user.id;

  return (
    parseNumberInput(req.body?.teacher_id) ??
    parseNumberInput(req.body?.teacherId) ??
    parseNumberInput(req.query.teacher_id as string | undefined) ??
    parseNumberInput(req.query.teacherId as string | undefined) ??
    null
  );
}

function parseCourseScopeFilter(req: Request): number | null | undefined {
  const scope = req.query.scope as string | undefined;
  if (scope === 'teacher') return null;
  const courseId = parseNumberInput(req.query.courseId as string | undefined);
  return courseId ?? undefined;
}

/**
 * Upload teacher-level content file (Teacher/Admin)
 * POST /files
 */
router.post(
  '/files',
  authMiddleware(['teacher', 'admin']),
  upload.single('file'),
  async (req: Request, res: Response) => {
    try {
      const teacherId = getTeacherScopeId(req);

      if (!teacherId) {
        await cleanupUploadedFile(req.file);
        return res.status(400).json({ error: 'teacher_id is required for admin uploads' });
      }

      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      const hasCourses = await ScientificChatbotService.teacherHasAnyCourse(teacherId);
      if (!hasCourses) {
        await cleanupUploadedFile(req.file);
        return res.status(400).json({ error: 'Teacher does not have any courses' });
      }

      let contentText: string;
      try {
        if (req.file.mimetype === 'application/pdf') {
          const ocrResult = await MistralOcrService.extractTextFromFile(req.file);
          contentText = ocrResult.text;
        } else {
          contentText = await readUploadedContent(req.file);
        }
      } catch (readError: any) {
        await cleanupUploadedFile(req.file);
        return res.status(400).json({ error: readError.message || 'Could not read file content' });
      }

      const result = await ScientificChatbotService.uploadTeacherFile(
        teacherId,
        req.file.originalname,
        req.file.path,
        req.file.size,
        req.file.mimetype,
        contentText,
      );

      const { embeddingUnavailable, ...file } = result;

      res.status(201).json({
        message: embeddingUnavailable
          ? 'File saved. Embeddings could not be generated (embedding service unavailable). Use "Reset embeddings" when the service is back.'
          : 'File uploaded and processed successfully',
        file,
        ...(embeddingUnavailable && {
          warning:
            'Embedding service (OpenAI) was unavailable. File is stored; run "Reset embeddings" when the service is available.',
        }),
      });
    } catch (error: any) {
      logger.error('Error uploading teacher-level file:', error);
      await cleanupUploadedFile(req.file);
      res.status(500).json({ error: error.message || 'Error uploading file' });
    }
  },
);

/**
 * List teacher-level content files (Teacher/Admin)
 * GET /files
 */
router.get('/files', authMiddleware(['teacher', 'admin']), async (req: Request, res: Response) => {
  try {
    const teacherId = getTeacherScopeId(req);

    if (!teacherId) {
      return res.status(400).json({ error: 'teacher_id is required for admin requests' });
    }

    const files = await ScientificChatbotService.listTeacherFiles(teacherId);
    res.json({ files });
  } catch (error: any) {
    logger.error('Error listing teacher files:', error);
    res.status(500).json({ error: error.message || 'Error listing files' });
  }
});

/**
 * Reset teacher-level embeddings (Teacher/Admin)
 * POST /reset-embeddings
 */
router.post(
  '/reset-embeddings',
  authMiddleware(['teacher', 'admin']),
  async (req: Request, res: Response) => {
    try {
      const teacherId = getTeacherScopeId(req);

      if (!teacherId) {
        return res.status(400).json({ error: 'teacher_id is required for admin requests' });
      }

      await ScientificChatbotService.resetTeacherEmbeddings(teacherId);

      res.json({
        message: 'Embeddings reset successfully',
      });
    } catch (error: any) {
      logger.error('Error resetting teacher embeddings:', error);
      res.status(500).json({ error: error.message || 'Error resetting embeddings' });
    }
  },
);

/**
 * List student AI chat threads for teacher review
 * GET /teacher/student-chats
 */
router.get(
  '/teacher/student-chats',
  authMiddleware(['teacher', 'admin']),
  async (req: Request, res: Response) => {
    try {
      const teacherId = getTeacherScopeId(req);
      if (!teacherId) {
        return res.status(400).json({ error: 'teacher_id is required for admin requests' });
      }

      const courseScope = parseCourseScopeFilter(req);
      const studentId = parseNumberInput(req.query.studentId as string | undefined) ?? undefined;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 30;
      const offset = req.query.offset ? parseInt(req.query.offset as string) : 0;

      const chats = await ScientificChatbotService.listTeacherStudentChats(teacherId, {
        courseId: courseScope,
        studentId,
        limit,
        offset,
      });

      res.json({ chats });
    } catch (error: any) {
      logger.error('Error listing teacher student chats:', error);
      res.status(500).json({ error: error.message || 'Error listing student chats' });
    }
  },
);

/**
 * Get student AI chat messages for teacher review
 * GET /teacher/student-chats/:studentId/messages
 */
router.get(
  '/teacher/student-chats/:studentId/messages',
  authMiddleware(['teacher', 'admin']),
  async (req: Request, res: Response) => {
    try {
      const teacherId = getTeacherScopeId(req);
      const studentId = parseNumberInput(req.params.studentId);

      if (!teacherId) {
        return res.status(400).json({ error: 'teacher_id is required for admin requests' });
      }
      if (!studentId) {
        return res.status(400).json({ error: 'Invalid student id' });
      }

      const courseScope = parseCourseScopeFilter(req);
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
      const beforeId = req.query.beforeId ? parseInt(req.query.beforeId as string) : undefined;

      const messages = await ScientificChatbotService.getTeacherViewStudentChatHistory(
        teacherId,
        studentId,
        {
          courseId: courseScope,
          limit,
          beforeId,
        },
      );

      res.json({ messages });
    } catch (error: any) {
      logger.error('Error getting teacher student chat messages:', error);
      if (error.message === 'Access denied') {
        return res.status(403).json({ error: 'Access denied' });
      }
      res.status(500).json({ error: error.message || 'Error getting student chat messages' });
    }
  },
);

/**
 * Ask a question across all content uploaded by a teacher (Student only)
 * POST /teachers/:teacherId/ask
 */
router.post(
  '/teachers/:teacherId/ask',
  authMiddleware(['student']),
  uploadChat.array('images', 5),
  async (req: Request, res: Response) => {
    try {
      const teacherId = parseNumberInput(req.params.teacherId);
      const studentId = (req as any).user.id;
      const { question } = req.body;

      if (!teacherId) {
        await cleanupChatFiles(req.files as Express.Multer.File[] | undefined);
        return res.status(400).json({ error: 'Invalid teacher id' });
      }

      if (!question || typeof question !== 'string' || question.trim().length === 0) {
        await cleanupChatFiles(req.files as Express.Multer.File[] | undefined);
        return res.status(400).json({ error: 'Question is required' });
      }

      const hasSubscription = await ScientificChatbotService.studentHasTeacherSubscription(
        studentId,
        teacherId,
      );
      if (!hasSubscription) {
        await cleanupChatFiles(req.files as Express.Multer.File[] | undefined);
        return res.status(403).json({
          error: 'You must be subscribed to at least one course with this teacher.',
        });
      }

      if (!(await assertTeacherScientificSupportForStudent(res, teacherId))) {
        await cleanupChatFiles(req.files as Express.Multer.File[] | undefined);
        return;
      }

      const hasContent = await ScientificChatbotService.teacherHasContent(teacherId);
      if (!hasContent) {
        await cleanupChatFiles(req.files as Express.Multer.File[] | undefined);
        return res.status(404).json({
          error:
            'This teacher does not have uploaded content yet. Please ask your teacher to upload course materials.',
        });
      }

      const result = await ScientificChatbotService.answerTeacherQuestion(
        studentId,
        teacherId,
        question.trim(),
        getChatImagePaths(req.files as Express.Multer.File[] | undefined),
      );

      res.json({
        answer: result.answer,
        retrieved_chunks: result.retrievedChunks,
      });
    } catch (error: any) {
      logger.error('Error answering teacher question:', error);
      await cleanupChatFiles(req.files as Express.Multer.File[] | undefined);
      const msg = error?.message ?? '';
      const isServiceUnavailable =
        msg.includes('OpenAI Embedding API error') ||
        msg.includes('OPENAI_API_KEY') ||
        msg.includes('502') ||
        msg.includes('503') ||
        msg.includes('Bad Gateway') ||
        msg.includes('UNAVAILABLE');
      if (isServiceUnavailable) {
        return res.status(503).json({
          error: 'Answer service is temporarily unavailable. Please try again later.',
        });
      }
      res.status(500).json({ error: error.message || 'Error answering question' });
    }
  },
);

/**
 * Get teacher-scoped chat history (Student only)
 * GET /teachers/:teacherId/history
 */
router.get(
  '/teachers/:teacherId/history',
  authMiddleware(['student']),
  async (req: Request, res: Response) => {
    try {
      const teacherId = parseNumberInput(req.params.teacherId);
      const studentId = (req as any).user.id;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
      const beforeId = req.query.beforeId ? parseInt(req.query.beforeId as string) : undefined;

      if (!teacherId) {
        return res.status(400).json({ error: 'Invalid teacher id' });
      }

      const hasSubscription = await ScientificChatbotService.studentHasTeacherSubscription(
        studentId,
        teacherId,
      );
      if (!hasSubscription) {
        return res.status(403).json({
          error: 'You must be subscribed to at least one course with this teacher.',
        });
      }

      if (!(await assertTeacherScientificSupportForStudent(res, teacherId))) {
        return;
      }

      const history = await ScientificChatbotService.getTeacherChatHistory(
        studentId,
        teacherId,
        limit,
        beforeId,
      );

      res.json({ history });
    } catch (error: any) {
      logger.error('Error getting teacher chat history:', error);
      res.status(500).json({ error: error.message || 'Error getting chat history' });
    }
  },
);

/**
 * Upload course content file (Teacher only)
 * POST /courses/:courseId/files
 */
router.post(
  '/courses/:courseId/files',
  authMiddleware(['teacher', 'admin']),
  upload.single('file'),
  async (req: Request, res: Response) => {
    try {
      const courseId = parseNumberInput(req.params.courseId)!;
      const teacherId = (req as any).user.id;
      const userRole = (req as any).user.role;

      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      // Verify course exists
      const courseResult = await pool.query('SELECT * FROM courses WHERE id = $1', [courseId]);
      if (courseResult.rows.length === 0) {
        // Clean up uploaded file
        if (req.file?.path) {
          await fs.promises.unlink(req.file.path).catch(() => {});
        }
        return res.status(404).json({ error: 'Course not found' });
      }

      const course = courseResult.rows[0];

      // Verify course ownership
      if (userRole === 'teacher') {
        if (course.teacher_id !== teacherId) {
          // Clean up uploaded file
          await fs.promises.unlink(req.file.path).catch(() => {});
          return res
            .status(403)
            .json({ error: 'You do not have permission to upload files for this course' });
        }
      }

      // Read file content
      let contentText: string;
      try {
        if (req.file.mimetype === 'application/pdf') {
          const ocrResult = await MistralOcrService.extractTextFromFile(req.file);
          contentText = ocrResult.text;
        } else {
          contentText = await fs.promises.readFile(req.file.path, 'utf-8');
        }
      } catch (readError: any) {
        await fs.promises.unlink(req.file.path).catch(() => {});
        return res.status(400).json({ error: readError.message || 'Could not read file content' });
      }

      // Upload and process
      const result = await ScientificChatbotService.uploadCourseFile(
        courseId,
        teacherId,
        req.file.originalname,
        req.file.path,
        req.file.size,
        req.file.mimetype,
        contentText,
      );

      const { embeddingUnavailable, ...file } = result;

      res.status(201).json({
        message: embeddingUnavailable
          ? 'File saved. Embeddings could not be generated (embedding service unavailable). Use "Reset embeddings" for this course when the service is back.'
          : 'File uploaded and processed successfully',
        file,
        ...(embeddingUnavailable && {
          warning:
            'Embedding service (OpenAI) was unavailable. File is stored; run "Reset embeddings" when the service is available.',
        }),
      });
    } catch (error: any) {
      logger.error('Error uploading course file:', error);
      // Clean up file if it exists
      if (req.file?.path) {
        await fs.promises.unlink(req.file.path).catch(() => {});
      }
      res.status(500).json({ error: error.message || 'Error uploading file' });
    }
  },
);

/**
 * List course content files (Teacher only)
 * GET /courses/:courseId/files
 */
router.get(
  '/courses/:courseId/files',
  authMiddleware(['teacher', 'admin']),
  async (req: Request, res: Response) => {
    try {
      const courseId = parseNumberInput(req.params.courseId)!;
      const teacherId = (req as any).user.id;
      const userRole = (req as any).user.role;

      // Verify course exists
      const courseResult = await pool.query('SELECT * FROM courses WHERE id = $1', [courseId]);
      if (courseResult.rows.length === 0) {
        return res.status(404).json({ error: 'Course not found' });
      }

      const course = courseResult.rows[0];

      // Verify course ownership
      if (userRole === 'teacher') {
        if (course.teacher_id !== teacherId) {
          return res
            .status(403)
            .json({ error: 'You do not have permission to view files for this course' });
        }
      }

      const files = await ScientificChatbotService.listCourseFiles(
        courseId,
        userRole === 'admin' ? undefined : teacherId,
      );

      res.json({ files });
    } catch (error: any) {
      logger.error('Error listing course files:', error);
      res.status(500).json({ error: error.message || 'Error listing files' });
    }
  },
);

/**
 * Reset course embeddings (delete and regenerate)
 * POST /courses/:courseId/reset-embeddings
 */
router.post(
  '/courses/:courseId/reset-embeddings',
  authMiddleware(['teacher', 'admin']),
  async (req: Request, res: Response) => {
    try {
      const courseId = parseNumberInput(req.params.courseId)!;
      const teacherId = (req as any).user.id;
      const userRole = (req as any).user.role;

      // Verify course exists
      const courseResult = await pool.query('SELECT * FROM courses WHERE id = $1', [courseId]);
      if (courseResult.rows.length === 0) {
        return res.status(404).json({ error: 'Course not found' });
      }

      const course = courseResult.rows[0];

      // Verify course ownership
      if (userRole === 'teacher') {
        if (course.teacher_id !== teacherId) {
          return res
            .status(403)
            .json({ error: 'You do not have permission to reset embeddings for this course' });
        }
      }

      await ScientificChatbotService.resetCourseEmbeddings(courseId, teacherId);

      res.json({
        message: 'Embeddings reset successfully',
      });
    } catch (error: any) {
      logger.error('Error resetting embeddings:', error);
      res.status(500).json({ error: error.message || 'Error resetting embeddings' });
    }
  },
);

/**
 * Delete course content file
 * DELETE /files/:fileId
 */
router.delete(
  '/files/:fileId',
  authMiddleware(['teacher', 'admin']),
  async (req: Request, res: Response) => {
    try {
      const fileId = parseNumberInput(req.params.fileId)!;
      const teacherId = (req as any).user.id;

      const result = await ScientificChatbotService.deleteCourseFile(fileId, teacherId);

      res.json({
        message: 'File deleted successfully',
        ...(result.milvusUnavailable && {
          warning:
            'Vector index (Milvus) was unavailable. File removed from the course. When Milvus is running, use "Reset embeddings" for this course to sync the index.',
        }),
      });
    } catch (error: any) {
      logger.error('Error deleting file:', error);
      res.status(500).json({ error: error.message || 'Error deleting file' });
    }
  },
);

/**
 * Ask a question (Student only)
 * POST /courses/:courseId/ask
 */
router.post(
  '/courses/:courseId/ask',
  authMiddleware(['student']),
  uploadChat.array('images', 5),
  async (req: Request, res: Response) => {
    try {
      const courseId = parseNumberInput(req.params.courseId)!;
      const studentId = (req as any).user.id;
      // const studentId = 1
      const { question } = req.body;

      if (!question || typeof question !== 'string' || question.trim().length === 0) {
        return res.status(400).json({ error: 'Question is required' });
      }

      const enrollmentResult = await pool.query(
        `SELECT 1 FROM enrollments WHERE user_id = $1 AND course_id = $2 LIMIT 1`,
        [studentId, courseId],
      );
      if ((enrollmentResult.rowCount ?? 0) === 0) {
        if (req.files && Array.isArray(req.files)) {
          for (const file of req.files) {
            await fs.promises.unlink(file.path).catch(() => {});
          }
        }
        return res.status(403).json({
          error: 'You must be subscribed to this course to ask about its content.',
        });
      }

      const courseTeacherRes = await pool.query<{ teacher_id: number }>(
        `SELECT teacher_id FROM courses WHERE id = $1 LIMIT 1`,
        [courseId],
      );
      const courseTeacherId = courseTeacherRes.rows[0]?.teacher_id;
      if (
        courseTeacherId &&
        !(await assertTeacherScientificSupportForStudent(res, courseTeacherId))
      ) {
        if (req.files && Array.isArray(req.files)) {
          for (const file of req.files) {
            await fs.promises.unlink(file.path).catch(() => {});
          }
        }
        return;
      }

      // Check if course has content
      const hasContent = await ScientificChatbotService.courseHasContent(courseId);
      if (!hasContent) {
        if (req.files && Array.isArray(req.files)) {
          for (const file of req.files) {
            await fs.promises.unlink(file.path).catch(() => {});
          }
        }
        return res.status(404).json({
          error:
            'This course does not have uploaded content yet. Please ask your teacher to upload materials in the scientific chatbot.',
        });
      }

      const images: string[] = [];
      if (req.files && Array.isArray(req.files)) {
        req.files.forEach((file) => {
          images.push(file.path.replace(/\\/g, '/'));
        });
      }

      // Get answer
      const result = await ScientificChatbotService.answerQuestion(
        studentId,
        courseId,
        question.trim(),
        images,
      );

      res.json({
        answer: result.answer,
        retrieved_chunks: result.retrievedChunks,
      });
    } catch (error: any) {
      logger.error('Error answering question:', error);
      if (req.files && Array.isArray(req.files)) {
        for (const file of req.files) {
          await fs.promises.unlink(file.path).catch(() => {});
        }
      }
      const msg = error?.message ?? '';
      const isServiceUnavailable =
        msg.includes('OpenAI Embedding API error') ||
        msg.includes('OPENAI_API_KEY') ||
        msg.includes('502') ||
        msg.includes('503') ||
        msg.includes('Bad Gateway') ||
        msg.includes('UNAVAILABLE');
      if (isServiceUnavailable) {
        return res.status(503).json({
          error: 'Answer service is temporarily unavailable. Please try again later.',
        });
      }
      res.status(500).json({ error: error.message || 'Error answering question' });
    }
  },
);

/**
 * Get chat history (Student only)
 * GET /courses/:courseId/history
 */
router.get(
  '/courses/:courseId/history',
  authMiddleware(['student']),
  async (req: Request, res: Response) => {
    try {
      const courseId = parseNumberInput(req.params.courseId)!;
      const studentId = (req as any).user.id;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
      const beforeId = req.query.beforeId ? parseInt(req.query.beforeId as string) : undefined;

      const courseTeacherRes = await pool.query<{ teacher_id: number }>(
        `SELECT teacher_id FROM courses WHERE id = $1 LIMIT 1`,
        [courseId],
      );
      const courseTeacherId = courseTeacherRes.rows[0]?.teacher_id;
      if (
        courseTeacherId &&
        !(await assertTeacherScientificSupportForStudent(res, courseTeacherId))
      ) {
        return;
      }

      const history = await ScientificChatbotService.getChatHistory(
        studentId,
        courseId,
        limit,
        beforeId,
      );

      res.json({ history });
    } catch (error: any) {
      logger.error('Error getting chat history:', error);
      res.status(500).json({ error: error.message || 'Error getting chat history' });
    }
  },
);

export { router };
