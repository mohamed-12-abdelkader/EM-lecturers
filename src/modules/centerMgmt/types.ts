export type GroupStatus = 'active' | 'paused';
export type EnrollmentStatus = 'active' | 'left';
export type SubscriptionStatus = 'paid' | 'unpaid' | 'partial' | 'exempt';
export type AttendanceStatus = 'present' | 'absent' | 'late' | 'excused';
export type AttendanceMethod = 'manual' | 'qr';
export type PaymentMethod = 'cash' | 'transfer' | 'vodafone_cash' | 'other';

export interface TcGroupRow {
  id: number;
  teacher_id: number;
  name: string;
  grade_id: number | null;
  subject_id: number | null;
  days: string[];
  start_time: string | null;
  end_time: string | null;
  monthly_fee: string;
  study_start_date: string | null;
  status: GroupStatus;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export interface TcGroupListItem extends TcGroupRow {
  grade_name?: string | null;
  subject_name?: string | null;
  students_count?: number;
}

export interface TcStudentRow {
  id: number;
  teacher_id: number;
  public_id: string;
  student_code: string;
  full_name: string;
  phone: string | null;
  parent_phone: string | null;
  notes: string | null;
  joined_at: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export interface TcStudentListItem extends TcStudentRow {
  groups?: Array<{
    id: number;
    name: string;
    status: EnrollmentStatus;
    member_no?: number | null;
  }>;
  /** When listed inside a group: the id starting from 1 in that group. */
  group_student_id?: number | null;
  member_no?: number | null;
  enrolled_at?: string;
  enrollment_status?: EnrollmentStatus;
  qr_token?: string | null;
  qr_image_base64?: string | null;
  exams?: TcStudentExamGrade[];
}

export interface TcStudentGroupRow {
  id: number;
  student_id: number;
  group_id: number;
  /** Sequential id inside the group (starts at 1 per group). */
  member_no: number | null;
  enrolled_at: string;
  status: EnrollmentStatus;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export interface TcQrCodeRow {
  id: number;
  student_id: number;
  qr_token: string;
  qr_payload: string;
  qr_image_base64: string | null;
  barcode: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface TcBillingMonthRow {
  id: number;
  teacher_id: number;
  year: number;
  month: number;
  opened_at: Date;
  opened_by: number | null;
  notes: string | null;
  created_at: Date;
}

export interface TcSubscriptionRow {
  id: number;
  teacher_id: number;
  student_id: number;
  group_id: number;
  year: number;
  month: number;
  status: SubscriptionStatus;
  amount_due: string;
  amount_paid: string;
  remaining: string;
  exemption_reason: string | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export interface TcSubscriptionListItem extends TcSubscriptionRow {
  student_name?: string;
  student_code?: string;
  student_phone?: string | null;
  group_name?: string;
}

export interface TcPaymentRow {
  id: number;
  teacher_id: number;
  student_id: number;
  group_id: number | null;
  subscription_id: number | null;
  year: number;
  month: number;
  amount: string;
  remaining_after: string;
  paid_at: Date;
  method: PaymentMethod;
  notes: string | null;
  recorded_by: number | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export interface TcAttendanceRow {
  id: number;
  teacher_id: number;
  group_id: number;
  student_id: number;
  attendance_date: string;
  day_name: string | null;
  status: AttendanceStatus;
  checked_in_at: Date | null;
  method: AttendanceMethod;
  notes: string | null;
  recorded_by: number | null;
  created_at: Date;
  updated_at: Date;
}

export interface TcAttendanceListItem extends TcAttendanceRow {
  student_name?: string;
  student_code?: string;
  group_name?: string;
}

export interface TcGroupExamRow {
  id: number;
  teacher_id: number;
  group_id: number;
  title: string;
  total_grade: string;
  exam_date: string | null;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export interface TcGroupExamListItem extends TcGroupExamRow {
  group_name?: string;
  students_count?: number;
  graded_count?: number;
  absent_count?: number;
  average_score?: number | null;
}

export interface TcGroupExamGradeRow {
  id: number;
  teacher_id: number;
  exam_id: number;
  student_id: number;
  score: string | null;
  is_absent: boolean;
  notes: string | null;
  recorded_by: number | null;
  created_at: Date;
  updated_at: Date;
}

export interface TcGroupExamGradeInput {
  student_id: number;
  score?: number | null;
  is_absent?: boolean;
  notes?: string | null;
}

export interface TcExamRosterStudent {
  student_id: number;
  full_name: string;
  student_code: string;
  member_no: number | null;
  score: number | null;
  is_absent: boolean;
  notes: string | null;
  percentage: number | null;
  recorded: boolean;
}

export interface TcStudentExamGrade {
  exam_id: number;
  title: string;
  group_id: number;
  group_name: string;
  total_grade: number;
  exam_date: string | null;
  score: number | null;
  is_absent: boolean;
  notes: string | null;
  percentage: number | null;
  recorded_at: Date;
}

export interface StudentAttendanceReport {
  student: {
    id: number;
    student_code: string;
    full_name: string;
  };
  group_id: number;
  group_name: string;
  from: string;
  to: string;
  totals: {
    present: number;
    absent: number;
    late: number;
    excused: number;
    total_days: number;
  };
  records: TcAttendanceListItem[];
}

export interface DashboardSummary {
  groups_count: number;
  students_count: number;
  active_students_count: number;
  current_month: { year: number; month: number } | null;
  finances: {
    expected: number;
    collected: number;
    remaining: number;
    paid_count: number;
    unpaid_count: number;
    partial_count: number;
    exempt_count: number;
  };
  today_attendance: {
    present: number;
    absent: number;
    late: number;
    excused: number;
  };
}
