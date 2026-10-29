import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { authMiddleware } from '../middleware/authentication';
import { COURSE_CONTENT_ROLES } from '../services/courseAccessControl';
import { asyncWrapper, HttpError, uploadToCloudinary } from '../utils';
import pool from '../db/pool';
import { CourseLevelExamsService } from '../services/courseLevelExams';
import { CourseLevelExamQuestionsService } from '../services/courseLevelExamQuestions';
import { TeacherLibraryExamQuestionsService } from '../services/teacherLibraryExamQuestions';
import {
  parseBooleanInput,
  parseDateInput,
  parseNumberInput,
  pickBodyValue,
} from '../utils/requestParsers';
import { normalizeQuestionDisplayMode } from '../services/examQuestionSelection';

export const router = Router();

const questionImageUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      const uploadDir = 'uploads';
      if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
      cb(null, uploadDir);
    },
    filename: (_req, file, cb) => {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
      cb(null, 'public-exam-question-' + uniqueSuffix + path.extname(file.originalname));
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp/;
    if (allowed.test(path.extname(file.originalname).toLowerCase()) && allowed.test(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  },
}).fields([
  { name: 'questionImage', maxCount: 1 },
  { name: 'question_image', maxCount: 1 },
  { name: 'image', maxCount: 1 },
]);

function firstUploadedImage(req: { files?: unknown }): Express.Multer.File | undefined {
  const files = req.files as Record<string, Express.Multer.File[]> | undefined;
  return files?.questionImage?.[0] || files?.question_image?.[0] || files?.image?.[0];
}

function mapPublicExamQuestion(row: any) {
  const questionImage = row.question_image ?? row.questionImage ?? null;
  return {
    ...row,
    questionImage,
    question_image: questionImage,
    questionText: row.question_text,
    optionA: row.option_a,
    optionB: row.option_b,
    optionC: row.option_c,
    optionD: row.option_d,
    correctAnswer: row.correct_answer,
    correctAnswer2: row.correct_answer_2 ?? null,
  };
}

function optionalTrimmed(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  return String(value).trim();
}

function imageValueFromBody(body: Record<string, unknown>): string | null | undefined {
  const raw = body.questionImage ?? body.question_image;
  if (raw === undefined) return undefined;
  if (raw === null || raw === 'null' || raw === '') return null;
  const text = String(raw).trim();
  if (!text || text === 'undefined') return undefined;
  return text;
}

function parseTeacherLibraryBody(body: Record<string, unknown>) {
  const questionIds = Array.isArray(body.questionIds)
    ? body.questionIds.map((id) => Number(id)).filter((n) => Number.isInteger(n) && n > 0)
    : [];
  const gradeId = body.gradeId != null ? Number(body.gradeId) : null;
  const lessonId = body.lessonId != null ? Number(body.lessonId) : null;
  const passageId = body.passageId != null ? Number(body.passageId) : null;
  return { questionIds, gradeId, lessonId, passageId };
}

async function resolveTeacherLibraryQuestionIds(
  teacherId: number,
  body: Record<string, unknown>,
): Promise<number[]> {
  const { questionIds, gradeId, lessonId, passageId } = parseTeacherLibraryBody(body);

  if (lessonId != null && Number.isInteger(lessonId) && lessonId > 0) {
    return TeacherLibraryExamQuestionsService.fetchLessonQuestionIds(teacherId, lessonId);
  }
  if (passageId != null && Number.isInteger(passageId) && passageId > 0) {
    return TeacherLibraryExamQuestionsService.fetchPassageQuestionIds(teacherId, passageId);
  }
  if (gradeId != null && Number.isInteger(gradeId) && gradeId > 0) {
    return TeacherLibraryExamQuestionsService.fetchGradeQuestionIds(teacherId, gradeId);
  }
  return questionIds;
}

const parseTimestampOrNull = (value: any, field: string): Date | null => {
  const parsed = parseDateInput(value);
  if (parsed === undefined || parsed === null) return null;
  const date = new Date(parsed);
  if (Number.isNaN(date.getTime())) {
    throw new HttpError(400, `${field} must be a valid ISO date`);
  }
  return date;
};

const parseRequiredPositiveNumber = (value: any, field: string): number => {
  const parsed = parseNumberInput(value);
  if (parsed === undefined || parsed === null) {
    throw new HttpError(400, `${field} is required`);
  }
  const numericValue = Number(parsed);
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    throw new HttpError(400, `${field} must be greater than 0`);
  }
  return numericValue;
};

const parseOptionalDurationMinutes = (value: any, field: string): number | null => {
  if (value === undefined || value === null || value === '' || value === 'null') {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new HttpError(400, `${field} must be greater than 0, or 0/null for unlimited`);
  }
  const minutes = Math.trunc(parsed);
  return minutes > 0 ? minutes : null;
};

const parseAttemptLimit = (raw: any): number | null | undefined => {
  if (raw === undefined) return undefined;
  if (raw === null || raw === 'null' || raw === '') return null;
  const parsed = parseNumberInput(raw);
  if (parsed === undefined || parsed === null) return undefined;
  const numValue = Number(parsed);
  if (!Number.isInteger(numValue) || numValue <= 0) {
    throw new HttpError(400, 'attemptLimit must be a positive integer');
  }
  return numValue;
};

async function assertPublicExam(examId: number, requester: { id: number; role: string }) {
  const exam = await CourseLevelExamsService.getExamById(examId, requester);
  if (String(exam.exam_scope || 'course') !== 'public') {
    throw new HttpError(404, 'Public exam not found');
  }
  return exam;
}

function parseExamSettingsFromBody(body: any) {
  const titleInput = typeof body.title === 'string' ? body.title.trim() : '';
  const descriptionRaw = pickBodyValue(body, 'description');
  const description =
    descriptionRaw === undefined || descriptionRaw === null
      ? undefined
      : String(descriptionRaw).trim() || null;

  const durationMinutes = parseOptionalDurationMinutes(
    pickBodyValue(body, 'durationMinutes', 'duration_minutes'),
    'durationMinutes',
  );
  const questionsCount = parseRequiredPositiveNumber(
    pickBodyValue(body, 'questionsCount', 'questions_count'),
    'questionsCount',
  );

  const isVisibleInput = parseBooleanInput(
    pickBodyValue(body, 'isVisibleToStudents', 'is_visible_to_students'),
  );
  const isVisibleToStudents = isVisibleInput ?? false; // draft by default for public
  const visibilityEndDate = parseTimestampOrNull(
    pickBodyValue(body, 'visibilityEndDate', 'visibility_end_date'),
    'visibilityEndDate',
  );
  const availableFrom = parseTimestampOrNull(
    pickBodyValue(body, 'availableFrom', 'available_from', 'showAt', 'show_at'),
    'availableFrom',
  );

  const answersReleaseModeRaw = pickBodyValue(
    body,
    'answersReleaseMode',
    'answers_release_mode',
  );
  const showAnswersInput = parseBooleanInput(
    pickBodyValue(body, 'showAnswersImmediately', 'show_answers_immediately'),
  );
  const answersVisibleAt = parseTimestampOrNull(
    pickBodyValue(body, 'answersVisibleAt', 'answers_visible_at'),
    'answersVisibleAt',
  );
  const showAnswersAfterHoursRaw = pickBodyValue(
    body,
    'showAnswersAfterHours',
    'show_answers_after_hours',
  );
  const showAnswersAfterHours =
    showAnswersAfterHoursRaw === undefined || showAnswersAfterHoursRaw === null
      ? null
      : Number(showAnswersAfterHoursRaw);
  const questionDisplayMode = pickBodyValue(
    body,
    'questionDisplayMode',
    'question_display_mode',
  );
  const showAnswersImmediately =
    showAnswersInput ??
    (answersReleaseModeRaw
      ? String(answersReleaseModeRaw).toLowerCase() === 'immediate'
      : true);

  const isActiveInput = parseBooleanInput(pickBodyValue(body, 'isActive', 'is_active'));
  const isActive = isActiveInput ?? true;
  const attemptLimit = parseAttemptLimit(
    pickBodyValue(body, 'attemptLimit', 'attempt_limit'),
  );

  return {
    titleInput,
    description,
    durationMinutes,
    questionsCount,
    isVisibleToStudents,
    visibilityEndDate,
    availableFrom,
    showAnswersImmediately,
    answersVisibleAt,
    answersReleaseModeRaw,
    showAnswersAfterHours,
    questionDisplayMode,
    isActive,
    attemptLimit,
  };
}

// ─── Teacher / admin ───────────────────────────────────────

router.post(
  '/',
  authMiddleware(COURSE_CONTENT_ROLES),
  asyncWrapper(async (req, res) => {
    const settings = parseExamSettingsFromBody(req.body);
    if (!settings.titleInput) {
      throw new HttpError(400, 'title is required');
    }

    const gradeIdParsed = parseNumberInput(
      pickBodyValue(req.body, 'gradeId', 'grade_id'),
    );
    const gradeId = Number(gradeIdParsed);
    if (!Number.isInteger(gradeId) || gradeId <= 0) {
      throw new HttpError(400, 'gradeId is required');
    }

    const exam = await CourseLevelExamsService.createExam(req.user!, {
      title: settings.titleInput,
      examScope: 'public',
      gradeId,
      description: settings.description ?? null,
      durationMinutes: settings.durationMinutes,
      questionsCount: settings.questionsCount,
      isVisibleToStudents: settings.isVisibleToStudents,
      visibilityEndDate: settings.visibilityEndDate,
      availableFrom: settings.availableFrom,
      showAnswersImmediately: settings.showAnswersImmediately,
      answersVisibleAt: settings.answersVisibleAt,
      answersReleaseMode: settings.answersReleaseModeRaw,
      showAnswersAfterHours: settings.showAnswersAfterHours,
      isActive: settings.isActive,
      attemptLimit: settings.attemptLimit,
      questionDisplayMode: normalizeQuestionDisplayMode(settings.questionDisplayMode),
    });

    res.status(201).json({ success: true, exam });
  }),
);

router.get(
  '/teacher',
  authMiddleware(COURSE_CONTENT_ROLES),
  asyncWrapper(async (req, res) => {
    const gradeId = req.query.gradeId
      ? Number(req.query.gradeId)
      : req.query.grade_id
        ? Number(req.query.grade_id)
        : undefined;
    const exams = await CourseLevelExamsService.getPublicExamsByTeacher(req.user!.id, {
      gradeId:
        gradeId != null && Number.isInteger(gradeId) && gradeId > 0 ? gradeId : undefined,
    });
    res.json({ success: true, exams });
  }),
);

router.get(
  '/student',
  authMiddleware(['student']),
  asyncWrapper(async (req, res) => {
    const exams = await CourseLevelExamsService.getVisiblePublicExamsForStudent(req.user!.id);
    res.json({ success: true, exams });
  }),
);

router.post(
  '/:examId/late-access',
  authMiddleware(COURSE_CONTENT_ROLES),
  asyncWrapper(async (req, res) => {
    const examId = Number(req.params.examId);
    const studentCode = pickBodyValue(req.body ?? {}, 'studentCode', 'student_code');
    const studentIdRaw = pickBodyValue(req.body ?? {}, 'studentId', 'student_id');
    const studentId = studentIdRaw == null || studentIdRaw === '' ? null : Number(studentIdRaw);
    const extraRaw = pickBodyValue(req.body ?? {}, 'extraAttempts', 'extra_attempts');
    const extraAttempts = extraRaw == null || extraRaw === '' ? 1 : Number(extraRaw);
    const note = pickBodyValue(req.body ?? {}, 'note');
    if (!Number.isInteger(examId) || examId <= 0) {
      throw new HttpError(400, 'examId غير صالح');
    }
    if ((studentCode == null || String(studentCode).trim() === '') && !(Number(studentId) > 0)) {
      throw new HttpError(400, 'كود الطالب مطلوب');
    }
    await assertPublicExam(examId, req.user!);
    const data = await CourseLevelExamsService.grantLateAccess({
      examId,
      studentCode: studentCode == null ? null : String(studentCode),
      studentId,
      requester: req.user!,
      extraAttempts,
      note: note == null ? null : String(note),
    });
    res.json({
      success: true,
      message: 'تم السماح للطالب بمحاولة إضافية حتى بعد انتهاء وقت الامتحان',
      data,
    });
  }),
);

router.get(
  '/:examId/late-access',
  authMiddleware(COURSE_CONTENT_ROLES),
  asyncWrapper(async (req, res) => {
    const examId = Number(req.params.examId);
    if (!Number.isInteger(examId) || examId <= 0) throw new HttpError(400, 'examId غير صالح');
    await assertPublicExam(examId, req.user!);
    const data = await CourseLevelExamsService.listLateAccess(examId, req.user!);
    res.json({ success: true, data });
  }),
);

router.delete(
  '/:examId/late-access/:studentCode',
  authMiddleware(COURSE_CONTENT_ROLES),
  asyncWrapper(async (req, res) => {
    const examId = Number(req.params.examId);
    const studentCode = String(req.params.studentCode || '').trim();
    if (!Number.isInteger(examId) || examId <= 0 || !studentCode) {
      throw new HttpError(400, 'examId وكود الطالب مطلوبان');
    }
    await assertPublicExam(examId, req.user!);
    const data = await CourseLevelExamsService.revokeLateAccess(examId, req.user!, {
      studentCode,
    });
    res.json({ success: true, message: 'تم إلغاء السماح', data });
  }),
);

router.get(
  '/:examId',
  authMiddleware([...COURSE_CONTENT_ROLES, 'student']),
  asyncWrapper(async (req, res) => {
    const examId = Number(req.params.examId);
    if (!Number.isInteger(examId) || examId <= 0) {
      throw new HttpError(400, 'Invalid exam id');
    }

    if (req.user!.role === 'student') {
      const list = await CourseLevelExamsService.getVisiblePublicExamsForStudent(req.user!.id);
      const exam = list.find((e: any) => Number(e.id) === examId);
      if (!exam) {
        // Still allow fetching if student has grade access even when not listed (e.g. ended)
        const row = await CourseLevelExamsService.getExamById(examId, req.user!);
        if (String(row.exam_scope || '') !== 'public') {
          throw new HttpError(404, 'Public exam not found');
        }
        await CourseLevelExamsService.assertStudentCanAccessExam(row, req.user!.id);
        return res.json({ success: true, exam: row });
      }
      return res.json({ success: true, exam });
    }

    const exam = await assertPublicExam(examId, req.user!);
    res.json({ success: true, exam });
  }),
);

router.patch(
  '/:examId',
  authMiddleware(COURSE_CONTENT_ROLES),
  asyncWrapper(async (req, res) => {
    const examId = Number(req.params.examId);
    if (!Number.isInteger(examId) || examId <= 0) {
      throw new HttpError(400, 'Invalid exam id');
    }
    await assertPublicExam(examId, req.user!);

    const updateData: Record<string, unknown> = {};
    const title = pickBodyValue(req.body, 'title');
    if (title !== undefined) {
      if (typeof title !== 'string' || !title.trim()) {
        throw new HttpError(400, 'title must be a non-empty string');
      }
      updateData.title = title.trim();
    }

    if (pickBodyValue(req.body, 'description') !== undefined) {
      const d = pickBodyValue(req.body, 'description');
      updateData.description = d == null ? null : String(d).trim() || null;
    }

    const gradeIdRaw = pickBodyValue(req.body, 'gradeId', 'grade_id');
    if (gradeIdRaw !== undefined) {
      const gradeId = Number(gradeIdRaw);
      if (!Number.isInteger(gradeId) || gradeId <= 0) {
        throw new HttpError(400, 'gradeId must be a valid positive integer');
      }
      updateData.gradeId = gradeId;
    }

    const durationRaw = pickBodyValue(req.body, 'durationMinutes', 'duration_minutes');
    if (durationRaw !== undefined) {
      updateData.durationMinutes = parseOptionalDurationMinutes(durationRaw, 'durationMinutes');
    }

    const questionsCountRaw = pickBodyValue(req.body, 'questionsCount', 'questions_count');
    if (questionsCountRaw !== undefined) {
      updateData.questionsCount = parseRequiredPositiveNumber(questionsCountRaw, 'questionsCount');
    }

    const isVisible = parseBooleanInput(
      pickBodyValue(req.body, 'isVisibleToStudents', 'is_visible_to_students'),
    );
    if (isVisible !== undefined) updateData.isVisibleToStudents = isVisible;

    if (pickBodyValue(req.body, 'visibilityEndDate', 'visibility_end_date') !== undefined) {
      updateData.visibilityEndDate = parseTimestampOrNull(
        pickBodyValue(req.body, 'visibilityEndDate', 'visibility_end_date'),
        'visibilityEndDate',
      );
    }
    if (
      pickBodyValue(req.body, 'availableFrom', 'available_from', 'showAt', 'show_at') !==
      undefined
    ) {
      updateData.availableFrom = parseTimestampOrNull(
        pickBodyValue(req.body, 'availableFrom', 'available_from', 'showAt', 'show_at'),
        'availableFrom',
      );
    }

    const showAnswers = parseBooleanInput(
      pickBodyValue(req.body, 'showAnswersImmediately', 'show_answers_immediately'),
    );
    if (showAnswers !== undefined) updateData.showAnswersImmediately = showAnswers;

    if (pickBodyValue(req.body, 'answersVisibleAt', 'answers_visible_at') !== undefined) {
      updateData.answersVisibleAt = parseTimestampOrNull(
        pickBodyValue(req.body, 'answersVisibleAt', 'answers_visible_at'),
        'answersVisibleAt',
      );
    }
    if (pickBodyValue(req.body, 'answersReleaseMode', 'answers_release_mode') !== undefined) {
      updateData.answersReleaseMode = pickBodyValue(
        req.body,
        'answersReleaseMode',
        'answers_release_mode',
      );
    }
    if (pickBodyValue(req.body, 'showAnswersAfterHours', 'show_answers_after_hours') !== undefined) {
      updateData.showAnswersAfterHours = Number(
        pickBodyValue(req.body, 'showAnswersAfterHours', 'show_answers_after_hours'),
      );
    }
    if (pickBodyValue(req.body, 'questionDisplayMode', 'question_display_mode') !== undefined) {
      updateData.questionDisplayMode = normalizeQuestionDisplayMode(
        pickBodyValue(req.body, 'questionDisplayMode', 'question_display_mode'),
      );
    }

    const isActive = parseBooleanInput(pickBodyValue(req.body, 'isActive', 'is_active'));
    if (isActive !== undefined) updateData.isActive = isActive;

    if (pickBodyValue(req.body, 'attemptLimit', 'attempt_limit') !== undefined) {
      updateData.attemptLimit = parseAttemptLimit(
        pickBodyValue(req.body, 'attemptLimit', 'attempt_limit'),
      );
    }

    const updated = await CourseLevelExamsService.updateExam(examId, req.user!, updateData as any);
    res.json({ success: true, exam: updated });
  }),
);

router.post(
  '/:examId/publish',
  authMiddleware(COURSE_CONTENT_ROLES),
  asyncWrapper(async (req, res) => {
    const examId = Number(req.params.examId);
    await assertPublicExam(examId, req.user!);
    const exam = await CourseLevelExamsService.updateExam(examId, req.user!, {
      isVisibleToStudents: true,
      isActive: true,
    });
    res.json({ success: true, exam });
  }),
);

router.post(
  '/:examId/unpublish',
  authMiddleware(COURSE_CONTENT_ROLES),
  asyncWrapper(async (req, res) => {
    const examId = Number(req.params.examId);
    await assertPublicExam(examId, req.user!);
    const exam = await CourseLevelExamsService.updateExam(examId, req.user!, {
      isVisibleToStudents: false,
    });
    res.json({ success: true, exam });
  }),
);

router.delete(
  '/:examId',
  authMiddleware(COURSE_CONTENT_ROLES),
  asyncWrapper(async (req, res) => {
    const examId = Number(req.params.examId);
    await assertPublicExam(examId, req.user!);
    const result = await CourseLevelExamsService.deleteExam(examId, req.user!);
    res.json({ success: true, ...result });
  }),
);

router.get(
  '/:examId/questions',
  authMiddleware(COURSE_CONTENT_ROLES),
  asyncWrapper(async (req, res) => {
    const examId = Number(req.params.examId);
    await assertPublicExam(examId, req.user!);
    const questions = await CourseLevelExamQuestionsService.getExamQuestions(examId, req.user!);
    res.json({
      success: true,
      questions: questions.map((row: any) => ({
        ...row,
        questionImage: row.question_image ?? null,
        questionText: row.question_text,
        optionA: row.option_a,
        optionB: row.option_b,
        optionC: row.option_c,
        optionD: row.option_d,
        correctAnswer: row.correct_answer,
      })),
    });
  }),
);

/**
 * PUT /api/public-exams/:examId/questions/:questionId
 * تعديل نص السؤال أو الاختيارات أو الإجابة. الصورة اختيارية: ملف أو رابط.
 */
router.put(
  '/:examId/questions/:questionId',
  authMiddleware(COURSE_CONTENT_ROLES),
  questionImageUpload,
  asyncWrapper(async (req, res) => {
    const examId = Number(req.params.examId);
    const questionId = Number(req.params.questionId);
    if (!Number.isInteger(examId) || examId <= 0 || !Number.isInteger(questionId) || questionId <= 0) {
      throw new HttpError(400, 'معرّف الامتحان أو السؤال غير صالح');
    }
    await assertPublicExam(examId, req.user!);

    const body = (req.body || {}) as Record<string, unknown>;
    const updateData: {
      questionText?: string;
      questionImage?: string | null;
      optionA?: string;
      optionB?: string;
      optionC?: string;
      optionD?: string;
    } = {};

    const questionText = optionalTrimmed(body.questionText ?? body.question_text);
    if (questionText !== undefined) updateData.questionText = questionText;
    const optionA = optionalTrimmed(body.optionA ?? body.option_a);
    const optionB = optionalTrimmed(body.optionB ?? body.option_b);
    const optionC = optionalTrimmed(body.optionC ?? body.option_c);
    const optionD = optionalTrimmed(body.optionD ?? body.option_d);
    if (optionA !== undefined) updateData.optionA = optionA;
    if (optionB !== undefined) updateData.optionB = optionB;
    if (optionC !== undefined) updateData.optionC = optionC;
    if (optionD !== undefined) updateData.optionD = optionD;

    const file = firstUploadedImage(req);
    if (file) {
      const uploaded = await uploadToCloudinary(file.path);
      updateData.questionImage = uploaded.secure_url;
    } else {
      const imageFromBody = imageValueFromBody(body);
      if (imageFromBody !== undefined) updateData.questionImage = imageFromBody;
    }

    const rawAnswers =
      body.correctAnswers ??
      body.correct_answers ??
      (body.correctAnswer != null || body.correct_answer != null
        ? [
            body.correctAnswer ?? body.correct_answer,
            body.correctAnswer2 ?? body.correct_answer_2,
          ].filter((v) => v != null && String(v).trim() !== '')
        : null);

    const hasContentUpdate = Object.keys(updateData).length > 0;
    const hasAnswerUpdate = Array.isArray(rawAnswers);
    if (!hasContentUpdate && !hasAnswerUpdate) {
      throw new HttpError(400, 'أرسل حقلًا واحدًا على الأقل لتعديل السؤال');
    }

    let question = hasContentUpdate
      ? await CourseLevelExamQuestionsService.updateQuestionOnExam(examId, questionId, updateData)
      : null;
    let regrade: unknown;
    let correctAnswers: string[] | undefined;
    if (hasAnswerUpdate) {
      const written = await CourseLevelExamQuestionsService.setCorrectAnswersOnExam(
        examId,
        questionId,
        rawAnswers as Array<'A' | 'B' | 'C' | 'D'>,
      );
      question = written.question;
      regrade = written.regrade;
      correctAnswers = written.correctAnswers;
    }

    res.json({
      success: true,
      message: 'تم تعديل السؤال',
      question: mapPublicExamQuestion(question),
      ...(correctAnswers ? { correctAnswers } : {}),
      ...(regrade ? { regrade } : {}),
    });
  }),
);

/**
 * POST /api/public-exams/:examId/questions/:questionId/image
 * إضافة أو استبدال صورة السؤال. ملف (questionImage أو image) أو رابط questionImage.
 */
router.post(
  '/:examId/questions/:questionId/image',
  authMiddleware(COURSE_CONTENT_ROLES),
  questionImageUpload,
  asyncWrapper(async (req, res) => {
    const examId = Number(req.params.examId);
    const questionId = Number(req.params.questionId);
    if (!Number.isInteger(examId) || examId <= 0 || !Number.isInteger(questionId) || questionId <= 0) {
      throw new HttpError(400, 'معرّف الامتحان أو السؤال غير صالح');
    }
    await assertPublicExam(examId, req.user!);

    const body = (req.body || {}) as Record<string, unknown>;
    const file = firstUploadedImage(req);
    let questionImage: string | null | undefined;
    if (file) {
      const uploaded = await uploadToCloudinary(file.path);
      questionImage = uploaded.secure_url;
    } else {
      questionImage = imageValueFromBody(body);
    }
    if (!questionImage) {
      throw new HttpError(400, 'أرسل ملف الصورة أو رابط questionImage');
    }

    const question = await CourseLevelExamQuestionsService.updateQuestionOnExam(examId, questionId, {
      questionImage,
    });
    res.json({
      success: true,
      message: 'تمت إضافة صورة السؤال',
      question: mapPublicExamQuestion(question),
    });
  }),
);

/**
 * DELETE /api/public-exams/:examId/questions/:questionId
 * حذف السؤال من الامتحان العام فقط. سؤال البنك الأصلي يبقى، والمحاولات المسلّمة تتعاد درجاتها.
 */
router.delete(
  '/:examId/questions/:questionId',
  authMiddleware(COURSE_CONTENT_ROLES),
  asyncWrapper(async (req, res) => {
    const examId = Number(req.params.examId);
    const questionId = Number(req.params.questionId);
    if (!Number.isInteger(examId) || examId <= 0 || !Number.isInteger(questionId) || questionId <= 0) {
      throw new HttpError(400, 'معرّف الامتحان أو السؤال غير صالح');
    }
    await assertPublicExam(examId, req.user!);
    const result = await CourseLevelExamQuestionsService.deleteQuestionOnExam(examId, questionId);
    res.json({
      success: true,
      message: 'تم حذف السؤال من الامتحان',
      examId: result.examId,
      deletedQuestionId: result.deletedQuestionId,
      regrade: result.regrade,
    });
  }),
);

/** إضافة أسئلة من بنك الأسئلة للامتحان العام */
router.post(
  '/:examId/questions/from-bank',
  authMiddleware(COURSE_CONTENT_ROLES),
  asyncWrapper(async (req, res) => {
    const examId = Number(req.params.examId);
    if (!Number.isInteger(examId) || examId <= 0) {
      throw new HttpError(400, 'Invalid exam id');
    }
    await assertPublicExam(examId, req.user!);

    const body = req.body as { questionIds?: number[] };
    const questionIds = Array.isArray(body.questionIds)
      ? body.questionIds.map((id) => Number(id)).filter((n) => Number.isInteger(n) && n > 0)
      : [];
    if (questionIds.length === 0) {
      throw new HttpError(400, 'questionIds is required and must be a non-empty array of question IDs');
    }

    const { missing } = await CourseLevelExamsService.validateQuestionIdsInBank(questionIds);
    if (missing.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Some question IDs were not found in the question bank',
        missingQuestionIds: missing,
      });
    }

    const result = (await CourseLevelExamsService.addQuestionsFromBank(
      req.user!,
      examId,
      questionIds,
    )) as { addedCount: number; addedQuestions: any[]; alreadyInExamIds?: number[] };

    const addedBankIds = (result.addedQuestions || [])
      .map((row: { question_id_v2?: number; question_id?: number }) => row.question_id_v2 ?? row.question_id)
      .filter((id: number | undefined): id is number => id != null);
    const skippedQuestions = result.alreadyInExamIds ?? [];

    return res.status(200).json({
      success: true,
      message:
        skippedQuestions.length > 0 && addedBankIds.length > 0
          ? 'Some questions were skipped because they already exist'
          : skippedQuestions.length > 0 && addedBankIds.length === 0
            ? 'All selected questions already exist in this exam'
            : 'Questions added successfully',
      examId,
      examType: 'public-exam',
      addedCount: result.addedCount ?? addedBankIds.length,
      addedQuestions: addedBankIds,
      skippedQuestions,
      questions: result.addedQuestions,
    });
  }),
);

/** إضافة أسئلة من مكتبة أسئلة المدرس للامتحان العام */
router.post(
  '/:examId/questions/from-teacher-library',
  authMiddleware(COURSE_CONTENT_ROLES),
  asyncWrapper(async (req, res) => {
    const examId = Number(req.params.examId);
    if (!Number.isInteger(examId) || examId <= 0) {
      throw new HttpError(400, 'Invalid exam id');
    }
    await assertPublicExam(examId, req.user!);

    const teacherId = req.user!.id;
    const questionIds = await resolveTeacherLibraryQuestionIds(teacherId, req.body ?? {});
    if (!questionIds.length) {
      throw new HttpError(
        400,
        'Provide questionIds (non-empty array), or gradeId, or lessonId, or passageId from your question library',
      );
    }

    const { missing } = await TeacherLibraryExamQuestionsService.validateQuestionIds(
      teacherId,
      questionIds,
    );
    if (missing.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Some question IDs were not found in your question library',
        missingQuestionIds: missing,
      });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await TeacherLibraryExamQuestionsService.addToCourseExam(
        teacherId,
        examId,
        questionIds,
        client,
      );
      await client.query('COMMIT');

      return res.status(200).json({
        success: true,
        message:
          result.skippedTeacherQuestionIds.length > 0 && result.addedCount > 0
            ? 'Some questions were skipped because they already exist'
            : result.addedCount > 0
              ? 'Questions added successfully'
              : 'All selected questions already exist in this exam',
        examId,
        examType: 'public-exam',
        addedCount: result.addedCount,
        addedTeacherQuestionIds: result.addedTeacherQuestionIds,
        skippedTeacherQuestionIds: result.skippedTeacherQuestionIds,
        questions: result.addedQuestions,
      });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }),
);

router.get(
  '/:examId/grades',
  authMiddleware(COURSE_CONTENT_ROLES),
  asyncWrapper(async (req, res) => {
    const examId = Number(req.params.examId);
    await assertPublicExam(examId, req.user!);
    const result = await CourseLevelExamsService.getExamGrades(examId, req.user!);
    res.json({ success: true, ...result });
  }),
);

router.get(
  '/:examId/report',
  authMiddleware(COURSE_CONTENT_ROLES),
  asyncWrapper(async (req, res) => {
    const examId = Number(req.params.examId);
    await assertPublicExam(examId, req.user!);
    const passPercentage = req.query.passPercentage
      ? Number(req.query.passPercentage)
      : undefined;
    const result = await CourseLevelExamsService.getExamReport(examId, req.user!, {
      passPercentage,
    });
    res.json({ success: true, ...result });
  }),
);

// ─── Student attempt flow (same engine as course-level) ────

router.post(
  '/:examId/start',
  authMiddleware(['student']),
  asyncWrapper(async (req, res) => {
    const examId = Number(req.params.examId);
    if (!Number.isInteger(examId) || examId <= 0) {
      throw new HttpError(400, 'Invalid exam id');
    }
    await assertPublicExam(examId, req.user!);
    try {
      const attempt = await CourseLevelExamsService.startExamAttempt(examId, req.user!.id);
      res.json(attempt);
    } catch (error: any) {
      if (error.status === 403 && error.details?.previousAttempt) {
        return res.status(403).json({
          message: error.message,
          previousAttempt: error.details.previousAttempt,
        });
      }
      throw error;
    }
  }),
);

router.post(
  '/:examId/autosave',
  authMiddleware(['student']),
  asyncWrapper(async (req, res) => {
    const examId = Number(req.params.examId);
    await assertPublicExam(examId, req.user!);
    const answers = CourseLevelExamsService.parseAnswersFromRequestBody(req.body, {
      required: false,
    });
    const result = await CourseLevelExamsService.autosaveExamAnswers(
      examId,
      req.user!.id,
      answers,
      req.body.attemptId ?? req.body.attempt_id,
    );
    res.json(result);
  }),
);

router.post(
  '/:examId/submit',
  authMiddleware(['student']),
  asyncWrapper(async (req, res) => {
    const examId = Number(req.params.examId);
    await assertPublicExam(examId, req.user!);
    const resolvedAttemptId = await CourseLevelExamsService.resolveActiveAttemptId(
      examId,
      req.user!.id,
      req.body.attemptId ?? req.body.attempt_id,
    );
    const answers = CourseLevelExamsService.parseAnswersFromRequestBody(req.body, {
      required: false,
    });
    const result = await CourseLevelExamsService.submitExamAttempt(
      examId,
      req.user!.id,
      resolvedAttemptId,
      answers,
    );
    res.json(result);
  }),
);

router.get(
  '/:examId/my-report',
  authMiddleware(['student']),
  asyncWrapper(async (req, res) => {
    const examId = Number(req.params.examId);
    await assertPublicExam(examId, req.user!);
    const report = await CourseLevelExamsService.getMyCourseReport(examId, req.user!.id);
    res.json(report);
  }),
);

router.get(
  '/:examId/student-report',
  authMiddleware(['student']),
  asyncWrapper(async (req, res) => {
    const examId = Number(req.params.examId);
    await assertPublicExam(examId, req.user!);
    const attemptId = req.query.attemptId ? Number(req.query.attemptId) : undefined;
    const report = await CourseLevelExamsService.getStudentAttemptReport(examId, req.user!.id, {
      attemptId:
        attemptId != null && Number.isInteger(attemptId) && attemptId > 0
          ? attemptId
          : undefined,
    });
    res.json(report);
  }),
);
