import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { authMiddleware } from '../middleware/authentication';
import { LeaguesService } from '../services/leagues';
import { uploadToCloudinary } from '../utils';
import { LeagueMatchesService } from '../services/leagueMatches';
import { LeagueMatchQuestionsService } from '../services/leagueMatchQuestions';
import { LeagueMatchSolvingService } from '../services/leagueMatchSolving';

const router = Router();

// Configure multer for league images
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const uploadDir = 'uploads/leagues';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (_req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, 'league-' + uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp/;
    const extOk = allowed.test(path.extname(file.originalname).toLowerCase());
    const mimeOk = allowed.test(file.mimetype);
    if (extOk && mimeOk) return cb(null, true);
    cb(new Error('Only image files are allowed'));
  },
});

// POST /leagues -> Create new league (admin only)
router.post(
  '/',
  authMiddleware(['admin']),
  upload.single('image'),
  async (req: Request, res: Response) => {
    try {
      const { name, grade_id, matches_count, start_date, end_date, description, price } =
        req.body as any;

      if (!name || !grade_id || !matches_count || !start_date || !end_date) {
        return res
          .status(400)
          .json({ message: 'name, grade_id, matches_count, start_date, end_date are required' });
      }

      if (new Date(end_date) <= new Date(start_date)) {
        return res.status(400).json({ message: 'end_date must be after start_date' });
      }

      let image_url: string | null = null;
      if (req.file) {
        const uploaded = await uploadToCloudinary(req.file.path);
        image_url = uploaded.secure_url;
      }

      const created = await LeaguesService.create(
        {
          name,
          grade_id: parseInt(grade_id),
          image_url: image_url || undefined,
          matches_count: parseInt(matches_count),
          start_date,
          end_date,
          description: description || undefined,
          price: price === undefined || price === null || price === '' ? null : Number(price),
        },
        req.user!.id,
      );

      res.status(201).json(created);
    } catch (error: any) {
      console.error('Error creating league:', error);
      res.status(500).json({ message: 'Failed to create league', error: error.message });
    }
  },
);

// GET /leagues -> list all (public)
router.get('/', authMiddleware(['admin']), async (_req: Request, res: Response) => {
  try {
    const rows = await LeaguesService.getAll();
    res.json(rows);
  } catch (error: any) {
    console.error('Error listing leagues:', error);
    res.status(500).json({ message: 'Failed to list leagues', error: error.message });
  }
});

// GET /leagues/student -> الدوريات الخاصة بصفوف الطالب (مطلوب طالب)
router.get('/student', authMiddleware(['student']), async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const rows = await LeaguesService.getForStudent(userId);
    res.json(rows);
  } catch (error: any) {
    console.error('Error listing student leagues:', error);
    res.status(500).json({ message: 'Failed to list student leagues', error: error.message });
  }
});

// POST /leagues/:id/join -> اشتراك الطالب في الدوري (مجاني فقط حالياً)
router.post('/:id/join', authMiddleware(['student']), async (req: Request, res: Response) => {
  try {
    const leagueId = parseInt(req.params.id);
    if (isNaN(leagueId)) return res.status(400).json({ message: 'Invalid league id' });
    const studentId = req.user!.id;

    const enrolled = await LeaguesService.enrollFree(leagueId, studentId);
    res.json({ success: enrolled, message: 'تم الاشتراك في الدوري', data: { joined: enrolled } });
  } catch (error: any) {
    if (error.message === 'الدوري غير موجود')
      return res.status(404).json({ message: error.message });
    if (error.message === 'هذا الدوري مدفوع')
      return res.status(402).json({ message: error.message });
    console.error('Error joining league:', error);
    res.status(500).json({ message: 'Failed to join league', error: error.message });
  }
});

// GET /leagues/:id/students -> الطلاب المشتركين (أدمن فقط)
router.get('/:id/students', authMiddleware(['admin']), async (req: Request, res: Response) => {
  try {
    const leagueId = parseInt(req.params.id);
    if (isNaN(leagueId)) return res.status(400).json({ message: 'Invalid league id' });
    // verify league exists
    const league = await LeaguesService.getById(leagueId);
    if (!league) return res.status(404).json({ message: 'League not found' });
    const students = await LeaguesService.getEnrolledStudents(leagueId);
    res.json({ success: true, data: students });
  } catch (error: any) {
    console.error('Error listing league students:', error);
    res.status(500).json({ message: 'Failed to list league students', error: error.message });
  }
});

// DELETE /leagues/:id/students/:studentId -> إلغاء اشتراك طالب (أدمن فقط)
router.delete(
  '/:id/students/:studentId',
  authMiddleware(['admin']),
  async (req: Request, res: Response) => {
    try {
      const leagueId = parseInt(req.params.id);
      const studentId = parseInt(req.params.studentId);
      if (isNaN(leagueId) || isNaN(studentId))
        return res.status(400).json({ message: 'Invalid ids' });

      // verify league exists
      const league = await LeaguesService.getById(leagueId);
      if (!league) return res.status(404).json({ message: 'League not found' });

      const cancelled = await LeaguesService.cancelEnrollment(leagueId, studentId);
      if (!cancelled)
        return res.status(404).json({ message: 'Subscription not found or already cancelled' });
      res.json({ success: true, message: 'تم إلغاء اشتراك الطالب' });
    } catch (error: any) {
      console.error('Error cancelling league enrollment:', error);
      res.status(500).json({ message: 'Failed to cancel enrollment', error: error.message });
    }
  },
);

// GET /leagues/:id -> details (Admin or enrolled student)
router.get('/:id', authMiddleware(['admin', 'student']), async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const row = await LeaguesService.getById(id);
    if (!row) return res.status(404).json({ message: 'League not found' });

    if (req.user!.role === 'student') {
      const enrolled = await LeaguesService.isStudentEnrolled(id, req.user!.id);
      if (!enrolled) return res.status(403).json({ message: 'Forbidden: enroll to access league' });
    }

    res.json(row);
  } catch (error: any) {
    console.error('Error getting league:', error);
    res.status(500).json({ message: 'Failed to get league', error: error.message });
  }
});

// PUT /leagues/:id -> update (admin only)
router.put(
  '/:id',
  authMiddleware(['admin']),
  upload.single('image'),
  async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const existing = await LeaguesService.getById(id);
      if (!existing) return res.status(404).json({ message: 'League not found' });

      const { name, grade_id, matches_count, start_date, end_date, description, price } =
        req.body as any;

      let image_url = (existing as any).image_url as string | null;
      if (req.file) {
        const uploaded = await uploadToCloudinary(req.file.path);
        image_url = uploaded.secure_url;
      }

      if (start_date && end_date && new Date(end_date) <= new Date(start_date)) {
        return res.status(400).json({ message: 'end_date must be after start_date' });
      }

      const updated = await LeaguesService.update(id, {
        ...(name ? { name } : {}),
        ...(grade_id ? { grade_id: parseInt(grade_id) } : {}),
        ...(matches_count ? { matches_count: parseInt(matches_count) } : {}),
        ...(start_date ? { start_date } : {}),
        ...(end_date ? { end_date } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(image_url ? { image_url } : {}),
        ...(price !== undefined ? { price: price === '' ? null : Number(price) } : {}),
      });

      res.json(updated);
    } catch (error: any) {
      console.error('Error updating league:', error);
      res.status(500).json({ message: 'Failed to update league', error: error.message });
    }
  },
);

// DELETE /leagues/:id -> delete (admin only)
router.delete('/:id', authMiddleware(['admin']), async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const ok = await LeaguesService.delete(id);
    if (!ok) return res.status(404).json({ message: 'League not found' });
    res.json({ success: true });
  } catch (error: any) {
    console.error('Error deleting league:', error);
    res.status(500).json({ message: 'Failed to delete league', error: error.message });
  }
});

export { router };
// ===== League Matches (admin) =====

// Create match in a league (admin)
router.post('/:id/matches', authMiddleware(['admin']), upload.single('image'), async (req: Request, res: Response) => {
  try {
    const leagueId = parseInt(req.params.id);
    if (isNaN(leagueId)) return res.status(400).json({ message: 'Invalid league id' });
    const { name, description, is_visible, start_date, start_time, end_time, duration_minutes } = req.body as any;
    if (!name) return res.status(400).json({ message: 'name is required' });
    // start_date, start_time, end_time are now optional

    // Validate duration_minutes
    let duration: number | undefined = undefined;
    if (duration_minutes !== undefined) {
      duration = parseInt(duration_minutes);
      if (isNaN(duration) || duration <= 0) {
        return res.status(400).json({ message: 'duration_minutes must be a positive number' });
      }
    }

    // Validate time order ONLY if both are present
    if (start_time && end_time) {
      const [sh, sm] = String(start_time).split(':').map(Number);
      const [eh, em] = String(end_time).split(':').map(Number);
      const startM = sh * 60 + (sm || 0);
      const endM = eh * 60 + (em || 0);
      if (!(endM > startM)) return res.status(400).json({ message: 'end_time must be after start_time' });
    }
    // ensure league exists
    const league = await LeaguesService.getById(leagueId);
    if (!league) return res.status(404).json({ message: 'League not found' });



    let image_url: string | null = null;
    if (req.file) {
      const uploaded = await uploadToCloudinary(req.file.path);
      image_url = uploaded.secure_url;
    }

    const created = await LeagueMatchesService.create(
      {
        league_id: leagueId,
        name,
        description,
        image_url,
        is_visible: is_visible === 'true' || is_visible === true,
        start_date,
        start_time,
        end_time,
        duration_minutes: duration,
      },
      req.user!.id,
    );
    res.status(201).json(created);
  } catch (error: any) {
    console.error('Error creating league match:', error);
    res.status(500).json({ message: 'Failed to create league match', error: error.message });
  }
},
);

// List matches in a league
router.get(
  '/:id/matches',
  authMiddleware(['admin', 'student']),
  async (req: Request, res: Response) => {
    try {
      const leagueId = parseInt(req.params.id);
      if (isNaN(leagueId)) return res.status(400).json({ message: 'Invalid league id' });
      // for students, only visible matches and must be enrolled
      if (req.user!.role === 'student') {
        const enrolled = await LeaguesService.isStudentEnrolled(leagueId, req.user!.id);
        if (!enrolled)
          return res.status(403).json({ message: 'Forbidden: enroll to access matches' });
        const rows = await LeagueMatchesService.listByLeague(leagueId, true);
        return res.json(rows);
      }
      const rows = await LeagueMatchesService.listByLeague(leagueId, false);
      res.json(rows);
    } catch (error: any) {
      console.error('Error listing league matches:', error);
      res.status(500).json({ message: 'Failed to list league matches', error: error.message });
    }
  },
);

// Update a match (admin)
router.put(
  '/matches/:matchId',
  authMiddleware(['admin']),
  upload.single('image'),
  async (req: Request, res: Response) => {
    try {
      const matchId = parseInt(req.params.matchId);
      if (isNaN(matchId)) return res.status(400).json({ message: 'Invalid match id' });
      const existing = await LeagueMatchesService.getById(matchId);
      if (!existing) return res.status(404).json({ message: 'Match not found' });

      const { name, description, is_visible, start_date, start_time, end_time } = req.body as any;
      if (start_time && end_time) {
        const [sh, sm] = String(start_time).split(':').map(Number);
        const [eh, em] = String(end_time).split(':').map(Number);
        const startM = sh * 60 + (sm || 0);
        const endM = eh * 60 + (em || 0);
        if (!(endM > startM))
          return res.status(400).json({ message: 'end_time must be after start_time' });
      }
      let image_url = existing.image_url as string | null;
      if (req.file) {
        const uploaded = await uploadToCloudinary(req.file.path);
        image_url = uploaded.secure_url;
      }
      const updated = await LeagueMatchesService.update(matchId, {
        ...(name ? { name } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(image_url ? { image_url } : {}),
        ...(is_visible !== undefined
          ? { is_visible: is_visible === 'true' || is_visible === true }
          : {}),
        ...(start_date ? { start_date } : {}),
        ...(start_time ? { start_time } : {}),
        ...(end_time ? { end_time } : {}),
      });
      res.json(updated);
    } catch (error: any) {
      console.error('Error updating league match:', error);
      res.status(500).json({ message: 'Failed to update league match', error: error.message });
    }
  },
);

// Toggle visibility (admin)
router.patch(
  '/matches/:matchId/toggle-visibility',
  authMiddleware(['admin']),
  async (req: Request, res: Response) => {
    try {
      const matchId = parseInt(req.params.matchId);
      if (isNaN(matchId)) return res.status(400).json({ message: 'Invalid match id' });
      const updated = await LeagueMatchesService.toggleVisibility(matchId);
      if (!updated) return res.status(404).json({ message: 'Match not found' });
      res.json({ success: true, data: updated });
    } catch (error: any) {
      console.error('Error toggling league match visibility:', error);
      res
        .status(500)
        .json({ message: 'Failed to toggle league match visibility', error: error.message });
    }
  },
);

// Delete match (admin)
router.delete(
  '/matches/:matchId',
  authMiddleware(['admin']),
  async (req: Request, res: Response) => {
    try {
      const matchId = parseInt(req.params.matchId);
      if (isNaN(matchId)) return res.status(400).json({ message: 'Invalid match id' });
      const existing = await LeagueMatchesService.getById(matchId);
      if (!existing) return res.status(404).json({ message: 'Match not found' });
      const ok = await LeagueMatchesService.delete(matchId);
      res.json({ success: ok });
    } catch (error: any) {
      console.error('Error deleting league match:', error);
      res.status(500).json({ message: 'Failed to delete league match', error: error.message });
    }
  },
);

// Get match details (admin or enrolled student)





router.get('/matches/:matchId', authMiddleware(['admin', 'student']), async (req: Request, res: Response) => {
  try {
    const matchId = parseInt(req.params.matchId);
    if (isNaN(matchId)) return res.status(400).json({ message: 'Invalid match id' });
    const match = await LeagueMatchesService.getById(matchId);
    if (!match) return res.status(404).json({ message: 'Match not found' });
    if (req.user!.role === 'student') {
      const enrolled = await LeaguesService.isStudentEnrolled(match.league_id, req.user!.id);
      if (!enrolled) return res.status(403).json({ message: 'Forbidden: enroll to access match' });
      // Allow viewing hidden matches (they appear as "unavailable")
      // if (match.is_visible === false) return res.status(403).json({ message: 'Forbidden: match hidden' });
    }
    res.json(match);
  } catch (error: any) {
    console.error('Error getting league match:', error);
    res.status(500).json({ message: 'Failed to get league match', error: error.message });
  }
});

// ===== League Match MCQ Questions =====

// Bulk add questions by free text format (admin)
router.post(
  '/matches/:matchId/questions/bulk',
  authMiddleware(['admin']),
  async (req: Request, res: Response) => {
    try {
      const matchId = parseInt(req.params.matchId);
      if (isNaN(matchId)) return res.status(400).json({ message: 'Invalid match id' });
      const match = await LeagueMatchesService.getById(matchId);
      if (!match) return res.status(404).json({ message: 'Match not found' });

      const { text } = req.body as any;
      if (!text || typeof text !== 'string')
        return res.status(400).json({ message: 'text is required' });

      // Parse free text block into questions
      const blocks = text
        .split(/\n\s*\n+/)
        .map((b: string) => b.trim())
        .filter(Boolean);

      const items: {
        text: string;
        option_a: string;
        option_b: string;
        option_c: string;
        option_d: string;
      }[] = [];
      for (const b of blocks) {
        const lines = b
          .split(/\n+/)
          .map((l) => l.trim())
          .filter(Boolean);
        if (lines.length < 5) continue;
        const qText = lines[0];
        const optA = lines[1].replace(/^A\)\s*/i, '').trim();
        const optB = lines[2].replace(/^B\)\s*/i, '').trim();
        const optC = lines[3].replace(/^C\)\s*/i, '').trim();
        const optD = lines[4].replace(/^D\)\s*/i, '').trim();
        items.push({ text: qText, option_a: optA, option_b: optB, option_c: optC, option_d: optD });
      }

      if (!items.length) return res.status(400).json({ message: 'No questions parsed' });
      const created = await LeagueMatchQuestionsService.bulkCreate(matchId, items, req.user!.id);
      // Map to response shape with options array
      const data = created.map((q: any) => ({
        id: q.id,
        match_id: q.match_id,
        text: q.text,
        options: [q.option_a, q.option_b, q.option_c, q.option_d],
        correct_answer: q.correct_answer ?? null,
        image: q.image_url ?? null,
        created_at: q.created_at,
        updated_at: q.updated_at,
      }));
      res.status(201).json(data);
    } catch (error: any) {
      console.error('Error bulk adding match questions:', error);
      res.status(500).json({ message: 'Failed to bulk add questions', error: error.message });
    }
  },
);

// Create one question (admin)
// Create one question (admin)
router.post('/matches/:matchId/questions', authMiddleware(['admin']), async (req: Request, res: Response) => {
  try {
    const matchId = parseInt(req.params.matchId);
    if (isNaN(matchId)) return res.status(400).json({ message: 'Invalid match id' });
    const match = await LeagueMatchesService.getById(matchId);
    if (!match) return res.status(404).json({ message: 'Match not found' });
    const { text, option_a, option_b, option_c, option_d, correct_answer } = req.body as any;
    if (!text || !option_a || !option_b || !option_c || !option_d) {
      return res.status(400).json({ message: 'text and four options are required' });
    }

    // التحقق من صحة الإجابة الصحيحة إذا تم إرسالها
    let correctAnswer: 'A' | 'B' | 'C' | 'D' | null = null;
    if (correct_answer) {
      if (!['A', 'B', 'C', 'D'].includes(correct_answer)) {
        return res.status(400).json({ message: 'correct_answer must be one of A, B, C, or D' });
      }
      correctAnswer = correct_answer;
    }

    const q = await LeagueMatchQuestionsService.createOne(
      { match_id: matchId, text, option_a, option_b, option_c, option_d },
      req.user!.id,
      correctAnswer
    );
    const data = {
      id: q.id,
      match_id: q.match_id,
      text: q.text,
      options: [q.option_a, q.option_b, q.option_c, q.option_d],
      correct_answer: q.correct_answer ?? null,
      image: q.image_url ?? null,
      created_at: q.created_at,
      updated_at: q.updated_at,
    };
    res.status(201).json(data);
  } catch (error: any) {
    console.error('Error creating match question:', error);
    res.status(500).json({ message: 'Failed to create question', error: error.message });
  }
});

// Update a question (admin)
router.put('/questions/:questionId', authMiddleware(['admin']), async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.questionId);
    if (isNaN(id)) return res.status(400).json({ message: 'Invalid question id' });
    const existing = await LeagueMatchQuestionsService.getById(id);
    if (!existing) return res.status(404).json({ message: 'Question not found' });
    const { text, option_a, option_b, option_c, option_d, correct_answer } = req.body as any;

    // التحقق من صحة الإجابة الصحيحة إذا تم إرسالها
    let correctAnswer: 'A' | 'B' | 'C' | 'D' | null | undefined = undefined;
    if (correct_answer !== undefined) {
      if (correct_answer === null) {
        correctAnswer = null;
      } else if (!['A', 'B', 'C', 'D'].includes(correct_answer)) {
        return res.status(400).json({ message: 'correct_answer must be one of A, B, C, D, or null' });
      } else {
        correctAnswer = correct_answer;
      }
    }

    const updated = await LeagueMatchQuestionsService.update(id, {
      text,
      option_a,
      option_b,
      option_c,
      option_d,
      correct_answer: correctAnswer,
    });
    const data = {
      id: updated.id,
      match_id: updated.match_id,
      text: updated.text,
      options: [updated.option_a, updated.option_b, updated.option_c, updated.option_d],
      correct_answer: updated.correct_answer ?? null,
      image: updated.image_url ?? null,
      created_at: updated.created_at,
      updated_at: updated.updated_at,
    };
    res.json(data);
  } catch (error: any) {
    console.error('Error updating match question:', error);
    res.status(500).json({ message: 'Failed to update question', error: error.message });
  }
});

// Delete a question (admin)
router.delete(
  '/questions/:questionId',
  authMiddleware(['admin']),
  async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.questionId);
      if (isNaN(id)) return res.status(400).json({ message: 'Invalid question id' });
      const ok = await LeagueMatchQuestionsService.delete(id);
      if (!ok) return res.status(404).json({ message: 'Question not found' });
      res.json({ success: true });
    } catch (error: any) {
      console.error('Error deleting match question:', error);
      res.status(500).json({ message: 'Failed to delete question', error: error.message });
    }
  },
);

// Upload image for a question (admin)
router.post(
  '/questions/:questionId/image',
  authMiddleware(['admin']),
  upload.single('image'),
  async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.questionId);
      if (isNaN(id)) return res.status(400).json({ message: 'Invalid question id' });
      const existing = await LeagueMatchQuestionsService.getById(id);
      if (!existing) return res.status(404).json({ message: 'Question not found' });
      if (!req.file) return res.status(400).json({ message: 'image is required' });
      const uploaded = await uploadToCloudinary(req.file.path);
      const updated = await LeagueMatchQuestionsService.update(id, {
        image_url: uploaded.secure_url,
      });
      const data = {
        id: updated.id,
        match_id: updated.match_id,
        text: updated.text,
        options: [updated.option_a, updated.option_b, updated.option_c, updated.option_d],
        correct_answer: updated.correct_answer ?? null,
        image: updated.image_url ?? null,
        created_at: updated.created_at,
        updated_at: updated.updated_at,
      };
      res.json(data);
    } catch (error: any) {
      console.error('Error uploading question image:', error);
      res.status(500).json({ message: 'Failed to upload question image', error: error.message });
    }
  },
);

// Add multiple image questions (admin) - up to 10 images
router.post(
  '/matches/:matchId/questions/images',
  authMiddleware(['admin']),
  upload.array('images', 10),
  async (req: Request, res: Response) => {
    try {
      const matchId = parseInt(req.params.matchId);
      if (isNaN(matchId)) return res.status(400).json({ message: 'Invalid match id' });
      const match = await LeagueMatchesService.getById(matchId);
      if (!match) return res.status(404).json({ message: 'Match not found' });

      const files = req.files as Express.Multer.File[];
      if (!files || files.length === 0) {
        return res.status(400).json({ message: 'يجب رفع صورة واحدة على الأقل' });
      }

      if (files.length > 10) {
        return res.status(400).json({ message: 'يمكن رفع 10 صور كحد أقصى' });
      }

      // رفع الصور على Cloudinary
      const imageUrls: string[] = [];
      const uploadErrors: string[] = [];

      for (const file of files) {
        try {
          const uploaded = await uploadToCloudinary(file.path);
          imageUrls.push(uploaded.secure_url);
        } catch (error) {
          console.error('Error uploading image:', error);
          uploadErrors.push(file.originalname);
        }
      }

      if (uploadErrors.length > 0) {
        return res.status(500).json({
          message: 'فشل رفع بعض الصور',
          errors: uploadErrors,
        });
      }

      // إنشاء الأسئلة مع اختيارات افتراضية (أ، ب، ج، د)
      const createdQuestions = [];
      for (const imageUrl of imageUrls) {
        const question = await LeagueMatchQuestionsService.createOne(
          {
            match_id: matchId,
            text: '', // نص فارغ للأسئلة بالصور
            option_a: 'أ',
            option_b: 'ب',
            option_c: 'ج',
            option_d: 'د',
            image_url: imageUrl,
          },
          req.user!.id,
          null, // لا توجد إجابة صحيحة افتراضية
        );
        createdQuestions.push({
          id: question.id,
          match_id: question.match_id,
          text: question.text,
          options: [question.option_a, question.option_b, question.option_c, question.option_d],
          correct_answer: question.correct_answer ?? null,
          image: question.image_url ?? null,
          created_at: question.created_at,
          updated_at: question.updated_at,
        });
      }

      res.status(201).json({
        message: 'تم إضافة الأسئلة بالصور بنجاح',
        questions: createdQuestions,
        count: createdQuestions.length,
      });
    } catch (error: any) {
      console.error('Error creating image questions:', error);
      res.status(500).json({ message: 'Failed to create image questions', error: error.message });
    }
  },
);

// Set correct answer (admin)
router.post(
  '/questions/:questionId/correct-answer',
  authMiddleware(['admin']),
  async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.questionId);
      if (isNaN(id)) return res.status(400).json({ message: 'Invalid question id' });
      const { correct_answer } = req.body as any;
      if (!correct_answer) return res.status(400).json({ message: 'correct_answer is required' });
      const updated = await LeagueMatchQuestionsService.setCorrectAnswer(id, correct_answer);
      const data = {
        id: updated.id,
        match_id: updated.match_id,
        text: updated.text,
        options: [updated.option_a, updated.option_b, updated.option_c, updated.option_d],
        correct_answer: updated.correct_answer ?? null,
        image: updated.image_url ?? null,
        created_at: updated.created_at,
        updated_at: updated.updated_at,
      };
      res.json(data);
    } catch (error: any) {
      console.error('Error setting correct answer:', error);
      res.status(500).json({ message: 'Failed to set correct answer', error: error.message });
    }
  },
);

// List questions in a match (admin or enrolled student)
router.get('/matches/:matchId/questions', authMiddleware(['admin', 'student']), async (req: Request, res: Response) => {
  try {
    const matchId = parseInt(req.params.matchId);
    if (isNaN(matchId)) return res.status(400).json({ message: 'Invalid match id' });
    const match = await LeagueMatchesService.getById(matchId);
    if (!match) return res.status(404).json({ message: 'Match not found' });

    const isStudent = req.user!.role === 'student';
    if (isStudent) {
      const enrolled = await LeaguesService.isStudentEnrolled(match.league_id, req.user!.id);
      if (!enrolled) return res.status(403).json({ message: 'يجب الاشتراك في الدوري لعرض الأسئلة' });
      // If match is not visible (unavailable), we might want to block VIEWING QUESTIONS, but allow seeing the match entry.
      // The user said "appear to student but show as unavailable". Likely questions shouldn't be accessible if unavailable.
      if (match.is_visible === false) return res.status(403).json({ message: 'المباراة غير متاحة حالياً' });
    }

    const rows = await LeagueMatchQuestionsService.listByMatch(matchId);
    const data = rows.map((q: any) => ({
      id: q.id,
      match_id: q.match_id,
      text: q.text,
      options: [q.option_a, q.option_b, q.option_c, q.option_d],
      // إخفاء الإجابة الصحيحة للطلاب
      correct_answer: isStudent ? null : (q.correct_answer ?? null),
      image: q.image_url ?? null,
      created_at: q.created_at,
      updated_at: q.updated_at,
    }));
    res.json(data);
  } catch (error: any) {
    console.error('Error listing match questions:', error);
    res.status(500).json({ message: 'Failed to list match questions', error: error.message });
  }
});

// Solve match (student only)
router.post(
  '/matches/:matchId/solve',
  authMiddleware(['student']),
  async (req: Request, res: Response) => {
    try {
      const matchId = parseInt(req.params.matchId);
      if (isNaN(matchId)) return res.status(400).json({ message: 'Invalid match id' });
      const match = await LeagueMatchesService.getById(matchId);
      if (!match) return res.status(404).json({ message: 'Match not found' });
      const enrolled = await LeaguesService.isStudentEnrolled(match.league_id, req.user!.id);
      if (!enrolled) return res.status(403).json({ message: 'Forbidden: enroll to solve' });
      const prev = await LeagueMatchSolvingService.hasSubmitted(matchId, req.user!.id);
      if (prev) return res.status(409).json({ message: 'تم انهاء المباراة من قبل' });
      const { answers } = req.body as any;
      if (!Array.isArray(answers) || !answers.length)
        return res.status(400).json({ message: 'answers required' });
      const result = await LeagueMatchSolvingService.solve(matchId, req.user!.id, answers);
      res.json({ message: 'تم التسليم', result });
    } catch (error: any) {
      if (error.message === 'submitted_before')
        return res.status(409).json({ message: 'تم انهاء المباراة من قبل' });
      console.error('Error solving match:', error);
      res.status(500).json({ message: 'Failed to solve match', error: error.message });
    }
  },
);

// Get student's result for a match (student only)
router.get(
  '/matches/:matchId/student-result',
  authMiddleware(['student']),
  async (req: Request, res: Response) => {
    try {
      const matchId = parseInt(req.params.matchId);
      if (isNaN(matchId)) return res.status(400).json({ message: 'Invalid match id' });
      const match = await LeagueMatchesService.getById(matchId);
      if (!match) return res.status(404).json({ message: 'Match not found' });
      const enrolled = await LeaguesService.isStudentEnrolled(match.league_id, req.user!.id);
      if (!enrolled)
        return res.status(403).json({ message: 'يجب الاشتراك في الدوري لعرض النتيجة' });
      const result = await LeagueMatchSolvingService.getStudentResult(matchId, req.user!.id);
      if (!result) return res.status(404).json({ message: 'لم يتم التسليم بعد' });
      res.json(result);
    } catch (error: any) {
      console.error('Error getting student match result:', error);
      res.status(500).json({ message: 'Failed to get match result', error: error.message });
    }
  },
);

// Get wrong questions with corrections (student only)
router.get('/matches/:matchId/wrong-questions', authMiddleware(['student']), async (req: Request, res: Response) => {
  try {
    const matchId = parseInt(req.params.matchId);
    if (isNaN(matchId)) return res.status(400).json({ message: 'Invalid match id' });
    const match = await LeagueMatchesService.getById(matchId);
    if (!match) return res.status(404).json({ message: 'Match not found' });
    const enrolled = await LeaguesService.isStudentEnrolled(match.league_id, req.user!.id);
    if (!enrolled) return res.status(403).json({ message: 'يجب الاشتراك في الدوري لعرض الأسئلة الخاطئة' });

    const result = await LeagueMatchSolvingService.getWrongQuestions(matchId, req.user!.id);
    if (!result) return res.status(404).json({ message: 'لم يتم التسليم بعد' });

    res.json({
      message: 'تم جلب الأسئلة الخاطئة بنجاح',
      ...result
    });
  } catch (error: any) {
    console.error('Error getting wrong questions:', error);
    res.status(500).json({ message: 'Failed to get wrong questions', error: error.message });
  }
});

// Start match for student (student only)
router.post('/matches/:matchId/start', authMiddleware(['student']), async (req: Request, res: Response) => {
  try {
    const matchId = parseInt(req.params.matchId);
    if (isNaN(matchId)) return res.status(400).json({ message: 'Invalid match id' });
    const match = await LeagueMatchesService.getById(matchId);
    if (!match) return res.status(404).json({ message: 'Match not found' });

    const enrolled = await LeaguesService.isStudentEnrolled(match.league_id, req.user!.id);
    if (!enrolled) return res.status(403).json({ message: 'يجب الاشتراك في الدوري لبدء المباراة' });

    if (match.is_visible === false) return res.status(403).json({ message: 'المباراة غير متاحة حالياً' });

    const result = await LeagueMatchSolvingService.startMatch(matchId, req.user!.id);

    if (result.already_started) {
      return res.status(409).json({
        message: result.message,
        previous_result: result.previous_result
      });
    }

    res.json({
      message: 'تم بدء المباراة بنجاح',
      ...result
    });
  } catch (error: any) {
    console.error('Error starting match:', error);
    res.status(500).json({ message: 'Failed to start match', error: error.message });
  }
});

// League leaderboard (admin or enrolled students)
router.get('/:id/leaderboard', authMiddleware(['admin', 'student']), async (req: Request, res: Response) => {
  try {
    const leagueId = parseInt(req.params.id);
    if (isNaN(leagueId)) return res.status(400).json({ message: 'Invalid league id' });

    const isStudent = req.user!.role === 'student';
    if (isStudent) {
      const enrolled = await LeaguesService.isStudentEnrolled(leagueId, req.user!.id);
      if (!enrolled) return res.status(403).json({ message: 'يجب الاشتراك في الدوري لعرض الترتيب' });
    }

    const limit = parseInt((req.query.limit as string) || '50'); // زيادة الحد الافتراضي لعرض جميع الطلاب
    const offset = parseInt((req.query.offset as string) || '0');

    // تمرير studentId للطلاب فقط
    const studentId = isStudent ? req.user!.id : undefined;
    const data = await LeaguesService.getLeaderboard(leagueId, limit, offset, studentId);

    res.json({
      message: 'تم جلب الترتيب بنجاح',
      ...data
    });
  } catch (error: any) {
    if (error.message === 'League not found') return res.status(404).json({ message: error.message });
    console.error('Error getting league leaderboard:', error);
    res.status(500).json({ message: 'Failed to get league leaderboard', error: error.message });
  }
});
