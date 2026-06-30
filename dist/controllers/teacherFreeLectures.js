"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.teacherRouter = exports.publicRouter = void 0;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const pool_1 = __importDefault(require("../db/pool"));
const authentication_1 = require("../middleware/authentication");
const utils_1 = require("../utils");
const uploadDir = node_path_1.default.join(process.cwd(), 'uploads/teacher-free-lectures');
node_fs_1.default.mkdirSync(uploadDir, { recursive: true });
const upload = (0, multer_1.default)({
    storage: multer_1.default.diskStorage({
        destination: (_req, _file, cb) => cb(null, uploadDir),
        filename: (_req, file, cb) => {
            const ext = node_path_1.default.extname(file.originalname || '');
            cb(null, `free-lecture-${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
        },
    }),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        const allowed = /jpeg|jpg|png|gif|webp/;
        const ok = allowed.test(node_path_1.default.extname(file.originalname).toLowerCase()) && allowed.test(file.mimetype);
        cb(null, ok);
    },
});
function parseBoolean(value, defaultValue) {
    if (value === undefined || value === null || value === '')
        return defaultValue;
    if (value === true || value === 1)
        return true;
    if (value === false || value === 0)
        return false;
    const v = String(value).trim().toLowerCase();
    return v === 'true' || v === '1' || v === 'yes';
}
function normalizeLink(link) {
    const trimmed = String(link ?? '').trim();
    if (!trimmed)
        throw new utils_1.HttpError(400, 'رابط المحاضرة مطلوب');
    if (!/^https?:\/\//i.test(trimmed)) {
        throw new utils_1.HttpError(400, 'الرابط يجب أن يبدأ بـ http:// أو https://');
    }
    return trimmed;
}
function normalizeTitle(title) {
    const trimmed = String(title ?? '').trim();
    if (!trimmed)
        throw new utils_1.HttpError(400, 'اسم المحاضرة مطلوب');
    return trimmed;
}
async function resolveImageUrl(file, bodyImageUrl) {
    if (file) {
        const uploaded = await (0, utils_1.uploadToCloudinary)(file.path);
        return uploaded.secure_url;
    }
    const url = String(bodyImageUrl ?? '').trim();
    return url || null;
}
async function verifyOwnership(lectureId, teacherId) {
    const result = await pool_1.default.query('SELECT * FROM teacher_free_lectures WHERE id = $1 AND teacher_id = $2', [lectureId, teacherId]);
    if (!result.rowCount)
        throw new utils_1.HttpError(404, 'المحاضرة غير موجودة');
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
exports.publicRouter = (0, express_1.Router)();
exports.publicRouter.get('/', (0, utils_1.asyncWrapper)(async (req, res) => {
    const teacherId = req.query.teacher_id ? Number(req.query.teacher_id) : null;
    const params = [];
    let where = 'WHERE l.is_published = TRUE';
    if (teacherId != null) {
        if (!Number.isInteger(teacherId) || teacherId <= 0) {
            throw new utils_1.HttpError(400, 'teacher_id غير صحيح');
        }
        params.push(teacherId);
        where += ` AND l.teacher_id = $${params.length}`;
    }
    const result = await pool_1.default.query(`${publicSelect} ${where} ORDER BY l.created_at DESC`, params);
    res.json({ success: true, lectures: result.rows });
}));
exports.publicRouter.get('/:id', (0, utils_1.asyncWrapper)(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0)
        throw new utils_1.HttpError(400, 'id غير صحيح');
    const result = await pool_1.default.query(`${publicSelect} WHERE l.id = $1 AND l.is_published = TRUE`, [id]);
    if (!result.rowCount)
        throw new utils_1.HttpError(404, 'المحاضرة غير موجودة');
    res.json({ success: true, lecture: result.rows[0] });
}));
// ========== Teacher CRUD ==========
exports.teacherRouter = (0, express_1.Router)();
exports.teacherRouter.post('/', (0, authentication_1.authMiddleware)(['teacher']), upload.single('image'), (0, utils_1.asyncWrapper)(async (req, res) => {
    const teacher_id = req.user.id;
    const title = normalizeTitle(req.body.title);
    const link = normalizeLink(req.body.link);
    const is_published = parseBoolean(req.body.is_published, true);
    const image_url = await resolveImageUrl(req.file, req.body.image_url);
    const result = await pool_1.default.query(`INSERT INTO teacher_free_lectures (teacher_id, title, link, image_url, is_published)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`, [teacher_id, title, link, image_url, is_published]);
    res.status(201).json({ success: true, lecture: result.rows[0] });
}));
exports.teacherRouter.get('/', (0, authentication_1.authMiddleware)(['teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const teacher_id = req.user.id;
    const result = await pool_1.default.query(`SELECT * FROM teacher_free_lectures
       WHERE teacher_id = $1
       ORDER BY created_at DESC`, [teacher_id]);
    res.json({ success: true, lectures: result.rows });
}));
exports.teacherRouter.get('/:id', (0, authentication_1.authMiddleware)(['teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const lecture = await verifyOwnership(Number(req.params.id), req.user.id);
    res.json({ success: true, lecture });
}));
exports.teacherRouter.put('/:id', (0, authentication_1.authMiddleware)(['teacher']), upload.single('image'), (0, utils_1.asyncWrapper)(async (req, res) => {
    const teacher_id = req.user.id;
    const lectureId = Number(req.params.id);
    const existing = await verifyOwnership(lectureId, teacher_id);
    const title = req.body.title !== undefined ? normalizeTitle(req.body.title) : existing.title;
    const link = req.body.link !== undefined ? normalizeLink(req.body.link) : existing.link;
    const is_published = req.body.is_published !== undefined
        ? parseBoolean(req.body.is_published, existing.is_published)
        : existing.is_published;
    let image_url = existing.image_url;
    if (req.file) {
        image_url = await resolveImageUrl(req.file);
    }
    else if (req.body.image_url !== undefined) {
        const url = String(req.body.image_url ?? '').trim();
        image_url = url || null;
    }
    const result = await pool_1.default.query(`UPDATE teacher_free_lectures
       SET title = $1, link = $2, image_url = $3, is_published = $4
       WHERE id = $5 AND teacher_id = $6
       RETURNING *`, [title, link, image_url, is_published, lectureId, teacher_id]);
    res.json({ success: true, lecture: result.rows[0] });
}));
exports.teacherRouter.delete('/:id', (0, authentication_1.authMiddleware)(['teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const teacher_id = req.user.id;
    const lectureId = Number(req.params.id);
    await verifyOwnership(lectureId, teacher_id);
    await pool_1.default.query('DELETE FROM teacher_free_lectures WHERE id = $1', [lectureId]);
    res.json({ success: true });
}));
