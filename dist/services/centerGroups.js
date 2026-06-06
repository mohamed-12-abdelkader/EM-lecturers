"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CenterGroupsService = void 0;
const jwt = __importStar(require("jsonwebtoken"));
const QRCode = __importStar(require("qrcode"));
const pool_1 = __importDefault(require("../db/pool"));
const utils_1 = require("../utils");
class CenterGroupsService {
    /**
     * Add student to center group
     * Creates a new student if needed, or uses existing one
     */
    static async addStudentToGroup(groupId, name, phone, parentPhone) {
        const client = await pool_1.default.connect();
        try {
            await client.query('BEGIN');
            let studentId;
            // If phone is provided, check if student already exists
            if (phone) {
                const existingStudentRes = await client.query(`SELECT id FROM users WHERE phone = $1 AND role = 'student'`, [phone]);
                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                // @ts-ignore
                if (existingStudentRes.rowCount > 0) {
                    // Student exists, use their ID
                    studentId = existingStudentRes.rows[0].id;
                    // Update name and parent_phone if provided
                    if (name || parentPhone) {
                        const updateFields = [];
                        const updateValues = [];
                        let paramIndex = 1;
                        if (name) {
                            updateFields.push(`name = $${paramIndex++}`);
                            updateValues.push(name);
                        }
                        if (parentPhone !== null) {
                            updateFields.push(`parent_phone = $${paramIndex++}`);
                            updateValues.push(parentPhone);
                        }
                        if (updateFields.length > 0) {
                            updateValues.push(studentId);
                            await client.query(`UPDATE users SET ${updateFields.join(', ')} WHERE id = $${paramIndex}`, updateValues);
                        }
                    }
                }
                else {
                    // Create new student
                    const randomPassword = Math.random().toString(36).slice(-8);
                    const newStudentRes = await client.query(`INSERT INTO users (name, phone, password, role, parent_phone)
             VALUES ($1, $2, $3, 'student', $4)
             RETURNING id`, [name, phone, randomPassword, parentPhone]);
                    studentId = newStudentRes.rows[0].id;
                }
            }
            else {
                // No phone provided, create new student with just name
                const randomPassword = Math.random().toString(36).slice(-8);
                const newStudentRes = await client.query(`INSERT INTO users (name, password, role, parent_phone)
           VALUES ($1, $2, 'student', $3)
           RETURNING id`, [name, randomPassword, parentPhone]);
                studentId = newStudentRes.rows[0].id;
            }
            // Check if student is already in group
            const existingMembershipRes = await client.query(`SELECT id FROM group_students WHERE group_id = $1 AND student_id = $2`, [groupId, studentId]);
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            if (existingMembershipRes.rowCount > 0) {
                throw new Error('الطالب موجود بالفعل في المجموعة');
            }
            // Next number_in_group for this group (1, 2, 3... per group)
            const nextNumRes = await client.query(`SELECT COALESCE(MAX(number_in_group), 0) + 1 AS next_num FROM group_students WHERE group_id = $1`, [groupId]);
            const numberInGroup = nextNumRes.rows[0].next_num;
            // Add student to group
            const membershipRes = await client.query(`INSERT INTO group_students (group_id, student_id, number_in_group)
         VALUES ($1, $2, $3)
         RETURNING id, student_id, number_in_group, joined_at`, [groupId, studentId, numberInGroup]);
            // Get student details
            const studentRes = await client.query(`SELECT id, name, phone, parent_phone FROM users WHERE id = $1`, [studentId]);
            await client.query('COMMIT');
            const membership = membershipRes.rows[0];
            const student = studentRes.rows[0];
            return {
                id: membership.id,
                number_in_group: membership.number_in_group,
                student_id: student.id,
                name: student.name,
                phone: student.phone,
                parent_phone: student.parent_phone,
                joined_at: membership.joined_at,
            };
        }
        catch (error) {
            try {
                await client.query('ROLLBACK');
            }
            catch {
                // Ignore rollback errors to preserve original failure reason
            }
            if (error?.message === 'الطالب موجود بالفعل في المجموعة') {
                utils_1.logger.warn({ groupId, name, phone }, 'Student already exists in center group');
            }
            else {
                utils_1.logger.error({ err: error, groupId, name, phone }, 'Error adding student to center group');
            }
            throw error;
        }
        finally {
            client.release();
        }
    }
    /**
     * Add multiple students to center group by names only
     */
    static async addStudentsByNamesToGroup(groupId, names) {
        const added = [];
        const errors = [];
        for (const rawName of names) {
            const name = rawName?.trim();
            if (!name) {
                errors.push({ name: rawName ?? '', error: 'Invalid student name' });
                continue;
            }
            try {
                const student = await CenterGroupsService.addStudentToGroup(groupId, name, null, null);
                added.push(student);
            }
            catch (error) {
                errors.push({
                    name,
                    error: error?.message || 'Failed to add student',
                });
            }
        }
        return {
            added,
            failed: errors.length,
            errors,
        };
    }
    /**
     * Get all students in a center group
     */
    static async getGroupStudents(groupId) {
        const result = await pool_1.default.query(`SELECT 
         gs.id,
         gs.number_in_group,
         gs.student_id,
         u.name,
         u.phone,
         u.parent_phone,
         gs.joined_at
       FROM group_students gs
       JOIN users u ON gs.student_id = u.id
       WHERE gs.group_id = $1
       ORDER BY gs.number_in_group ASC`, [groupId]);
        return result.rows.map((row) => ({
            id: row.id,
            number_in_group: row.number_in_group,
            student_id: row.student_id,
            name: row.name,
            phone: row.phone,
            parent_phone: row.parent_phone,
            joined_at: row.joined_at,
        }));
    }
    /**
     * Generate JWT payload for attendance QR code (groupId + studentId).
     * Used so the scan API can verify and record attendance.
     */
    static generateAttendanceQrPayload(groupId, studentId) {
        return jwt.sign({ groupId, studentId, type: 'attendance' }, utils_1.config.SECRET_KEY, { expiresIn: '365d' });
    }
    /**
     * Verify QR payload and return { groupId, studentId }.
     * @throws if token invalid or expired
     */
    static verifyAttendanceQrPayload(token) {
        const decoded = jwt.verify(token, utils_1.config.SECRET_KEY);
        if (decoded.type !== 'attendance' || typeof decoded.groupId !== 'number' || typeof decoded.studentId !== 'number') {
            throw new Error('Invalid attendance QR payload');
        }
        return { groupId: decoded.groupId, studentId: decoded.studentId };
    }
    /**
     * Generate QR code as Data URL (image) from a string payload.
     */
    static async generateQrDataUrl(payload) {
        return QRCode.toDataURL(payload, { margin: 2, width: 256 });
    }
    /**
     * Record attendance for a student in a center group
     */
    static async recordAttendance(groupId, studentId, date, status) {
        // Validate date format (YYYY-MM-DD)
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!dateRegex.test(date)) {
            throw new Error('Invalid date format. Use YYYY-MM-DD');
        }
        // Validate status
        if (!['present', 'absent'].includes(status)) {
            throw new Error("Status must be 'present' or 'absent'");
        }
        // Verify student is in group
        const membershipRes = await pool_1.default.query(`SELECT student_id FROM group_students WHERE group_id = $1 AND student_id = $2`, [groupId, studentId]);
        if (!membershipRes.rowCount) {
            throw new Error('Student is not a member of this group');
        }
        // Insert or update attendance
        const result = await pool_1.default.query(`INSERT INTO group_attendance (group_id, student_id, date, status)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (group_id, student_id, date)
       DO UPDATE SET status = EXCLUDED.status, updated_at = NOW()
       RETURNING id, student_id, date, status, created_at, updated_at`, [groupId, studentId, date, status]);
        // Get student details
        const studentRes = await pool_1.default.query(`SELECT id, name, phone FROM users WHERE id = $1`, [studentId]);
        const attendance = result.rows[0];
        const student = studentRes.rows[0];
        return {
            id: attendance.id,
            student_id: student.id,
            name: student.name,
            phone: student.phone,
            date: attendance.date,
            status: attendance.status,
            created_at: attendance.created_at,
            updated_at: attendance.updated_at,
        };
    }
    /**
     * Record attendance for multiple students at once
     */
    static async recordBulkAttendance(groupId, date, attendanceList) {
        // Validate date format
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!dateRegex.test(date)) {
            throw new Error('Invalid date format. Use YYYY-MM-DD');
        }
        const client = await pool_1.default.connect();
        let recorded = 0;
        let failed = 0;
        const errors = [];
        try {
            await client.query('BEGIN');
            // Verify all students are in group
            const studentIds = attendanceList.map((a) => a.student_id);
            const membersRes = await client.query(`SELECT student_id FROM group_students WHERE group_id = $1 AND student_id = ANY($2::int[])`, [groupId, studentIds]);
            const validStudentIds = new Set(membersRes.rows.map((r) => r.student_id));
            for (const entry of attendanceList) {
                try {
                    if (!validStudentIds.has(entry.student_id)) {
                        failed++;
                        errors.push(`Student ${entry.student_id} is not a member of this group`);
                        continue;
                    }
                    if (!['present', 'absent'].includes(entry.status)) {
                        failed++;
                        errors.push(`Invalid status for student ${entry.student_id}`);
                        continue;
                    }
                    await client.query(`INSERT INTO group_attendance (group_id, student_id, date, status)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (group_id, student_id, date)
             DO UPDATE SET status = EXCLUDED.status, updated_at = NOW()`, [groupId, entry.student_id, date, entry.status]);
                    recorded++;
                }
                catch (error) {
                    failed++;
                    errors.push(`Error recording attendance for student ${entry.student_id}: ${error.message}`);
                }
            }
            await client.query('COMMIT');
            return { recorded, failed, errors };
        }
        catch (error) {
            await client.query('ROLLBACK');
            throw error;
        }
        finally {
            client.release();
        }
    }
    /**
     * Get attendance for a specific date
     */
    static async getAttendanceByDate(groupId, date) {
        const result = await pool_1.default.query(`SELECT 
         ga.id,
         ga.student_id,
         u.name,
         u.phone,
         ga.date,
         ga.status,
         ga.created_at,
         ga.updated_at
       FROM group_attendance ga
       JOIN users u ON ga.student_id = u.id
       WHERE ga.group_id = $1 AND ga.date = $2
       ORDER BY u.name ASC`, [groupId, date]);
        return result.rows.map((row) => ({
            id: row.id,
            student_id: row.student_id,
            name: row.name,
            phone: row.phone,
            date: row.date,
            status: row.status,
            created_at: row.created_at,
            updated_at: row.updated_at,
        }));
    }
    /**
     * Get attendance summary for all students in group
     */
    static async getAttendanceSummary(groupId, startDate, endDate) {
        let query = `
      SELECT 
        u.id as student_id,
        u.name,
        u.phone,
        COUNT(ga.id) as total_days,
        COUNT(CASE WHEN ga.status = 'present' THEN 1 END) as present_days,
        COUNT(CASE WHEN ga.status = 'absent' THEN 1 END) as absent_days
      FROM group_students gs
      JOIN users u ON gs.student_id = u.id
      LEFT JOIN group_attendance ga ON ga.group_id = gs.group_id AND ga.student_id = u.id
    `;
        const params = [groupId];
        let paramIndex = 1;
        if (startDate && endDate) {
            query += ` WHERE gs.group_id = $${paramIndex++} AND ga.date BETWEEN $${paramIndex++} AND $${paramIndex++}`;
            params.push(startDate, endDate);
        }
        else {
            query += ` WHERE gs.group_id = $${paramIndex++}`;
        }
        query += `
      GROUP BY u.id, u.name, u.phone
      ORDER BY u.name ASC
    `;
        const result = await pool_1.default.query(query, params);
        return result.rows.map((row) => {
            const totalDays = parseInt(row.total_days || '0', 10);
            const presentDays = parseInt(row.present_days || '0', 10);
            const attendanceRate = totalDays > 0 ? Math.round((presentDays / totalDays) * 100) : 0;
            return {
                student_id: row.student_id,
                name: row.name,
                phone: row.phone,
                total_days: totalDays,
                present_days: presentDays,
                absent_days: parseInt(row.absent_days || '0', 10),
                attendance_rate: attendanceRate,
            };
        });
    }
    /**
     * Get attendance for a specific student in group
     */
    static async getStudentAttendance(groupId, studentId, startDate, endDate) {
        let query = `
      SELECT 
        ga.id,
        ga.student_id,
        u.name,
        u.phone,
        ga.date,
        ga.status,
        ga.created_at,
        ga.updated_at
      FROM group_attendance ga
      JOIN users u ON ga.student_id = u.id
      WHERE ga.group_id = $1 AND ga.student_id = $2
    `;
        const params = [groupId, studentId];
        if (startDate && endDate) {
            query += ` AND ga.date BETWEEN $3 AND $4`;
            params.push(startDate, endDate);
        }
        query += ` ORDER BY ga.date DESC`;
        const result = await pool_1.default.query(query, params);
        return result.rows.map((row) => ({
            id: row.id,
            student_id: row.student_id,
            name: row.name,
            phone: row.phone,
            date: row.date,
            status: row.status,
            created_at: row.created_at,
            updated_at: row.updated_at,
        }));
    }
}
exports.CenterGroupsService = CenterGroupsService;
