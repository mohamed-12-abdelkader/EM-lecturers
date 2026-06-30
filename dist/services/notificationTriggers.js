"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NotificationTriggers = void 0;
const notificationDispatchService_1 = require("./notificationDispatchService");
/**
 * Automatic notification triggers for platform events.
 * Call these from controllers/services when the corresponding business event occurs.
 */
class NotificationTriggers {
    static async onCoursePublished(userIds, courseTitle, courseId, url) {
        return notificationDispatchService_1.NotificationDispatchService.dispatchToUsers(userIds, {
            title: 'كورس جديد',
            body: `تم نشر كورس "${courseTitle}"`,
            type: 'course',
            url: url || `/courses/${courseId}`,
        });
    }
    static async onLessonAdded(userIds, lessonTitle, courseId, lectureId) {
        return notificationDispatchService_1.NotificationDispatchService.dispatchToUsers(userIds, {
            title: 'درس جديد',
            body: `تم إضافة درس "${lessonTitle}"`,
            type: 'lesson',
            url: lectureId ? `/courses/${courseId}/lectures/${lectureId}` : `/courses/${courseId}`,
            course_id: courseId,
        });
    }
    static async onExamAvailable(userIds, examTitle, courseId, examId) {
        return notificationDispatchService_1.NotificationDispatchService.dispatchToUsers(userIds, {
            title: 'امتحان متاح',
            body: `امتحان "${examTitle}" متاح الآن`,
            type: 'exam',
            url: examId ? `/courses/${courseId}/exams/${examId}` : `/courses/${courseId}`,
            course_id: courseId,
        });
    }
    static async onCoursePurchase(userId, courseTitle, courseId) {
        return notificationDispatchService_1.NotificationDispatchService.dispatchToUser({
            user_id: userId,
            title: 'تم شراء الكورس',
            body: `تم تفعيل كورس "${courseTitle}" بنجاح`,
            type: 'course_purchase',
            url: `/courses/${courseId}`,
            course_id: courseId,
        });
    }
    static async onAnnouncement(userIds, title, body, url) {
        return notificationDispatchService_1.NotificationDispatchService.dispatchToUsers(userIds, {
            title,
            body,
            type: 'announcement',
            url,
        });
    }
    static async onAssignmentDeadline(userId, assignmentTitle, courseId, assignmentId) {
        return notificationDispatchService_1.NotificationDispatchService.dispatchToUser({
            user_id: userId,
            title: 'موعد تسليم واجب',
            body: `اقترب موعد تسليم الواجب "${assignmentTitle}"`,
            type: 'assignment_deadline',
            url: assignmentId ? `/courses/${courseId}/assignments/${assignmentId}` : `/courses/${courseId}`,
            course_id: courseId,
        });
    }
    static async onPaymentConfirmed(userId, amount, description) {
        return notificationDispatchService_1.NotificationDispatchService.dispatchToUser({
            user_id: userId,
            title: 'تأكيد الدفع',
            body: description || `تم تأكيد دفع بمبلغ ${amount}`,
            type: 'payment_confirmed',
            url: '/payments',
        });
    }
    static async onCouponGenerated(userId, couponCode) {
        return notificationDispatchService_1.NotificationDispatchService.dispatchToUser({
            user_id: userId,
            title: 'كوبون جديد',
            body: `تم إنشاء كوبون: ${couponCode}`,
            type: 'coupon_generated',
            url: '/coupons',
            metadata: { coupon_code: couponCode },
        });
    }
    static async onCashbackAdded(userId, points) {
        return notificationDispatchService_1.NotificationDispatchService.dispatchToUser({
            user_id: userId,
            title: 'نقاط كاش باك',
            body: `تم إضافة ${points} نقطة إلى رصيدك`,
            type: 'cashback_added',
            url: '/wallet',
            metadata: { points },
        });
    }
}
exports.NotificationTriggers = NotificationTriggers;
