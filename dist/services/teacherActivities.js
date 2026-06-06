"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TeacherActivityService = void 0;
const pool_1 = __importDefault(require("../db/pool"));
class TeacherActivityService {
    /**
     * تسجيل نشاط جديد للمدرس
     */
    static async logActivity(activityData) {
        try {
            const result = await pool_1.default.query(`INSERT INTO teacher_activities 
         (teacher_id, activity_type, title, description, course_id, lecture_id, quiz_id, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id`, [
                activityData.teacher_id,
                activityData.activity_type,
                activityData.title,
                activityData.description,
                activityData.course_id,
                activityData.lecture_id,
                activityData.quiz_id,
                JSON.stringify(activityData.metadata || {}),
            ]);
            return { success: true, activityId: result.rows[0].id };
        }
        catch (error) {
            console.error('خطأ في تسجيل نشاط المدرس:', error);
            return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
        }
    }
    /**
     * جلب آخر نشاطات المدرس
     */
    static async getTeacherActivities(teacherId, limit = 20, offset = 0, activityType) {
        try {
            let query = `
        SELECT 
          ta.id,
          ta.activity_type,
          ta.title,
          ta.description,
          ta.course_id,
          ta.lecture_id,
          ta.quiz_id,
          ta.metadata,
          ta.created_at,
          c.title as course_title,
          l.title as lecture_title,
          q.title as quiz_title
        FROM teacher_activities ta
        LEFT JOIN courses c ON ta.course_id = c.id
        LEFT JOIN lectures l ON ta.lecture_id = l.id
        LEFT JOIN quizzes q ON ta.quiz_id = q.id
        WHERE ta.teacher_id = $1
      `;
            const params = [teacherId];
            let paramIndex = 2;
            if (activityType) {
                query += ` AND ta.activity_type = $${paramIndex}`;
                params.push(activityType);
                paramIndex++;
            }
            query += ` ORDER BY ta.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
            params.push(limit, offset);
            const result = await pool_1.default.query(query, params);
            return {
                success: true,
                activities: result.rows.map((row) => ({
                    id: row.id,
                    activity_type: row.activity_type,
                    title: row.title,
                    description: row.description,
                    course_id: row.course_id,
                    lecture_id: row.lecture_id,
                    quiz_id: row.quiz_id,
                    metadata: row.metadata,
                    created_at: row.created_at,
                    course_title: row.course_title,
                    lecture_title: row.lecture_title,
                    quiz_title: row.quiz_title,
                })),
            };
        }
        catch (error) {
            console.error('خطأ في جلب نشاطات المدرس:', error);
            return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
        }
    }
    /**
     * جلب إحصائيات نشاطات المدرس
     */
    static async getTeacherActivityStats(teacherId) {
        try {
            // إجمالي النشاطات
            const totalResult = await pool_1.default.query('SELECT COUNT(*) as total FROM teacher_activities WHERE teacher_id = $1', [teacherId]);
            // نشاطات هذا الشهر
            const monthlyResult = await pool_1.default.query(`SELECT COUNT(*) as monthly FROM teacher_activities 
         WHERE teacher_id = $1 AND created_at >= DATE_TRUNC('month', NOW())`, [teacherId]);
            // نشاطات هذا الأسبوع
            const weeklyResult = await pool_1.default.query(`SELECT COUNT(*) as weekly FROM teacher_activities 
         WHERE teacher_id = $1 AND created_at >= DATE_TRUNC('week', NOW())`, [teacherId]);
            // توزيع النشاطات حسب النوع
            const typeStatsResult = await pool_1.default.query(`SELECT activity_type, COUNT(*) as count 
         FROM teacher_activities 
         WHERE teacher_id = $1 
         GROUP BY activity_type 
         ORDER BY count DESC`, [teacherId]);
            return {
                success: true,
                stats: {
                    total: parseInt(totalResult.rows[0].total),
                    monthly: parseInt(monthlyResult.rows[0].monthly),
                    weekly: parseInt(weeklyResult.rows[0].weekly),
                    byType: typeStatsResult.rows.map((row) => ({
                        type: row.activity_type,
                        count: parseInt(row.count),
                    })),
                },
            };
        }
        catch (error) {
            console.error('خطأ في جلب إحصائيات نشاطات المدرس:', error);
            return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
        }
    }
    /**
     * تسجيل نشاط إنشاء كورس جديد
     */
    static async logCourseCreated(teacherId, courseId, courseTitle) {
        return await this.logActivity({
            teacher_id: teacherId,
            activity_type: 'course_created',
            title: 'تم إنشاء كورس جديد',
            description: `تم إنشاء كورس "${courseTitle}"`,
            course_id: courseId,
            metadata: { course_title: courseTitle },
        });
    }
    /**
     * تسجيل نشاط إضافة محاضرة جديدة
     */
    static async logLectureAdded(teacherId, courseId, lectureId, lectureTitle, courseTitle) {
        return await this.logActivity({
            teacher_id: teacherId,
            activity_type: 'lecture_added',
            title: 'تم إضافة محاضرة جديدة',
            description: `تم إضافة محاضرة "${lectureTitle}" في كورس "${courseTitle}"`,
            course_id: courseId,
            lecture_id: lectureId,
            metadata: {
                course_title: courseTitle,
                lecture_title: lectureTitle,
            },
        });
    }
    /**
     * تسجيل نشاط إضافة فيديو جديد
     */
    static async logVideoAdded(teacherId, courseId, lectureId, videoTitle, lectureTitle, courseTitle) {
        return await this.logActivity({
            teacher_id: teacherId,
            activity_type: 'video_added',
            title: 'تم إضافة فيديو جديد',
            description: `تم إضافة فيديو "${videoTitle}" في محاضرة "${lectureTitle}" من كورس "${courseTitle}"`,
            course_id: courseId,
            lecture_id: lectureId,
            metadata: {
                course_title: courseTitle,
                lecture_title: lectureTitle,
                video_title: videoTitle,
            },
        });
    }
    /**
     * تسجيل نشاط إضافة ملف جديد
     */
    static async logFileAdded(teacherId, courseId, lectureId, fileName, lectureTitle, courseTitle) {
        return await this.logActivity({
            teacher_id: teacherId,
            activity_type: 'file_added',
            title: 'تم إضافة ملف جديد',
            description: `تم إضافة ملف "${fileName}" في محاضرة "${lectureTitle}" من كورس "${courseTitle}"`,
            course_id: courseId,
            lecture_id: lectureId,
            metadata: {
                course_title: courseTitle,
                lecture_title: lectureTitle,
                file_name: fileName,
            },
        });
    }
    /**
     * تسجيل نشاط إنشاء اختبار جديد
     */
    static async logQuizCreated(teacherId, courseId, quizId, quizTitle, courseTitle) {
        return await this.logActivity({
            teacher_id: teacherId,
            activity_type: 'quiz_created',
            title: 'تم إنشاء اختبار جديد',
            description: `تم إنشاء اختبار "${quizTitle}" في كورس "${courseTitle}"`,
            course_id: courseId,
            quiz_id: quizId,
            metadata: {
                course_title: courseTitle,
                quiz_title: quizTitle,
            },
        });
    }
    /**
     * تسجيل نشاط إنشاء امتحان جديد
     */
    static async logExamCreated(teacherId, courseId, quizId, examTitle, courseTitle) {
        return await this.logActivity({
            teacher_id: teacherId,
            activity_type: 'exam_created',
            title: 'تم إنشاء امتحان جديد',
            description: `تم إنشاء امتحان "${examTitle}" في كورس "${courseTitle}"`,
            course_id: courseId,
            quiz_id: quizId,
            metadata: {
                course_title: courseTitle,
                exam_title: examTitle,
            },
        });
    }
}
exports.TeacherActivityService = TeacherActivityService;
