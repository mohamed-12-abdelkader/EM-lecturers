import { describe, expect, it } from 'vitest';

import { sanitizeOriginalName, serializeCourseFile } from '../courseFiles.serialize';

describe('sanitizeOriginalName', () => {
  it('keeps a simple pdf name', () => {
    expect(sanitizeOriginalName('review.pdf')).toBe('review.pdf');
  });

  it('strips path traversal and control characters', () => {
    expect(sanitizeOriginalName('../etc/passwd.pdf')).toBe('passwd.pdf');
    expect(sanitizeOriginalName('a\nb.pdf')).toBe('a_b.pdf');
  });

  it('falls back when empty', () => {
    expect(sanitizeOriginalName('')).toBe('document.pdf');
    expect(sanitizeOriginalName(null)).toBe('document.pdf');
  });
});

describe('serializeCourseFile', () => {
  it('does not expose storage urls or keys', () => {
    const publicFile = serializeCourseFile({
      id: 12,
      course_id: 4,
      teacher_id: 9,
      uploaded_by: 9,
      name: 'مراجعة الوحدة الأولى',
      title: 'مراجعة الوحدة الأولى',
      description: 'مراجعة شاملة',
      original_name: 'review.pdf',
      file_size: 2450000,
      file_type: 'application/pdf',
      mime_type: 'application/pdf',
      created_at: '2026-08-20T08:00:00.000Z',
      updated_at: '2026-08-20T08:00:00.000Z',
    });

    expect(publicFile).toMatchObject({
      id: 12,
      courseId: 4,
      teacherId: 9,
      title: 'مراجعة الوحدة الأولى',
      originalName: 'review.pdf',
      fileSize: 2450000,
      mimeType: 'application/pdf',
      viewUrl: '/api/course-files/12/view',
    });
    expect(JSON.stringify(publicFile)).not.toContain('cloudinary');
    expect(JSON.stringify(publicFile)).not.toContain('file_key');
    expect(JSON.stringify(publicFile)).not.toContain('file_url');
  });
});
