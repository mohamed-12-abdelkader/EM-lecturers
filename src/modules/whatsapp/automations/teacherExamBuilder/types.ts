export type ExamAssistantState =
  | 'IDLE'
  | 'CHECK_TEACHER_TASK'
  | 'ASK_GRADE'
  | 'ASK_COURSE'
  | 'ASK_LECTURE'
  | 'SELECT_EXAM_TYPE'
  | 'ASK_EXAM_SETTINGS'
  | 'ASK_SOURCE'
  | 'SELECT_LESSON'
  | 'WAITING_FOR_FILES'
  | 'PROCESSING_FILES'
  | 'EXTRACTING_QUESTIONS'
  | 'GENERATING_EXAM'
  | 'EXAM_REVIEW'
  | 'MODIFYING_EXAM'
  | 'SELECT_TARGET'
  | 'READY_TO_PUBLISH'
  | 'PUBLISHED'
  | 'FAILED'
  | 'CANCELLED';

export type ExamAssistantSourceType = 'question_bank' | 'files';

export type ExamAssistantExamType = 'general' | 'assignment' | 'comprehensive';

export type ExamAssistantMediaIntent =
  | 'create'
  | 'review'
  | 'add'
  | 'edit'
  | 'ask';

export type ExamAssistantSessionContext = {
  scheduled_task_id?: number | null;
  scheduled_task_title?: string | null;
  lesson_id?: number | null;
  lesson_name?: string | null;
  lesson_candidates?: Array<{ id: number; name: string; question_count: number }>;
  question_count?: number | null;
  duration_minutes?: number | null;
  total_grade?: number | null;
  exam_title?: string | null;
  question_types?: string | null;
  exam_type?: ExamAssistantExamType | null;
  grade_id?: number | null;
  grade_name?: string | null;
  grade_candidates?: Array<{ id: number; name: string }>;
  target_course_id?: number | null;
  target_course_title?: string | null;
  target_lecture_id?: number | null;
  target_lecture_title?: string | null;
  course_candidates?: Array<{ id: number; title: string; grade_id?: number | null }>;
  lecture_candidates?: Array<{ id: number; title: string; course_id: number }>;
  channel?: 'whatsapp' | 'web' | null;
  extracted_question_count?: number | null;
  extracted_bulk_text?: string | null;
  review_url?: string | null;
  publish_confirmed?: boolean;
  awaiting_more_files?: boolean;
  last_user_intent?: string | null;
  /** Last ~8 turns for natural conversation context */
  recent_turns?: Array<{ role: 'teacher' | 'assistant'; text: string; at: string }>;
  active_exam_id?: number | null;
  active_exam_kind?: 'lecture-exam' | 'course-exam' | null;
  recent_exam_ids?: Array<{ id: number; kind: 'lecture-exam' | 'course-exam'; at: string }>;
  pending_media_intent?: ExamAssistantMediaIntent | null;
  awaiting_clarification?: boolean;
  last_assistant_question?: string | null;
  pending_destructive_edit?: string | null;
};

export type ExamAssistantSessionRow = {
  id: number;
  teacher_id: number;
  tenant_id: number | null;
  conversation_id: number | null;
  contact_phone: string;
  state: ExamAssistantState;
  source_type: ExamAssistantSourceType | null;
  context: ExamAssistantSessionContext;
  exam_builder_session_id: string | null;
  draft_exam_id: number | null;
  draft_exam_kind: 'lecture-exam' | 'course-exam' | null;
  status: 'active' | 'completed' | 'cancelled' | 'failed';
  last_error: string | null;
  last_interaction_at: Date;
  created_at: Date;
  updated_at: Date;
};
