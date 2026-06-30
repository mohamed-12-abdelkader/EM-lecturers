"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TeacherManagedStudentsService = void 0;
exports.normalizeStudentCodeInput = normalizeStudentCodeInput;
const bcrypt_1 = __importDefault(require("bcrypt"));
const pool_1 = __importDefault(require("../db/pool"));
const utils_1 = require("../utils");
const teacherPlanPolicy_1 = require("./teacherPlanPolicy");
const DEFAULT_SETTINGS = {
    registration_mode: 'self_registration',
    default_password_from_phone: true,
};
function normalizeStudentCode(code) {
    return code.replace(/\D/g, '');
}
function normalizeStudentCodeInput(code) {
    return normalizeStudentCode(code);
}
async function loadTenantSettings(tenantId) {
    const r = await pool_1.default.query(`SELECT data FROM tenant_settings WHERE tenant_id = $1`, [tenantId]);
    return r.rows[0]?.data ?? {};
}
class TeacherManagedStudentsService {
    static async ensureSchema() {
        await pool_1.default.query(`
      CREATE SEQUENCE IF NOT EXISTS student_code_seq START WITH 10001
    `);
        await pool_1.default.query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS student_code VARCHAR(20),
        ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS managed_by_teacher_id INTEGER REFERENCES users(id) ON DELETE SET NULL
    `);
        await pool_1.default.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_users_student_code_unique
        ON users (student_code) WHERE student_code IS NOT NULL
    `);
        await pool_1.default.query(`
      UPDATE users
      SET student_code = regexp_replace(student_code, '[^0-9]', '', 'g')
      WHERE student_code IS NOT NULL AND student_code ~ '[^0-9]'
    `);
    }
    static async getRegistrationSettings(tenantId) {
        await this.ensureSchema();
        const data = await loadTenantSettings(tenantId);
        const mode = data.registration_mode;
        return {
            registration_mode: mode === 'teacher_registration' ? 'teacher_registration' : 'self_registration',
            default_password_from_phone: data.default_password_from_phone !== false,
        };
    }
    static async setRegistrationSettings(tenantId, patch) {
        await this.ensureSchema();
        const current = await this.getRegistrationSettings(tenantId);
        const next = {
            registration_mode: patch.registration_mode ?? current.registration_mode,
            default_password_from_phone: patch.default_password_from_phone ?? current.default_password_from_phone,
        };
        if (next.registration_mode !== 'self_registration' &&
            next.registration_mode !== 'teacher_registration') {
            throw new utils_1.HttpError(400, 'registration_mode غير صالح');
        }
        const data = await loadTenantSettings(tenantId);
        const merged = {
            ...data,
            registration_mode: next.registration_mode,
            default_password_from_phone: next.default_password_from_phone,
        };
        await pool_1.default.query(`INSERT INTO tenant_settings (tenant_id, data) VALUES ($1, $2::JSONB)
       ON CONFLICT (tenant_id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`, [tenantId, JSON.stringify(merged)]);
        return next;
    }
    static async isSelfRegistrationAllowed(tenantId) {
        const settings = await this.getRegistrationSettings(tenantId);
        return settings.registration_mode === 'self_registration';
    }
    static async assertTeacherOwnsTenant(teacherId, tenantId) {
        const r = await pool_1.default.query(`SELECT 1 FROM tenants WHERE id = $1 AND owner_user_id = $2 AND is_active = TRUE`, [tenantId, teacherId]);
        if (!r.rowCount) {
            throw new utils_1.HttpError(403, 'غير مصرح — هذه المنصة لا تخصك');
        }
    }
    static async generateStudentCode(client) {
        for (let attempt = 0; attempt < 15; attempt++) {
            const seq = await client.query(`SELECT LPAD(nextval('student_code_seq')::text, 5, '0') AS code`);
            const code = normalizeStudentCode(seq.rows[0].code);
            const exists = await client.query(`SELECT 1 FROM users WHERE student_code = $1`, [code]);
            if (!exists.rowCount)
                return code;
        }
        throw new utils_1.HttpError(500, 'تعذر توليد رقم الطالب');
    }
    static async assertGradeForTeacher(gradeId, teacherId) {
        const r = await pool_1.default.query(`SELECT 1 FROM teacher_grades WHERE teacher_id = $1 AND grade_id = $2`, [teacherId, gradeId]);
        if (!r.rowCount) {
            throw new utils_1.HttpError(400, 'الصف الدراسي غير مرتبط بهذا المدرس');
        }
    }
    static async assertGroupForTeacher(groupId, teacherId) {
        const r = await pool_1.default.query(`SELECT id, name FROM study_groups WHERE id = $1 AND teacher_id = $2`, [groupId, teacherId]);
        if (!r.rowCount) {
            throw new utils_1.HttpError(400, 'المجموعة غير موجودة أو لا تخصك');
        }
        return r.rows[0];
    }
    static async assignStudentToGroup(client, groupId, studentId) {
        const existing = await client.query(`SELECT group_id FROM group_students WHERE student_id = $1`, [studentId]);
        if (existing.rowCount) {
            if (Number(existing.rows[0].group_id) === groupId)
                return;
            await client.query(`DELETE FROM group_students WHERE student_id = $1`, [studentId]);
        }
        const numRes = await client.query(`SELECT COALESCE(MAX(number_in_group), 0) + 1 AS next_num
       FROM group_students WHERE group_id = $1`, [groupId]);
        const numberInGroup = Number(numRes.rows[0]?.next_num ?? 1);
        await client.query(`INSERT INTO group_students (group_id, student_id, number_in_group)
       VALUES ($1, $2, $3)
       ON CONFLICT (group_id, student_id) DO UPDATE SET number_in_group = EXCLUDED.number_in_group`, [groupId, studentId, numberInGroup]);
    }
    static async removeStudentFromGroups(client, studentId) {
        await client.query(`DELETE FROM group_students WHERE student_id = $1`, [studentId]);
    }
    static mapStudentRow(row) {
        return {
            id: row.id,
            student_code: row.student_code,
            name: row.name,
            phone: row.phone,
            parent_phone: row.parent_phone,
            email: row.email,
            avatar: row.avatar,
            account_status: row.account_status,
            must_change_password: row.must_change_password,
            created_at: row.created_at,
            grade: row.grade_id
                ? {
                    id: row.grade_id,
                    name: row.grade_name,
                    slug: row.grade_slug,
                }
                : null,
            group: row.group_id
                ? {
                    id: row.group_id,
                    name: row.group_name,
                }
                : null,
        };
    }
    static async createStudent(teacherId, tenantId, input) {
        await this.ensureSchema();
        await this.assertTeacherOwnsTenant(teacherId, tenantId);
        await this.assertGradeForTeacher(input.grade_id, teacherId);
        await (0, teacherPlanPolicy_1.enforceStudentLimit)(teacherId, tenantId);
        if (input.group_id) {
            await this.assertGroupForTeacher(input.group_id, teacherId);
        }
        const settings = await this.getRegistrationSettings(tenantId);
        if (input.phone) {
            const phoneTaken = await pool_1.default.query(`SELECT id FROM users WHERE phone = $1 AND tenant_id = $2`, [input.phone.trim(), tenantId]);
            if (phoneTaken.rowCount) {
                throw new utils_1.HttpError(400, 'رقم الهاتف مسجّل مسبقاً على هذه المنصة');
            }
        }
        let plainPassword = input.password?.trim() || null;
        let mustChangePassword = false;
        if (!plainPassword) {
            if (settings.registration_mode !== 'teacher_registration' &&
                input.use_phone_as_password !== false &&
                settings.default_password_from_phone &&
                input.phone) {
                plainPassword = input.phone.trim();
                mustChangePassword = true;
            }
            else {
                plainPassword = Math.random().toString(36).slice(-12);
                mustChangePassword = false;
            }
        }
        const hashed = await bcrypt_1.default.hash(plainPassword, 10);
        const client = await pool_1.default.connect();
        try {
            await client.query('BEGIN');
            const studentCode = await this.generateStudentCode(client);
            const insertRes = await client.query(`INSERT INTO users (
           name, phone, parent_phone, password, role, tenant_id,
           student_code, must_change_password, managed_by_teacher_id, account_status
         ) VALUES ($1, $2, $3, $4, 'student', $5, $6, $7, $8, 'active')
         RETURNING id, name, phone, parent_phone, student_code, must_change_password, account_status, created_at`, [
                input.name.trim(),
                input.phone?.trim() || null,
                input.parent_phone?.trim() || null,
                hashed,
                tenantId,
                studentCode,
                mustChangePassword,
                teacherId,
            ]);
            const student = insertRes.rows[0];
            await client.query(`INSERT INTO user_grades (user_id, grade_id) VALUES ($1, $2)
         ON CONFLICT DO NOTHING`, [student.id, input.grade_id]);
            if (input.group_id) {
                await this.assignStudentToGroup(client, input.group_id, student.id);
            }
            await client.query('COMMIT');
            const full = await this.getStudentById(teacherId, tenantId, student.id);
            return {
                student: full,
                credentials: {
                    student_code: studentCode,
                    login_with_code_only: settings.registration_mode === 'teacher_registration',
                    temporary_password: settings.registration_mode === 'teacher_registration'
                        ? undefined
                        : mustChangePassword
                            ? plainPassword
                            : undefined,
                    must_change_password: mustChangePassword,
                },
            };
        }
        catch (e) {
            await client.query('ROLLBACK');
            throw e;
        }
        finally {
            client.release();
        }
    }
    static async listStudents(teacherId, tenantId, filters = {}) {
        await this.ensureSchema();
        await this.assertTeacherOwnsTenant(teacherId, tenantId);
        const page = Math.max(filters.page ?? 1, 1);
        const limit = Math.min(Math.max(filters.limit ?? 20, 1), 100);
        const offset = (page - 1) * limit;
        const sort = filters.sort ?? 'created_at';
        const order = filters.order === 'asc' ? 'ASC' : 'DESC';
        const sortColumn = sort === 'name' ? 'u.name' : sort === 'student_code' ? 'u.student_code' : 'u.created_at';
        const conditions = [
            `u.role = 'student'`,
            `u.tenant_id = $1`,
            `u.managed_by_teacher_id = $2`,
        ];
        const values = [tenantId, teacherId];
        let i = 3;
        if (filters.search?.trim()) {
            conditions.push(`(u.name ILIKE $${i} OR u.student_code ILIKE $${i} OR u.phone ILIKE $${i} OR u.parent_phone ILIKE $${i})`);
            values.push(`%${filters.search.trim()}%`);
            i++;
        }
        if (filters.grade_id) {
            conditions.push(`EXISTS (
        SELECT 1 FROM user_grades ugf WHERE ugf.user_id = u.id AND ugf.grade_id = $${i++}
      )`);
            values.push(filters.grade_id);
        }
        if (filters.group_id) {
            conditions.push(`EXISTS (
        SELECT 1 FROM group_students gsf WHERE gsf.student_id = u.id AND gsf.group_id = $${i++}
      )`);
            values.push(filters.group_id);
        }
        if (filters.account_status) {
            conditions.push(`u.account_status = $${i++}`);
            values.push(filters.account_status);
        }
        const where = conditions.join(' AND ');
        const countRes = await pool_1.default.query(`SELECT COUNT(*)::text AS total
       FROM users u
       WHERE ${where}`, values);
        const listRes = await pool_1.default.query(`SELECT
         u.id, u.student_code, u.name, u.phone, u.parent_phone, u.email, u.avatar,
         u.account_status, u.must_change_password, u.created_at,
         g.id AS grade_id, g.name AS grade_name, g.slug AS grade_slug,
         sg.id AS group_id, sg.name AS group_name
       FROM users u
       LEFT JOIN LATERAL (
         SELECT grade_id FROM user_grades WHERE user_id = u.id ORDER BY grade_id LIMIT 1
       ) ug ON TRUE
       LEFT JOIN grades g ON g.id = ug.grade_id
       LEFT JOIN LATERAL (
         SELECT gs.group_id FROM group_students gs WHERE gs.student_id = u.id LIMIT 1
       ) gs_ref ON TRUE
       LEFT JOIN study_groups sg ON sg.id = gs_ref.group_id
       WHERE ${where}
       ORDER BY ${sortColumn} ${order}, u.id ASC
       LIMIT $${i++} OFFSET $${i++}`, [...values, limit, offset]);
        const students = listRes.rows.map((row) => this.mapStudentRow(row));
        return {
            students,
            pagination: {
                page,
                limit,
                total: Number(countRes.rows[0]?.total ?? 0),
                total_pages: Math.ceil(Number(countRes.rows[0]?.total ?? 0) / limit),
            },
        };
    }
    static async getStudentById(teacherId, tenantId, studentId) {
        await this.ensureSchema();
        await this.assertTeacherOwnsTenant(teacherId, tenantId);
        const r = await pool_1.default.query(`SELECT
         u.id, u.student_code, u.name, u.phone, u.parent_phone, u.email, u.avatar,
         u.account_status, u.must_change_password, u.created_at,
         g.id AS grade_id, g.name AS grade_name, g.slug AS grade_slug,
         sg.id AS group_id, sg.name AS group_name
       FROM users u
       LEFT JOIN LATERAL (
         SELECT grade_id FROM user_grades WHERE user_id = u.id ORDER BY grade_id LIMIT 1
       ) ug ON TRUE
       LEFT JOIN grades g ON g.id = ug.grade_id
       LEFT JOIN LATERAL (
         SELECT gs.group_id FROM group_students gs WHERE gs.student_id = u.id LIMIT 1
       ) gs_ref ON TRUE
       LEFT JOIN study_groups sg ON sg.id = gs_ref.group_id
       WHERE u.id = $1 AND u.role = 'student' AND u.tenant_id = $2 AND u.managed_by_teacher_id = $3
       LIMIT 1`, [studentId, tenantId, teacherId]);
        if (!r.rowCount)
            throw new utils_1.HttpError(404, 'الطالب غير موجود');
        return this.mapStudentRow(r.rows[0]);
    }
    static async updateStudent(teacherId, tenantId, studentId, input) {
        await this.getStudentById(teacherId, tenantId, studentId);
        if (input.grade_id != null) {
            await this.assertGradeForTeacher(input.grade_id, teacherId);
        }
        if (input.group_id != null && input.group_id > 0) {
            await this.assertGroupForTeacher(input.group_id, teacherId);
        }
        if (input.phone) {
            const phoneTaken = await pool_1.default.query(`SELECT id FROM users WHERE phone = $1 AND tenant_id = $2 AND id <> $3`, [input.phone.trim(), tenantId, studentId]);
            if (phoneTaken.rowCount) {
                throw new utils_1.HttpError(400, 'رقم الهاتف مسجّل مسبقاً على هذه المنصة');
            }
        }
        const client = await pool_1.default.connect();
        try {
            await client.query('BEGIN');
            const fields = [];
            const vals = [];
            let p = 1;
            if (input.name !== undefined) {
                fields.push(`name = $${p++}`);
                vals.push(input.name.trim());
            }
            if (input.phone !== undefined) {
                fields.push(`phone = $${p++}`);
                vals.push(input.phone?.trim() || null);
            }
            if (input.parent_phone !== undefined) {
                fields.push(`parent_phone = $${p++}`);
                vals.push(input.parent_phone?.trim() || null);
            }
            if (input.account_status !== undefined) {
                fields.push(`account_status = $${p++}`);
                vals.push(input.account_status);
            }
            if (fields.length) {
                vals.push(studentId);
                await client.query(`UPDATE users SET ${fields.join(', ')} WHERE id = $${p}`, vals);
            }
            if (input.grade_id != null) {
                await client.query(`DELETE FROM user_grades WHERE user_id = $1`, [studentId]);
                await client.query(`INSERT INTO user_grades (user_id, grade_id) VALUES ($1, $2)`, [
                    studentId,
                    input.grade_id,
                ]);
            }
            if (input.group_id !== undefined) {
                await this.removeStudentFromGroups(client, studentId);
                if (input.group_id) {
                    await this.assignStudentToGroup(client, input.group_id, studentId);
                }
            }
            await client.query('COMMIT');
        }
        catch (e) {
            await client.query('ROLLBACK');
            throw e;
        }
        finally {
            client.release();
        }
        return this.getStudentById(teacherId, tenantId, studentId);
    }
    static async resetPassword(teacherId, tenantId, studentId, options = {}) {
        const student = await this.getStudentById(teacherId, tenantId, studentId);
        let plain = options.new_password?.trim() || null;
        let mustChange = false;
        if (!plain) {
            if (options.use_phone_as_password !== false && student.phone) {
                plain = String(student.phone);
                mustChange = true;
            }
            else {
                plain = Math.random().toString(36).slice(-8);
                mustChange = true;
            }
        }
        const hashed = await bcrypt_1.default.hash(plain, 10);
        await pool_1.default.query(`UPDATE users SET password = $1, must_change_password = $2 WHERE id = $3`, [hashed, mustChange, studentId]);
        return {
            student_id: studentId,
            student_code: student.student_code,
            temporary_password: mustChange ? plain : undefined,
            must_change_password: mustChange,
        };
    }
    static async setAccountStatus(teacherId, tenantId, studentId, accountStatus) {
        await this.getStudentById(teacherId, tenantId, studentId);
        await pool_1.default.query(`UPDATE users SET account_status = $1 WHERE id = $2`, [
            accountStatus,
            studentId,
        ]);
        return this.getStudentById(teacherId, tenantId, studentId);
    }
    static async deleteStudent(teacherId, tenantId, studentId) {
        await this.getStudentById(teacherId, tenantId, studentId);
        const client = await pool_1.default.connect();
        try {
            await client.query('BEGIN');
            await client.query(`DELETE FROM group_students WHERE student_id = $1`, [studentId]);
            await client.query(`DELETE FROM user_grades WHERE user_id = $1`, [studentId]);
            await client.query(`DELETE FROM enrollments WHERE user_id = $1`, [studentId]);
            const del = await client.query(`DELETE FROM users
         WHERE id = $1 AND role = 'student' AND tenant_id = $2 AND managed_by_teacher_id = $3
         RETURNING id`, [studentId, tenantId, teacherId]);
            if (!del.rowCount) {
                throw new utils_1.HttpError(409, 'تعذر حذف الطالب — قد يكون مرتبطاً ببيانات أخرى');
            }
            await client.query('COMMIT');
            return { deleted: true, student_id: studentId };
        }
        catch (e) {
            await client.query('ROLLBACK');
            if (e.code === '23503') {
                throw new utils_1.HttpError(409, 'لا يمكن حذف الطالب لوجود سجلات مرتبطة. يمكنك إيقاف الحساب بدلاً من ذلك.');
            }
            throw e;
        }
        finally {
            client.release();
        }
    }
    static async findStudentByCode(studentCode, tenantId) {
        await this.ensureSchema();
        const normalized = normalizeStudentCode(studentCode);
        if (!normalized)
            return null;
        const r = await pool_1.default.query(`SELECT * FROM users
       WHERE tenant_id = $2 AND role = 'student'
         AND regexp_replace(COALESCE(student_code, ''), '[^0-9]', '', 'g') = $1
       LIMIT 1`, [normalized, tenantId]);
        return r.rows[0] ?? null;
    }
    static async resolveGradeId(teacherId, gradeRef) {
        const trimmed = gradeRef.trim();
        if (!trimmed)
            return null;
        if (/^\d+$/.test(trimmed)) {
            const id = Number(trimmed);
            await this.assertGradeForTeacher(id, teacherId);
            return id;
        }
        const r = await pool_1.default.query(`SELECT g.id
       FROM teacher_grades tg
       JOIN grades g ON g.id = tg.grade_id
       WHERE tg.teacher_id = $1 AND (g.name ILIKE $2 OR g.slug ILIKE $2)
       LIMIT 1`, [teacherId, trimmed]);
        if (!r.rowCount)
            throw new utils_1.HttpError(400, `الصف غير موجود: ${trimmed}`);
        return Number(r.rows[0].id);
    }
    static async resolveGroupId(teacherId, groupRef) {
        const trimmed = groupRef.trim();
        if (!trimmed)
            return null;
        if (/^\d+$/.test(trimmed)) {
            await this.assertGroupForTeacher(Number(trimmed), teacherId);
            return Number(trimmed);
        }
        const r = await pool_1.default.query(`SELECT id FROM study_groups WHERE teacher_id = $1 AND name ILIKE $2 LIMIT 1`, [teacherId, trimmed]);
        if (!r.rowCount)
            throw new utils_1.HttpError(400, `المجموعة غير موجودة: ${trimmed}`);
        return Number(r.rows[0].id);
    }
    static parseCsv(text) {
        const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim());
        if (lines.length < 2)
            return [];
        const splitLine = (line) => {
            const out = [];
            let cur = '';
            let inQuotes = false;
            for (let c = 0; c < line.length; c++) {
                const ch = line[c];
                if (ch === '"') {
                    inQuotes = !inQuotes;
                    continue;
                }
                if (ch === ',' && !inQuotes) {
                    out.push(cur.trim());
                    cur = '';
                    continue;
                }
                cur += ch;
            }
            out.push(cur.trim());
            return out;
        };
        const headers = splitLine(lines[0]).map((h) => h.toLowerCase().replace(/\s+/g, '_'));
        const rows = [];
        for (let i = 1; i < lines.length; i++) {
            const cols = splitLine(lines[i]);
            if (!cols.some((c) => c))
                continue;
            const row = {};
            headers.forEach((h, idx) => {
                row[h] = cols[idx]?.trim() ?? '';
            });
            rows.push(row);
        }
        return rows;
    }
    static async importStudents(teacherId, tenantId, csvText) {
        await this.ensureSchema();
        await this.assertTeacherOwnsTenant(teacherId, tenantId);
        const rows = this.parseCsv(csvText);
        const results = [];
        let created = 0;
        let failed = 0;
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const name = row.name ||
                row['الاسم'] ||
                row['الاسم_الثلاثي'] ||
                row.student_name ||
                '';
            const gradeRef = row.grade ||
                row.grade_id ||
                row['الصف'] ||
                row['الصف_الدراسي'] ||
                '';
            const phone = row.phone || row['رقم_الهاتف'] || row['هاتف_الطالب'] || '';
            const parentPhone = row.parent_phone || row['ولي_الامر'] || row['رقم_ولي_الامر'] || '';
            const groupRef = row.group || row.group_id || row['المجموعة'] || '';
            if (!name.trim()) {
                failed++;
                results.push({ row: i + 2, name: '', success: false, error: 'الاسم مطلوب' });
                continue;
            }
            if (!gradeRef.trim()) {
                failed++;
                results.push({
                    row: i + 2,
                    name: name.trim(),
                    success: false,
                    error: 'الصف الدراسي مطلوب',
                });
                continue;
            }
            try {
                const gradeId = await this.resolveGradeId(teacherId, gradeRef);
                if (!gradeId)
                    throw new utils_1.HttpError(400, 'الصف الدراسي غير صالح');
                let groupId = null;
                if (groupRef.trim()) {
                    groupId = await this.resolveGroupId(teacherId, groupRef);
                }
                const createdStudent = await this.createStudent(teacherId, tenantId, {
                    name: name.trim(),
                    grade_id: gradeId,
                    phone: phone.trim() || null,
                    parent_phone: parentPhone.trim() || null,
                    group_id: groupId,
                });
                created++;
                results.push({
                    row: i + 2,
                    name: name.trim(),
                    success: true,
                    student_id: Number(createdStudent.student.id),
                    student_code: createdStudent.credentials.student_code,
                });
            }
            catch (e) {
                failed++;
                results.push({
                    row: i + 2,
                    name: name.trim(),
                    success: false,
                    error: e instanceof utils_1.HttpError ? e.message : 'فشل إنشاء الطالب',
                });
            }
        }
        return {
            total_rows: rows.length,
            created_count: created,
            failed_count: failed,
            results,
        };
    }
}
exports.TeacherManagedStudentsService = TeacherManagedStudentsService;
