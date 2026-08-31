export { teacherTrashRouter } from './trash.controller';
export { TeacherTrashService } from './trash.service';
export {
  recordTeacherTrashSnapshot,
  snapshotCourseBeforeDelete,
  snapshotLectureBeforeDelete,
  snapshotPlatformStudentBeforeDelete,
} from './recordDeletion';
export * from './types';
