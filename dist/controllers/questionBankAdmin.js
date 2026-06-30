"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.router = void 0;
const express_1 = require("express");
const authentication_1 = require("../middleware/authentication");
const utils_1 = require("../utils");
const questionBank_1 = require("../services/questionBank");
const subjects_1 = require("../services/subjects");
const chapters_1 = require("../services/chapters");
const lessonsAdmin_1 = require("../services/lessonsAdmin");
const subjectBooks_1 = require("../services/subjectBooks");
const questionBankHierarchy_1 = require("../services/questionBankHierarchy");
const questionBank_2 = require("../db/types/questionBank");
const zod_1 = require("zod");
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const pool_1 = __importDefault(require("../db/pool"));
const questionBankChangeRequests_1 = require("../services/questionBankChangeRequests");
const router = (0, express_1.Router)();
exports.router = router;
const permissions_1 = require("../middleware/permissions");
// Admin or employee with permission
router.use((0, authentication_1.authMiddleware)(['admin', 'employee']));
router.use((0, permissions_1.checkPermission)('question_bank_management'));
// Setup multer for image uploads
const storage = multer_1.default.diskStorage({
    destination: (req, file, cb) => {
        const dir = path_1.default.join(__dirname, '../../uploads');
        fs_1.default.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        const uniqueName = `${Date.now()}-${file.originalname}`;
        cb(null, uniqueName);
    },
});
const upload = (0, multer_1.default)({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|gif|webp/;
        const extname = allowedTypes.test(path_1.default.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        if (mimetype && extname) {
            return cb(null, true);
        }
        else {
            cb(new Error('يجب أن تكون الصورة من نوع: jpeg, jpg, png, gif, webp'));
        }
    }
});
// POST /api/question-banks (create)
router.post('/', upload.single('image'), (0, utils_1.asyncWrapper)(async (req, res) => {
    try {
        const createData = { ...req.body };
        if (req.file) {
            try {
                const uploaded = await (0, utils_1.uploadToCloudinary)(req.file.path);
                createData.image_url = uploaded.secure_url;
            }
            catch (uploadError) {
                console.error('Error uploading image:', uploadError);
                return res.status(500).json({
                    success: false,
                    message: 'فشل في رفع الصورة',
                });
            }
        }
        const validatedData = questionBank_2.CreateQuestionBankSchema.parse(createData);
        const createdBy = req.user.id;
        const questionBank = await questionBank_1.QuestionBankService.create(validatedData, createdBy);
        res.status(201).json({
            success: true,
            message: 'تم إنشاء بنك الأسئلة بنجاح',
            data: questionBank,
        });
    }
    catch (error) {
        console.error('Error creating question bank:', error);
        if (error instanceof zod_1.z.ZodError) {
            return res.status(400).json({
                success: false,
                message: 'بيانات غير صحيحة',
                errors: error.errors,
            });
        }
        res.status(400).json({
            success: false,
            message: error instanceof Error ? error.message : 'فشل في إنشاء بنك الأسئلة',
        });
    }
}));
// GET /api/question-banks (list)
router.get('/', (0, utils_1.asyncWrapper)(async (req, res) => {
    try {
        const { page = 1, limit = 10, grade_id, is_active } = req.query;
        const result = await questionBank_1.QuestionBankService.list({
            page: Number(page),
            limit: Number(limit),
            grade_id: grade_id ? Number(grade_id) : undefined,
            is_active: is_active !== undefined ? is_active === 'true' : undefined,
        });
        res.json({
            success: true,
            data: result,
        });
    }
    catch (error) {
        console.error('Error listing question banks:', error);
        res.status(500).json({
            success: false,
            message: 'فشل في جلب قائمة بنوك الأسئلة',
        });
    }
}));
// GET /api/question-banks/:id/with-subjects (get by id with subjects)
// يجب أن يكون قبل /:id لتجنب التعارض
router.get('/:id/with-subjects', (0, utils_1.asyncWrapper)(async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (isNaN(id)) {
            return res.status(400).json({
                success: false,
                message: 'معرف بنك الأسئلة غير صحيح',
            });
        }
        const questionBank = await questionBank_1.QuestionBankService.getById(id);
        if (!questionBank) {
            return res.status(404).json({
                success: false,
                message: 'بنك الأسئلة غير موجود',
            });
        }
        // جلب المواد
        const subjects = await subjects_1.SubjectService.getByQuestionBank(id);
        // جلب المواد مع الكتب والفصول والدروس
        const subjectsWithBooks = await Promise.all(subjects.map(async (subject) => {
            const books = await (0, questionBankHierarchy_1.getSubjectBooksWithChaptersAndLessons)(subject.id);
            return {
                ...subject,
                books,
                // backward compatibility: flat chapters list across all books
                chapters: books.flatMap((b) => b.chapters),
            };
        }));
        res.json({
            success: true,
            data: {
                question_bank: questionBank,
                subjects: subjectsWithBooks,
            },
        });
    }
    catch (error) {
        console.error('Error getting question bank with subjects:', error);
        res.status(500).json({
            success: false,
            message: 'فشل في جلب بنك الأسئلة مع المواد',
        });
    }
}));
// GET /api/question-banks/:id (get by id)
router.get('/:id', (0, utils_1.asyncWrapper)(async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (isNaN(id)) {
            return res.status(400).json({
                success: false,
                message: 'معرف بنك الأسئلة غير صحيح',
            });
        }
        const questionBank = await questionBank_1.QuestionBankService.getById(id);
        res.json({
            success: true,
            data: questionBank,
        });
    }
    catch (error) {
        console.error('Error getting question bank:', error);
        res.status(404).json({
            success: false,
            message: error instanceof Error ? error.message : 'بنك الأسئلة غير موجود',
        });
    }
}));
// PUT /api/question-banks/:id (update)
router.put('/:id', upload.single('image'), (0, utils_1.asyncWrapper)(async (req, res) => {
    try {
        const id = Number(req.params.id);
        const user = req.user;
        if (isNaN(id)) {
            return res.status(400).json({
                success: false,
                message: 'فشل في تحديث بنك الأسئلة',
            });
        }
        // إعداد البيانات للتحديث
        const updateData = {};
        // معالجة الحقول النصية
        if (req.body.name !== undefined && req.body.name !== null && req.body.name !== '') {
            updateData.name = req.body.name;
        }
        if (req.body.description !== undefined && req.body.description !== null) {
            updateData.description = req.body.description;
        }
        if (req.body.grade_id !== undefined && req.body.grade_id !== null && req.body.grade_id !== '') {
            updateData.grade_id = Number(req.body.grade_id);
        }
        if (req.body.is_active !== undefined && req.body.is_active !== null && req.body.is_active !== '') {
            updateData.is_active = req.body.is_active === 'true' || req.body.is_active === true;
        }
        if (req.body.price !== undefined && req.body.price !== null && req.body.price !== '') {
            updateData.price = Number(req.body.price);
        }
        // معالجة رفع الصورة
        if (req.file) {
            try {
                const uploaded = await (0, utils_1.uploadToCloudinary)(req.file.path);
                updateData.image_url = uploaded.secure_url;
            }
            catch (uploadError) {
                console.error('Error uploading image:', uploadError);
                return res.status(500).json({
                    success: false,
                    message: 'فشل في رفع الصورة'
                });
            }
        }
        else if (req.body.image_url !== undefined && req.body.image_url !== null && req.body.image_url !== '') {
            // إذا تم إرسال image_url مباشرة (بدون رفع ملف)
            updateData.image_url = req.body.image_url;
        }
        // التحقق من وجود بيانات للتحديث
        if (Object.keys(updateData).length === 0) {
            return res.status(400).json({
                success: false,
                message: 'لا توجد بيانات للتحديث. يرجى إرسال حقل واحد على الأقل للتحديث (name, description, grade_id, is_active, price, image أو image_url)'
            });
        }
        // التحقق من صحة البيانات باستخدام Zod
        const validatedData = questionBank_2.UpdateQuestionBankSchema.parse(updateData);
        if (user.role === 'employee') {
            const request = await (0, questionBankChangeRequests_1.createQuestionBankChangeRequest)({
                entityType: 'question_bank',
                entityId: id,
                action: 'update',
                payload: validatedData,
                requestedBy: user.id,
            });
            return res.status(202).json({
                success: true,
                message: 'تم إرسال طلب تعديل بنك الأسئلة للأدمن للموافقة',
                data: request,
            });
        }
        const questionBank = await questionBank_1.QuestionBankService.update(id, validatedData);
        res.json({
            success: true,
            message: 'تم تحديث بنك الأسئلة بنجاح',
            data: questionBank
        });
    }
    catch (error) {
        console.error('Error updating question bank:', error);
        if (error instanceof zod_1.z.ZodError) {
            return res.status(400).json({
                success: false,
                message: 'بيانات غير صحيحة',
                errors: error.errors
            });
        }
        res.status(400).json({
            success: false,
            message: error instanceof Error ? error.message : 'فشل في تحديث بنك الأسئلة'
        });
    }
}));
// DELETE /api/question-banks/:id (delete)
router.delete('/:id', (0, utils_1.asyncWrapper)(async (req, res) => {
    try {
        const id = Number(req.params.id);
        const user = req.user;
        if (isNaN(id)) {
            return res.status(400).json({
                success: false,
                message: 'معرف بنك الأسئلة غير صحيح',
            });
        }
        if (user.role === 'employee') {
            const request = await (0, questionBankChangeRequests_1.createQuestionBankChangeRequest)({
                entityType: 'question_bank',
                entityId: id,
                action: 'delete',
                requestedBy: user.id,
            });
            return res.status(202).json({
                success: true,
                message: 'تم إرسال طلب حذف بنك الأسئلة للأدمن للموافقة',
                data: request,
            });
        }
        await questionBank_1.QuestionBankService.delete(id);
        res.json({
            success: true,
            message: 'تم حذف بنك الأسئلة بنجاح',
        });
    }
    catch (error) {
        console.error('Error deleting question bank:', error);
        res.status(400).json({
            success: false,
            message: error instanceof Error ? error.message : 'فشل في حذف بنك الأسئلة',
        });
    }
}));
// GET /api/question-banks/change-requests
router.get('/change-requests/all', (0, utils_1.asyncWrapper)(async (req, res) => {
    const status = String(req.query.status || 'pending');
    const result = await pool_1.default.query(`SELECT r.*, u.name AS requested_by_name, rv.name AS reviewed_by_name
       FROM question_bank_change_requests r
       LEFT JOIN users u ON u.id = r.requested_by
       LEFT JOIN users rv ON rv.id = r.reviewed_by
       WHERE ($1 = 'all' OR r.status = $1)
       ORDER BY r.created_at DESC`, [status]);
    res.status(200).json({ success: true, data: result.rows });
}));
// PATCH /api/question-banks/change-requests/:id/approve
router.patch('/change-requests/:id/approve', (0, utils_1.asyncWrapper)(async (req, res) => {
    const requestId = req.params.id;
    const adminId = req.user.id;
    const adminNote = req.body?.admin_note || null;
    const client = await pool_1.default.connect();
    try {
        await client.query('BEGIN');
        const reqRes = await client.query(`SELECT * FROM question_bank_change_requests WHERE id = $1 FOR UPDATE`, [requestId]);
        const request = reqRes.rows[0];
        if (!request) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, message: 'طلب غير موجود' });
        }
        if (request.status !== 'pending') {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, message: 'تمت مراجعة هذا الطلب مسبقاً' });
        }
        let applied = null;
        if (request.entity_type === 'question_bank' && request.action === 'update') {
            applied = await questionBank_1.QuestionBankService.update(request.entity_id, request.payload);
        }
        else if (request.entity_type === 'question_bank' && request.action === 'delete') {
            await questionBank_1.QuestionBankService.delete(request.entity_id);
            applied = { id: request.entity_id };
        }
        else if (request.entity_type === 'subject' && request.action === 'update') {
            const existing = await subjects_1.SubjectService.getById(request.entity_id);
            if (!existing)
                throw new Error('المادة غير موجودة');
            applied = await subjects_1.SubjectService.update(existing.question_bank_id, request.entity_id, request.payload);
        }
        else if (request.entity_type === 'subject' && request.action === 'delete') {
            const existing = await subjects_1.SubjectService.getById(request.entity_id);
            if (!existing)
                throw new Error('المادة غير موجودة');
            await subjects_1.SubjectService.delete(existing.question_bank_id, request.entity_id);
            applied = { id: request.entity_id };
        }
        else if (request.entity_type === 'book' && request.action === 'update') {
            applied = await subjectBooks_1.SubjectBookService.update(request.entity_id, request.payload);
        }
        else if (request.entity_type === 'book' && request.action === 'delete') {
            await subjectBooks_1.SubjectBookService.delete(request.entity_id);
            applied = { id: request.entity_id };
        }
        else if (request.entity_type === 'chapter' && request.action === 'update') {
            applied = await chapters_1.ChapterService.update(request.entity_id, request.payload);
        }
        else if (request.entity_type === 'chapter' && request.action === 'delete') {
            await chapters_1.ChapterService.delete(request.entity_id);
            applied = { id: request.entity_id };
        }
        else if (request.entity_type === 'lesson' && request.action === 'update') {
            applied = await lessonsAdmin_1.AdminLessonService.update(request.entity_id, request.payload);
        }
        else if (request.entity_type === 'lesson' && request.action === 'delete') {
            await lessonsAdmin_1.AdminLessonService.delete(request.entity_id);
            applied = { id: request.entity_id };
        }
        else {
            throw new Error('نوع طلب غير مدعوم');
        }
        const updateReq = await client.query(`UPDATE question_bank_change_requests
         SET status = 'approved', reviewed_by = $1, admin_note = $2, reviewed_at = NOW(), updated_at = NOW()
         WHERE id = $3
         RETURNING *`, [adminId, adminNote, requestId]);
        await client.query('COMMIT');
        return res.status(200).json({
            success: true,
            message: 'تمت الموافقة على الطلب وتنفيذه',
            data: { request: updateReq.rows[0], applied },
        });
    }
    catch (error) {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, message: error.message || 'فشل اعتماد الطلب' });
    }
    finally {
        client.release();
    }
}));
// PATCH /api/question-banks/change-requests/:id/reject
router.patch('/change-requests/:id/reject', (0, utils_1.asyncWrapper)(async (req, res) => {
    const requestId = req.params.id;
    const adminId = req.user.id;
    const adminNote = req.body?.admin_note || null;
    const result = await pool_1.default.query(`UPDATE question_bank_change_requests
       SET status = 'rejected', reviewed_by = $1, admin_note = $2, reviewed_at = NOW(), updated_at = NOW()
       WHERE id = $3 AND status = 'pending'
       RETURNING *`, [adminId, adminNote, requestId]);
    if (!result.rowCount) {
        return res.status(404).json({ success: false, message: 'الطلب غير موجود أو تمت مراجعته' });
    }
    return res.status(200).json({ success: true, message: 'تم رفض الطلب', data: result.rows[0] });
}));
