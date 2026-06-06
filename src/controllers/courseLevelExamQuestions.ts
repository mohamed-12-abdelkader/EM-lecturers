import { Router, Request, Response } from 'express';
import { checkPermission } from '../middleware/permissions';
import { authMiddleware } from '../middleware/authentication';
import { asyncWrapper, uploadToCloudinary } from '../utils';
import { CourseLevelExamQuestionsService } from '../services/courseLevelExamQuestions';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

export const router = Router();

// Configure multer for image uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = 'uploads';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, 'exam-question-' + uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  },
});

// Note: Routes for creating questions (POST /api/exams/:examId/questions) are in exams.ts
// This router only handles question management (update, delete, set correct answer, get single question)

/**
 * PUT /api/questions/:questionId
 * Update a question
 */
router.put(
  '/:questionId',
  authMiddleware(['teacher', 'admin', 'employee']), checkPermission('question_bank_management'),
  upload.single('questionImage'),
  asyncWrapper(async (req: Request, res: Response) => {
    const questionId = Number(req.params.questionId);
    if (Number.isNaN(questionId)) {
      return res.status(400).json({ message: 'Invalid question id' });
    }

    const { questionText, optionA, optionB, optionC, optionD } = req.body;

    const updateData: any = {};

    if (questionText !== undefined) {
      updateData.questionText = questionText.trim();
    }

    if (optionA !== undefined) {
      updateData.optionA = optionA.trim();
    }
    if (optionB !== undefined) {
      updateData.optionB = optionB.trim();
    }
    if (optionC !== undefined) {
      updateData.optionC = optionC.trim();
    }
    if (optionD !== undefined) {
      updateData.optionD = optionD.trim();
    }

    // Handle image upload if provided
    if (req.file) {
      try {
        const uploaded = await uploadToCloudinary(req.file.path);
        updateData.questionImage = uploaded.secure_url;
      } catch (error) {
        console.error('Error uploading image:', error);
        return res.status(500).json({ message: 'Failed to upload image' });
      }
    } else if (req.body.questionImage === null || req.body.questionImage === 'null') {
      // Allow explicitly setting image to null
      updateData.questionImage = null;
    }

    try {
      const question = await CourseLevelExamQuestionsService.updateQuestion(
        req.user!,
        questionId,
        updateData,
      );

      res.json({ question });
    } catch (error: any) {
      if (error.status) {
        return res.status(error.status).json({ message: error.message });
      }
      console.error('Error updating question:', error);
      res.status(500).json({ message: 'Failed to update question' });
    }
  }),
);

/**
 * DELETE /api/questions/:questionId
 * Delete a question
 */
router.delete(
  '/:questionId',
  authMiddleware(['teacher', 'admin', 'employee']), checkPermission('question_bank_management'),
  asyncWrapper(async (req: Request, res: Response) => {
    const questionId = Number(req.params.questionId);
    if (Number.isNaN(questionId)) {
      return res.status(400).json({ message: 'Invalid question id' });
    }

    try {
      const result = await CourseLevelExamQuestionsService.deleteQuestion(req.user!, questionId);
      res.json(result);
    } catch (error: any) {
      if (error.status) {
        return res.status(error.status).json({ message: error.message });
      }
      console.error('Error deleting question:', error);
      res.status(500).json({ message: 'Failed to delete question' });
    }
  }),
);

/**
 * PATCH /api/questions/:questionId/correct-answer
 * Set/Update correct answer
 */
router.patch(
  '/:questionId/correct-answer',
  authMiddleware(['teacher', 'admin', 'employee']), checkPermission('question_bank_management'),
  asyncWrapper(async (req: Request, res: Response) => {
    const questionId = Number(req.params.questionId);
    if (Number.isNaN(questionId)) {
      return res.status(400).json({ message: 'Invalid question id' });
    }

    const { correctAnswer } = req.body;

    if (!correctAnswer) {
      return res.status(400).json({ message: 'correctAnswer is required' });
    }

    if (!['A', 'B', 'C', 'D'].includes(correctAnswer)) {
      return res.status(400).json({ message: 'correctAnswer must be one of A, B, C, or D' });
    }

    try {
      const question = await CourseLevelExamQuestionsService.setCorrectAnswer(
        req.user!,
        questionId,
        correctAnswer as 'A' | 'B' | 'C' | 'D',
      );

      res.json({ question });
    } catch (error: any) {
      if (error.status) {
        return res.status(error.status).json({ message: error.message });
      }
      console.error('Error setting correct answer:', error);
      res.status(500).json({ message: 'Failed to set correct answer' });
    }
  }),
);

/**
 * GET /api/questions/:questionId
 * Get a single question by ID
 */
router.get(
  '/:questionId',
  authMiddleware(['teacher', 'admin', 'employee']), checkPermission('question_bank_management'),
  asyncWrapper(async (req: Request, res: Response) => {
    const questionId = Number(req.params.questionId);
    if (Number.isNaN(questionId)) {
      return res.status(400).json({ message: 'Invalid question id' });
    }

    try {
      const question = await CourseLevelExamQuestionsService.getQuestionById(questionId, req.user!);
      res.json({ question });
    } catch (error: any) {
      if (error.status) {
        return res.status(error.status).json({ message: error.message });
      }
      console.error('Error fetching question:', error);
      res.status(500).json({ message: 'Failed to fetch question' });
    }
  }),
);
