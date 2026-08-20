export type CourseFileRowLike = {
  id: number;
  course_id: number;
  teacher_id: number | null;
  uploaded_by: number | null;
  name: string;
  title: string;
  description: string | null;
  original_name: string | null;
  file_size: number | null;
  file_type: string | null;
  mime_type: string | null;
  created_at: string;
  updated_at: string;
};

export type CourseFilePublic = {
  id: number;
  courseId: number;
  teacherId: number | null;
  title: string;
  description: string | null;
  originalName: string | null;
  fileSize: number;
  mimeType: string;
  createdAt: string;
  updatedAt: string;
  viewUrl: string;
};

export function buildCourseFileViewPath(fileId: number): string {
  return `/api/course-files/${fileId}/view`;
}

export function sanitizeOriginalName(originalName: string | undefined | null): string {
  const raw = String(originalName || 'document.pdf').replace(/\\/g, '/');
  const base = raw.split('/').pop() || 'document.pdf';
  const cleaned = base.replace(/[\x00-\x1f<>:"|?*]/g, '_').trim().slice(0, 255);
  return cleaned || 'document.pdf';
}

export function serializeCourseFile(file: CourseFileRowLike): CourseFilePublic {
  return {
    id: file.id,
    courseId: file.course_id,
    teacherId: file.teacher_id ?? file.uploaded_by,
    title: file.title || file.name,
    description: file.description,
    originalName: file.original_name || file.name,
    fileSize: Number(file.file_size) || 0,
    mimeType: file.mime_type || file.file_type || 'application/pdf',
    createdAt: file.created_at,
    updatedAt: file.updated_at,
    viewUrl: buildCourseFileViewPath(file.id),
  };
}
