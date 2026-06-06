"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.canAccessCourseContent = canAccessCourseContent;
exports.canAccessLecture = canAccessLecture;
const pool_1 = __importDefault(require("../db/pool"));
const courseContent_1 = require("../services/courseContent");
/**
 * التحقق من صلاحية المستخدم للوصول لمحتوى الكورس
 * يدعم الكورسات العادية والكورسات في المواد الدراسية
 */
async function canAccessCourseContent(courseId, userId, userRole) {
    // Admin دائماً لديه صلاحية
    if (userRole === 'admin') {
        return true;
    }
    // Teacher - التحقق من ملكية الكورس
    if (userRole === 'teacher') {
        // التحقق من courses العادية
        const courseResult = await pool_1.default.query('SELECT 1 FROM courses WHERE id = $1 AND teacher_id = $2', [courseId, userId]);
        if (courseResult.rowCount) {
            return true;
        }
        // التحقق من subject_courses
        const subjectCourseResult = await pool_1.default.query('SELECT 1 FROM subject_courses WHERE id = $1 AND teacher_id = $2', [courseId, userId]);
        return (subjectCourseResult.rowCount ?? 0) > 0;
    }
    // Student - التحقق من الاشتراك أو تفعيل الباقة
    if (userRole === 'student') {
        return await courseContent_1.CourseContentService.canStudentAccessCourseContent(courseId, userId);
    }
    return false;
}
/**
 * التحقق من صلاحية المستخدم للوصول لمحاضرة معينة
 * @param lectureId - معرف المحاضرة
 * @param userId - معرف المستخدم
 * @param userRole - دور المستخدم
 */
async function canAccessLecture(lectureId, userId, userRole) {
    // Admin دائماً لديه صلاحية
    if (userRole === 'admin') {
        return true;
    }
    // جلب معلومات المحاضرة والكورس
    // المحاضرات قد تكون في lectures أو course_lectures
    let courseId = null;
    let lectureTable = 'lectures';
    // التحقق من course_lectures أولاً
    const courseLectureResult = await pool_1.default.query('SELECT course_id FROM course_lectures WHERE id = $1', [lectureId]);
    if (courseLectureResult.rowCount) {
        courseId = courseLectureResult.rows[0].course_id;
        lectureTable = 'course_lectures';
    }
    else {
        // التحقق من lectures
        const lectureResult = await pool_1.default.query('SELECT course_id FROM lectures WHERE id = $1', [
            lectureId,
        ]);
        if (lectureResult.rowCount) {
            courseId = lectureResult.rows[0].course_id;
            lectureTable = 'lectures';
        }
    }
    if (!courseId) {
        return false;
    }
    // استخدام canAccessCourseContent للتحقق من صلاحية الوصول للكورس
    return await canAccessCourseContent(courseId, userId, userRole);
}
