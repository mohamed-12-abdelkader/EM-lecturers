import { Router } from 'express';

import { router as authRouter } from './controllers/auth';
import { router as tenantsPublicRouter } from './controllers/tenantsPublic';
import { router as tenantsSuperRouter } from './controllers/tenantsSuper';
import { router as userRouter } from './controllers/user';
import { router as teacherRouter } from './controllers/teacher';
import { router as studentRouter } from './controllers/student';
import { router as utilsRouter } from './controllers/utils';
import { router as coursesRouter } from './controllers/courses';
import { router as teacherQuestionsRouter } from './controllers/teacherQuestions';
import { router as questionsManagementRouter } from './controllers/questionsManagement';
import { router as packagesRouter } from './controllers/packages';
import { router as subjectsRouter } from './controllers/subjects';
import { router as packageSubjectItemsRouter } from './controllers/packageSubjectItems';
import { router as packageSubjectExamsRouter } from './controllers/packageSubjectExams';
import { router as packageSubjectItemFilesRouter } from './controllers/packageSubjectItemFiles';
import { router as packageSubjectLessonsRouter } from './controllers/packageSubjectLessons';
import { router as packageSubjectLessonFilesRouter } from './controllers/packageSubjectLessonFiles';
import { router as teacherSubjectsRouter } from './controllers/teacherSubjects';
import { router as subjectCoursesRouter } from './controllers/subjectCourses';
import { router as courseContentRouter } from './controllers/courseContent';
import { router as studyGroupsRouter } from './controllers/studyGroups';
import { router as centerGroupsRouter } from './controllers/centerGroups';
import groupExamsRouter from './controllers/groupExams';
import { router as accountingRouter } from './controllers/accounting';
import { router as employeesRouter } from './controllers/employees';
import { router as tasksRouter } from './controllers/tasks';
import { router as studentGradesRouter } from './controllers/studentGrades';
import { router as meetingRouter } from './controllers/meeting';
import { router as competitionsRouter } from './controllers/competitions';
import { router as competitionQuestionsRouter } from './controllers/competitionQuestions';
import lessonMcqQuestionsRouter from './controllers/lessonMcqQuestions';
import { router as questionBankRouter } from './controllers/questionBank';
import { router as questionBankAdminRouter } from './controllers/questionBankAdmin';
import { router as questionBankSubjectsAdminRouter } from './controllers/questionBankSubjectsAdmin';
import { router as questionBankV2Router } from './controllers/questionBankV2';
import { router as subjectsAdminRouter } from './controllers/subjectsAdmin';
import { router as chaptersAdminRouter } from './controllers/chaptersAdmin';
import { router as lessonsAdminRouter } from './controllers/lessonsAdmin';
import { router as lectureCommentsRouter } from './controllers/lectureComments';
import { router as chatRouter } from './controllers/chat';
import { router as supportChatRouter } from './controllers/supportChat';
import { router as socialRouter } from './controllers/social';
import { router as teacherPermissionsAdminRouter } from './controllers/teacherPermissionsAdmin';
import { router as leaguesRouter } from './controllers/leagues';
import { router as generalCoursesRouter } from './controllers/generalCourses';
import { router as generalCourseGroupsRouter } from './controllers/generalCourseGroups';
import { router as generalCourseGroupMeetingRouter } from './controllers/generalCourseGroupMeeting';
import { router as generalCourseLecturesRouter } from './controllers/generalCourseLectures';
import essayExamRouter from './controllers/essayExam';
import { router as lessonQuestionsRouter } from './controllers/lessonQuestions';
import { router as lessonPdfQuestionsRouter } from './controllers/lessonPdfQuestions';
import { router as examsRouter } from './controllers/exams';
import { router as courseLevelExamQuestionsRouter } from './controllers/courseLevelExamQuestions';
import { router as courseAccessRouter } from './controllers/courseAccess';
import { router as courseEnrollmentsRouter } from './controllers/courseEnrollments';
import { router as scientificChatbotRouter } from './controllers/scientificChatbot';
import { gameRoutes } from './routes/game';
import { router as packageSubjectAssignmentsRouter } from './controllers/packageSubjectAssignments';
import { router as packageSubjectVideosRouter } from './controllers/packageSubjectVideos';
import { router as notificationsRouter } from './controllers/notifications';
import { router as customSheetsRouter } from './controllers/customSheets';
import { router as adminTeachersRouter } from './controllers/adminTeachers';
import { router as analyticsRouter } from './controllers/analytics';
import { router as analyticsTrackingRouter } from './controllers/analyticsTracking';

export const router = Router();

router.use('/tenants/public', tenantsPublicRouter);
router.use('/super/tenants', tenantsSuperRouter);
router.use('/', authRouter);
router.use('/users', userRouter);
router.use('/user', userRouter);
router.use('/teacher', teacherRouter);
router.use('/student', studentRouter);
router.use('/utils', utilsRouter);
router.use('/course', coursesRouter);
router.use('/chat', chatRouter);
router.use('/support', supportChatRouter);
router.use('/social', socialRouter);
// دعم المسار /api/v1/social المستخدم من التطبيق (نفس راوتر السوشيال)
router.use('/v1/social', socialRouter);
router.use('/admin/teachers', adminTeachersRouter);
router.use('/analytics', analyticsRouter);
router.use('/analytics/tracking', analyticsTrackingRouter);
router.use('/notifications', notificationsRouter);
router.use('/teacher/questions', teacherQuestionsRouter);
router.use('/questions', questionsManagementRouter);
router.use('/packages', packagesRouter);
router.use('/package-subjects', packageSubjectItemsRouter);
router.use('/package-subjects', packageSubjectExamsRouter);
router.use('/package-subjects', packageSubjectItemFilesRouter);
router.use('/course', packageSubjectLessonsRouter);
// توجيه جميع طلبات دروس المواد لهذا الراوتر (لضمان وصول الطلاب المشتركين)
// يجب أن يكون راوتر الدروس أولاً ليأخذ أولوية /subjects/:subjectId/lessons
router.use('/subjects', packageSubjectLessonsRouter);
router.use('/', packageSubjectLessonFilesRouter);
router.use('/subjects', subjectsRouter);
// Mount teacher routes early so they win over admin-guarded routers mounted at '/'
router.use('/', teacherSubjectsRouter);
router.use('/subject-courses', subjectCoursesRouter);
// Mount comments before other course-content routes to prevent accidental interception
router.use('/course-content', lectureCommentsRouter);
router.use('/course-content', courseContentRouter);
router.use('/study-groups', studyGroupsRouter);
router.use('/center-groups', centerGroupsRouter);
router.use('/group-exams', groupExamsRouter);
router.use('/accounting', accountingRouter);
router.use('/employees', employeesRouter);
router.use('/admin/employees', employeesRouter);
router.use('/tasks', tasksRouter);
router.use('/student-grades', studentGradesRouter);
router.use('/meeting', meetingRouter);
router.use('/competitions', competitionsRouter);
router.use('/competition-questions', competitionQuestionsRouter);
router.use('/leagues', leaguesRouter);

// --- Question Bank Administration (Moved up to avoid interception) ---
router.use('/subjects', subjectsAdminRouter);
router.use('/', chaptersAdminRouter);
router.use('/', lessonsAdminRouter);
// ----------------------------------------------------------------------

// ترتيب مهم: مسار /my-groups للمدرس ثم جلسات البث للمجموعات ثم generalCourses
router.use('/general-courses', generalCourseGroupsRouter);
router.use('/general-courses', generalCourseGroupMeetingRouter);
router.use('/general-courses', generalCoursesRouter);
router.use('/general-course-lectures', generalCourseLecturesRouter);
router.use('/essay-exams', essayExamRouter);
router.use('/', lessonMcqQuestionsRouter);
router.use('/lesson-questions', lessonQuestionsRouter);
router.use('/lesson-pdf-questions', lessonPdfQuestionsRouter);
// Mount student question bank routes BEFORE admin ones to avoid admin guard interception
router.use('/question-banks', questionBankRouter);
router.use('/question-banks', questionBankAdminRouter);
router.use('/question-banks', questionBankSubjectsAdminRouter);
router.use('/question-bank-v2', questionBankV2Router);
router.use('/exams', examsRouter);
router.use('/questions', courseLevelExamQuestionsRouter);
router.use('/', courseAccessRouter);
router.use('/', courseEnrollmentsRouter);
router.use('/scientific-chatbot', scientificChatbotRouter);
router.use('/', gameRoutes);
router.use('/custom-sheets', customSheetsRouter);
router.use('/', teacherPermissionsAdminRouter);
router.use('/', packageSubjectAssignmentsRouter);
router.use('/', packageSubjectVideosRouter);
