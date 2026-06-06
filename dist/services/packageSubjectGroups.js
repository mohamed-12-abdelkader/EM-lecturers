"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PackageSubjectGroupsService = void 0;
const pool_1 = __importDefault(require("../db/pool"));
class PackageSubjectGroupsService {
    static async createGroup(subjectItemId, input, createdBy) {
        const client = await pool_1.default.connect();
        try {
            await client.query('BEGIN');
            const groupRes = await client.query(`INSERT INTO package_subject_item_groups (package_subject_item_id, name, teacher_id, schedule_days, schedule_time, created_by)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`, [
                subjectItemId,
                input.name,
                input.teacher_id ?? null,
                input.schedule_days ?? null,
                input.schedule_time ?? null,
                createdBy,
            ]);
            const group = groupRes.rows[0];
            await client.query('COMMIT');
            return group;
        }
        catch (e) {
            await client.query('ROLLBACK');
            throw e;
        }
        finally {
            client.release();
        }
    }
    static async listGroupsForSubject(subjectItemId) {
        const res = await pool_1.default.query(`SELECT g.*, u.name AS teacher_name, u.avatar AS teacher_avatar
       FROM package_subject_item_groups g
       LEFT JOIN users u ON u.id = g.teacher_id
       WHERE g.package_subject_item_id = $1
       ORDER BY g.created_at DESC`, [subjectItemId]);
        return res.rows;
    }
    static async listTeacherGroupsForSubject(subjectItemId, teacherId) {
        const res = await pool_1.default.query(`SELECT g.*, u.name AS teacher_name, u.avatar AS teacher_avatar
       FROM package_subject_item_groups g
       LEFT JOIN users u ON u.id = g.teacher_id
       WHERE g.package_subject_item_id = $1 AND g.teacher_id = $2
       ORDER BY g.created_at DESC`, [subjectItemId, teacherId]);
        return res.rows;
    }
    // جلب مواد الباقة التي لدى المدرس مجموعات فيها (مع ملخص المجموعات)
    static async listTeacherSubjectsWithGroups(teacherId) {
        const res = await pool_1.default.query(`SELECT 
         psi.id AS subject_id,
         psi.package_id,
         psi.name AS subject_name,
         psi.image AS subject_image,
         p.name AS package_name,
         p.grade_id,
         COUNT(g.id) AS groups_count
       FROM package_subject_item_groups g
       JOIN package_subject_items psi ON psi.id = g.package_subject_item_id
       JOIN packages p ON p.id = psi.package_id
       WHERE g.teacher_id = $1
       GROUP BY psi.id, psi.package_id, psi.name, psi.image, p.name, p.grade_id
       ORDER BY psi.id DESC`, [teacherId]);
        // جلب المجموعات لكل مادة
        const subjectIds = res.rows.map((r) => r.subject_id);
        let groupsBySubject = new Map();
        if (subjectIds.length) {
            const groupsRes = await pool_1.default.query(`SELECT 
           g.id,
           g.package_subject_item_id AS subject_id,
           g.name,
           g.teacher_id,
           g.schedule_days,
           g.schedule_time,
           g.created_at
         FROM package_subject_item_groups g
         WHERE g.teacher_id = $1 AND g.package_subject_item_id = ANY($2::int[])
         ORDER BY g.created_at DESC`, [teacherId, subjectIds]);
            groupsBySubject = new Map();
            for (const row of groupsRes.rows) {
                const arr = groupsBySubject.get(row.subject_id) ?? [];
                arr.push(row);
                groupsBySubject.set(row.subject_id, arr);
            }
        }
        return res.rows.map((r) => ({
            id: r.subject_id,
            package_id: r.package_id,
            name: r.subject_name,
            image: r.subject_image,
            package_name: r.package_name,
            grade_id: r.grade_id,
            groups_count: Number(r.groups_count ?? 0),
            groups: groupsBySubject.get(r.subject_id) ?? [],
        }));
    }
    static async getGroupById(groupId) {
        const res = await pool_1.default.query(`SELECT * FROM package_subject_item_groups WHERE id = $1`, [groupId]);
        return res.rows[0] || null;
    }
    static async updateGroup(groupId, data) {
        const updates = [];
        const values = [];
        let i = 1;
        if (data.name !== undefined) {
            updates.push(`name = $${i++}`);
            values.push(data.name);
        }
        if (data.teacher_id !== undefined) {
            updates.push(`teacher_id = $${i++}`);
            values.push(data.teacher_id);
        }
        if (data.schedule_days !== undefined) {
            updates.push(`schedule_days = $${i++}`);
            values.push(data.schedule_days);
        }
        if (data.schedule_time !== undefined) {
            updates.push(`schedule_time = $${i++}`);
            values.push(data.schedule_time);
        }
        if (!updates.length) {
            return await this.getGroupById(groupId);
        }
        updates.push(`updated_at = NOW()`);
        values.push(groupId);
        const res = await pool_1.default.query(`UPDATE package_subject_item_groups
       SET ${updates.join(', ')}
       WHERE id = $${i}
       RETURNING *`, values);
        return res.rows[0] || null;
    }
    static async deleteGroup(groupId) {
        const res = await pool_1.default.query(`DELETE FROM package_subject_item_groups WHERE id = $1`, [groupId]);
        return (res.rowCount ?? 0) > 0;
    }
    static async teacherOwnsGroup(groupId, teacherId) {
        const res = await pool_1.default.query(`SELECT 1 FROM package_subject_item_groups WHERE id = $1 AND teacher_id = $2 LIMIT 1`, [groupId, teacherId]);
        return (res.rowCount ?? 0) > 0;
    }
    static async addStudentsToGroup(groupId, studentIds, addedBy) {
        if (!studentIds.length)
            return { added: 0 };
        const client = await pool_1.default.connect();
        try {
            await client.query('BEGIN');
            // determine subject for this group (once)
            const groupRes = await client.query(`SELECT package_subject_item_id FROM package_subject_item_groups WHERE id = $1`, [groupId]);
            if (!groupRes.rowCount) {
                throw new Error('المجموعة غير موجودة');
            }
            const subjectItemId = groupRes.rows[0].package_subject_item_id;
            // check students already assigned to another group in same subject
            const conflictRes = await client.query(`SELECT student_id
         FROM package_subject_item_group_students
         WHERE package_subject_item_id = $1 AND student_id = ANY($2::int[])
           AND group_id <> $3`, [subjectItemId, studentIds, groupId]);
            const blocked = new Set(conflictRes.rows.map((r) => r.student_id));
            let added = 0;
            let skipped_already_in_other_group = 0;
            for (const sid of studentIds) {
                if (blocked.has(sid)) {
                    skipped_already_in_other_group++;
                    continue;
                }
                const r = await client.query(`INSERT INTO package_subject_item_group_students (group_id, student_id, added_by)
           VALUES ($1, $2, $3)
           ON CONFLICT (group_id, student_id) DO NOTHING`, [groupId, sid, addedBy]);
                if ((r.rowCount ?? 0) > 0)
                    added++;
            }
            await client.query('COMMIT');
            return { added, skipped_already_in_other_group };
        }
        catch (e) {
            await client.query('ROLLBACK');
            throw e;
        }
        finally {
            client.release();
        }
    }
    static async listGroupStudents(groupId) {
        const res = await pool_1.default.query(`SELECT u.id, u.name, u.email, u.phone, u.avatar, gs.added_at
       FROM package_subject_item_group_students gs
       JOIN users u ON u.id = gs.student_id
       WHERE gs.group_id = $1
       ORDER BY gs.added_at DESC`, [groupId]);
        return res.rows;
    }
    static async removeStudentFromGroup(groupId, studentId) {
        const res = await pool_1.default.query(`DELETE FROM package_subject_item_group_students
       WHERE group_id = $1 AND student_id = $2`, [groupId, studentId]);
        return (res.rowCount ?? 0) > 0;
    }
    static async unassignTeacherFromGroup(groupId) {
        return await this.updateGroup(groupId, { teacher_id: null });
    }
    static async getStudentGroupForSubject(subjectItemId, studentId) {
        const res = await pool_1.default.query(`SELECT gs.group_id
       FROM package_subject_item_group_students gs
       JOIN package_subject_item_groups g ON g.id = gs.group_id
       WHERE gs.student_id = $1 AND g.package_subject_item_id = $2
       LIMIT 1`, [studentId, subjectItemId]);
        return res.rows[0]?.group_id ?? null;
    }
    static async getSchedule(groupId) {
        const res = await pool_1.default.query(`SELECT id, title, starts_at, ends_at
       FROM package_subject_item_group_schedules
       WHERE group_id = $1
       ORDER BY starts_at ASC`, [groupId]);
        return res.rows;
    }
}
exports.PackageSubjectGroupsService = PackageSubjectGroupsService;
