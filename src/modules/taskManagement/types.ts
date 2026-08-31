export type TaskType = 'daily' | 'weekly';
export type TaskPriority = 'low' | 'medium' | 'high';
export type TemplateStatus = 'active' | 'cancelled' | 'archived';
export type AssignmentStatus = 'active' | 'cancelled';
export type InstanceStatus =
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'overdue'
  | 'cancelled'
  | 'missed';

export interface TaskTemplateRow {
  id: number;
  title: string;
  description: string | null;
  task_type: TaskType;
  priority: TaskPriority;
  start_date: string;
  end_date: string | null;
  scheduled_time: string | null;
  admin_notes: string | null;
  status: TemplateStatus;
  allow_attachments: boolean;
  created_by: number;
  created_at: Date;
  updated_at: Date;
}

export interface TaskInstanceRow {
  id: number;
  assignment_id: number;
  template_id: number;
  employee_id: number;
  instance_type: TaskType;
  period_start: string;
  period_end: string;
  status: InstanceStatus;
  due_at: Date | string | null;
  started_at: Date | string | null;
  completed_at: Date | string | null;
  employee_notes: string | null;
  reminder_sent_at: Date | string | null;
  created_at: Date;
  updated_at: Date;
}
