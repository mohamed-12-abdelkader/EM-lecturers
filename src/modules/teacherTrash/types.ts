export const TRASH_ENTITY_TYPES = [
  'center_group',
  'center_student',
  'center_enrollment',
  'center_exam',
  'center_payment',
  'center_subscription',
  'teacher_file',
  'course_file',
  'course',
  'lecture',
  'platform_student',
  'question',
  'lesson',
  'grade',
] as const;

export type TrashEntityType = (typeof TRASH_ENTITY_TYPES)[number];

export type TrashItemSource = 'live' | 'snapshot' | 'activity_log';

export type TrashListItem = {
  type: TrashEntityType | string;
  id: number;
  title: string;
  subtitle: string | null;
  deletedAt: string;
  canRestore: boolean;
  restoreBlockers: string[];
  source: TrashItemSource;
  metadata: Record<string, unknown>;
};

export type TrashListResult = {
  items: TrashListItem[];
  total: number;
  page: number;
  limit: number;
};

export type TrashSummaryItem = {
  type: string;
  count: number;
  label?: string;
};

export type RecordTrashSnapshotInput = {
  teacherId: number;
  tenantId?: number | null;
  entityType: TrashEntityType | string;
  entityId?: number | null;
  title: string;
  subtitle?: string | null;
  snapshot: Record<string, unknown>;
  deletedBy?: number | null;
  canRestore?: boolean;
  restoreBlockers?: string[];
};

export const TRASH_TYPE_LABELS: Record<string, string> = {
  center_group: 'مجموعة سنتر',
  center_student: 'طالب سنتر',
  center_enrollment: 'اشتراك طالب في مجموعة',
  center_exam: 'امتحان مجموعة',
  center_payment: 'دفعة',
  center_subscription: 'اشتراك شهري',
  teacher_file: 'ملف (ملفاتي)',
  course_file: 'ملف PDF كورس',
  course: 'كورس',
  lecture: 'محاضرة',
  platform_student: 'طالب منصة',
  question: 'سؤال',
  lesson: 'درس',
  grade: 'صف',
};
