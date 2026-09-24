import fs from 'node:fs';
import path from 'node:path';
import { Transform } from 'node:stream';
import { google } from 'googleapis';
import pool from '../db/pool';
import { config, HttpError, logger } from '../utils';
import {
  isInvalidGrantError,
  isYoutubeQuotaError,
  YoutubeConnectionService,
} from './youtubeConnection';
import type { MeetingRecordingTable } from './meetingRecordingUpload';

export type YoutubeUploadJobStatus =
  | 'queued'
  | 'uploading'
  | 'done'
  | 'failed'
  | 'needs_reauth';

export type YoutubeUploadJobRow = {
  id: number;
  meeting_id: string;
  meeting_table: MeetingRecordingTable;
  tenant_id: number | null;
  course_id: number | null;
  course_title: string | null;
  session_title: string;
  teacher_name: string | null;
  tenant_subdomain: string | null;
  file_path: string;
  file_size: string | number;
  status: YoutubeUploadJobStatus;
  progress_percent: number;
  bytes_uploaded: string | number;
  youtube_video_id: string | null;
  youtube_url: string | null;
  privacy_status: string;
  error_message: string | null;
  replace_existing: boolean;
  created_by: number | null;
  created_at: Date;
  updated_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
};

export type YoutubeSessionRow = {
  meeting_id: string;
  meeting_table: MeetingRecordingTable;
  session_title: string;
  status: string;
  egress_url: string | null;
  created_at: Date;
  updated_at: Date;
  course_id: number | null;
  course_title: string | null;
  teacher_id: number | null;
  teacher_name: string | null;
  tenant_id: number | null;
  tenant_subdomain: string | null;
  tenant_display_name: string | null;
  file_path: string;
  file_exists: boolean;
  file_size: number;
  already_on_youtube: boolean;
  latest_job: YoutubeUploadJobRow | null;
};

function recordingsDir(): string {
  return (config.RECORDINGS_DIR || '/recordings').replace(/\/$/, '');
}

export function recordingPathForMeeting(meetingId: string): string {
  return path.join(recordingsDir(), `${meetingId}.mp4`);
}

function isYoutubeUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return /youtube\.com\/watch|youtu\.be\//i.test(url);
}

function clipTitle(s: string): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length <= 100 ? t : `${t.slice(0, 97)}...`;
}

function fileMeta(meetingId: string): { file_path: string; file_exists: boolean; file_size: number } {
  const file_path = recordingPathForMeeting(meetingId);
  try {
    const st = fs.statSync(file_path);
    return { file_path, file_exists: st.isFile(), file_size: st.size };
  } catch {
    return { file_path, file_exists: false, file_size: 0 };
  }
}

export class YoutubeAdminUploadsService {
  static async listSessions(filters: {
    tenantId?: number;
    courseId?: number;
    search?: string;
    from?: string;
    to?: string;
    hasFile?: boolean;
    notOnYoutube?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<{ sessions: YoutubeSessionRow[]; total: number }> {
    const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
    const offset = Math.max(filters.offset ?? 0, 0);
    const params: unknown[] = [];
    const where: string[] = ['TRUE'];

    const push = (value: unknown) => {
      params.push(value);
      return `$${params.length}`;
    };

    if (filters.tenantId) {
      where.push(`tenant_id = ${push(filters.tenantId)}`);
    }
    if (filters.courseId) {
      where.push(`course_id = ${push(filters.courseId)}`);
    }
    if (filters.from) {
      where.push(`created_at >= ${push(filters.from)}::timestamptz`);
    }
    if (filters.to) {
      where.push(`created_at <= ${push(filters.to)}::timestamptz`);
    }
    if (filters.search?.trim()) {
      const q = `%${filters.search.trim()}%`;
      where.push(
        `(session_title ILIKE ${push(q)} OR course_title ILIKE ${push(q)} OR teacher_name ILIKE ${push(q)} OR tenant_subdomain ILIKE ${push(q)})`,
      );
    }
    if (filters.notOnYoutube) {
      where.push(
        `(egress_url IS NULL OR (egress_url NOT ILIKE '%youtube.com%' AND egress_url NOT ILIKE '%youtu.be%'))`,
      );
    }

    const unionSql = `
      SELECT
        m.id::text AS meeting_id,
        'meeting'::text AS meeting_table,
        m.title AS session_title,
        m.status,
        m.egress_url,
        m.created_at,
        m.updated_at,
        c.id AS course_id,
        c.title AS course_title,
        u.id AS teacher_id,
        u.name AS teacher_name,
        t.id AS tenant_id,
        t.subdomain AS tenant_subdomain,
        t.display_name AS tenant_display_name
      FROM meeting m
      JOIN courses c ON c.id = m.course_id
      JOIN users u ON u.id = c.teacher_id
      LEFT JOIN tenants t ON t.id = COALESCE(c.tenant_id, u.tenant_id)
      WHERE m.status = 'ended'

      UNION ALL

      SELECT
        gm.id::text AS meeting_id,
        'general_course_group_meeting'::text AS meeting_table,
        gm.title AS session_title,
        gm.status,
        gm.egress_url,
        gm.created_at,
        gm.updated_at,
        gc.id AS course_id,
        gc.title AS course_title,
        u.id AS teacher_id,
        u.name AS teacher_name,
        t.id AS tenant_id,
        t.subdomain AS tenant_subdomain,
        t.display_name AS tenant_display_name
      FROM general_course_group_meeting gm
      JOIN general_course_groups g ON g.id = gm.group_id
      JOIN general_courses gc ON gc.id = g.general_course_id
      JOIN users u ON u.id = gm.created_by
      LEFT JOIN tenants t ON t.id = u.tenant_id
      WHERE gm.status = 'ended'
    `;

    const filtered = `
      SELECT * FROM (${unionSql}) AS sessions
      WHERE ${where.join(' AND ')}
    `;

    const countRes = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM (${filtered}) x`,
      params,
    );
    const total = Number(countRes.rows[0]?.count || 0);

    const listParams = [...params, limit, offset];
    const listRes = await pool.query(
      `${filtered}
       ORDER BY created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      listParams,
    );

    const meetingIds = listRes.rows.map((r) => String(r.meeting_id));
    const jobsByMeeting = new Map<string, YoutubeUploadJobRow>();
    if (meetingIds.length) {
      const jobsRes = await pool.query<YoutubeUploadJobRow>(
        `SELECT DISTINCT ON (meeting_id) *
         FROM youtube_upload_jobs
         WHERE meeting_id = ANY($1::uuid[])
         ORDER BY meeting_id, created_at DESC`,
        [meetingIds],
      );
      for (const job of jobsRes.rows) {
        jobsByMeeting.set(String(job.meeting_id), job);
      }
    }

    let sessions: YoutubeSessionRow[] = listRes.rows.map((r) => {
      const meta = fileMeta(String(r.meeting_id));
      return {
        meeting_id: String(r.meeting_id),
        meeting_table: r.meeting_table as MeetingRecordingTable,
        session_title: r.session_title,
        status: r.status,
        egress_url: r.egress_url,
        created_at: r.created_at,
        updated_at: r.updated_at,
        course_id: r.course_id,
        course_title: r.course_title,
        teacher_id: r.teacher_id,
        teacher_name: r.teacher_name,
        tenant_id: r.tenant_id,
        tenant_subdomain: r.tenant_subdomain,
        tenant_display_name: r.tenant_display_name,
        file_path: meta.file_path,
        file_exists: meta.file_exists,
        file_size: meta.file_size,
        already_on_youtube: isYoutubeUrl(r.egress_url),
        latest_job: jobsByMeeting.get(String(r.meeting_id)) ?? null,
      };
    });

    if (filters.hasFile === true) {
      sessions = sessions.filter((s) => s.file_exists);
    } else if (filters.hasFile === false) {
      sessions = sessions.filter((s) => !s.file_exists);
    }

    return { sessions, total };
  }

  static async getJobs(ids?: number[]): Promise<YoutubeUploadJobRow[]> {
    if (ids?.length) {
      const res = await pool.query<YoutubeUploadJobRow>(
        `SELECT * FROM youtube_upload_jobs WHERE id = ANY($1::int[]) ORDER BY id ASC`,
        [ids],
      );
      return res.rows;
    }
    const res = await pool.query<YoutubeUploadJobRow>(
      `SELECT * FROM youtube_upload_jobs ORDER BY created_at DESC LIMIT 100`,
    );
    return res.rows;
  }

  static async enqueueUploads(input: {
    meetingIds: string[];
    createdBy: number;
    replace?: boolean;
  }): Promise<{ jobs: YoutubeUploadJobRow[]; skipped: Array<{ meeting_id: string; reason: string }> }> {
    const conn = await YoutubeConnectionService.getStatus();
    if (!conn.connected) {
      throw new HttpError(401, 'YouTube غير مربوط أو يحتاج إعادة تسجيل دخول', {
        code: 'needs_reauth',
      });
    }

    const replace = Boolean(input.replace);
    const jobs: YoutubeUploadJobRow[] = [];
    const skipped: Array<{ meeting_id: string; reason: string }> = [];

    for (const rawId of input.meetingIds) {
      const meetingId = String(rawId).trim();
      if (!meetingId) continue;

      const resolved = await this.resolveMeeting(meetingId);
      if (!resolved) {
        skipped.push({ meeting_id: meetingId, reason: 'الجلسة غير موجودة' });
        continue;
      }

      if (!replace && isYoutubeUrl(resolved.egress_url)) {
        skipped.push({ meeting_id: meetingId, reason: 'الجلسة على YouTube بالفعل' });
        continue;
      }

      const meta = fileMeta(meetingId);
      if (!meta.file_exists) {
        const failed = await pool.query<YoutubeUploadJobRow>(
          `INSERT INTO youtube_upload_jobs
             (meeting_id, meeting_table, tenant_id, course_id, course_title, session_title,
              teacher_name, tenant_subdomain, file_path, file_size, status, error_message,
              replace_existing, created_by, finished_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'failed',$11,$12,$13,NOW())
           RETURNING *`,
          [
            meetingId,
            resolved.meeting_table,
            resolved.tenant_id,
            resolved.course_id,
            resolved.course_title,
            resolved.session_title,
            resolved.teacher_name,
            resolved.tenant_subdomain,
            meta.file_path,
            0,
            'ملف التسجيل غير موجود على القرص',
            replace,
            input.createdBy,
          ],
        );
        jobs.push(failed.rows[0]);
        continue;
      }

      const active = await pool.query(
        `SELECT id FROM youtube_upload_jobs
         WHERE meeting_id = $1 AND status IN ('queued', 'uploading')
         LIMIT 1`,
        [meetingId],
      );
      if (active.rowCount) {
        skipped.push({ meeting_id: meetingId, reason: 'رفع قيد التنفيذ بالفعل' });
        continue;
      }

      const inserted = await pool.query<YoutubeUploadJobRow>(
        `INSERT INTO youtube_upload_jobs
           (meeting_id, meeting_table, tenant_id, course_id, course_title, session_title,
            teacher_name, tenant_subdomain, file_path, file_size, status, replace_existing, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'queued',$11,$12)
         RETURNING *`,
        [
          meetingId,
          resolved.meeting_table,
          resolved.tenant_id,
          resolved.course_id,
          resolved.course_title,
          resolved.session_title,
          resolved.teacher_name,
          resolved.tenant_subdomain,
          meta.file_path,
          meta.file_size,
          replace,
          input.createdBy,
        ],
      );
      jobs.push(inserted.rows[0]);
    }

    return { jobs, skipped };
  }

  static async retryJob(jobId: number, adminId: number): Promise<YoutubeUploadJobRow> {
    const conn = await YoutubeConnectionService.getStatus();
    if (!conn.connected) {
      throw new HttpError(401, 'YouTube غير مربوط أو يحتاج إعادة تسجيل دخول', {
        code: 'needs_reauth',
      });
    }

    const existing = await pool.query<YoutubeUploadJobRow>(
      `SELECT * FROM youtube_upload_jobs WHERE id = $1`,
      [jobId],
    );
    if (!existing.rowCount) throw new HttpError(404, 'المهمة غير موجودة');
    const job = existing.rows[0];
    if (!['failed', 'needs_reauth'].includes(job.status)) {
      throw new HttpError(400, 'يمكن إعادة المحاولة للمهام الفاشلة فقط');
    }

    const meta = fileMeta(String(job.meeting_id));
    if (!meta.file_exists) {
      throw new HttpError(400, 'ملف التسجيل غير موجود على القرص');
    }

    const updated = await pool.query<YoutubeUploadJobRow>(
      `UPDATE youtube_upload_jobs SET
         status = 'queued',
         progress_percent = 0,
         bytes_uploaded = 0,
         error_message = NULL,
         youtube_video_id = NULL,
         youtube_url = NULL,
         file_path = $1,
         file_size = $2,
         started_at = NULL,
         finished_at = NULL,
         updated_at = NOW(),
         created_by = COALESCE(created_by, $3)
       WHERE id = $4
       RETURNING *`,
      [meta.file_path, meta.file_size, adminId, jobId],
    );
    return updated.rows[0];
  }

  private static async resolveMeeting(meetingId: string): Promise<{
    meeting_table: MeetingRecordingTable;
    session_title: string;
    egress_url: string | null;
    course_id: number | null;
    course_title: string | null;
    teacher_name: string | null;
    tenant_id: number | null;
    tenant_subdomain: string | null;
  } | null> {
    const regular = await pool.query(
      `SELECT m.title, m.egress_url, c.id AS course_id, c.title AS course_title,
              u.name AS teacher_name, t.id AS tenant_id, t.subdomain AS tenant_subdomain
       FROM meeting m
       JOIN courses c ON c.id = m.course_id
       JOIN users u ON u.id = c.teacher_id
       LEFT JOIN tenants t ON t.id = COALESCE(c.tenant_id, u.tenant_id)
       WHERE m.id = $1
       LIMIT 1`,
      [meetingId],
    );
    if (regular.rowCount) {
      const r = regular.rows[0];
      return {
        meeting_table: 'meeting',
        session_title: r.title,
        egress_url: r.egress_url,
        course_id: r.course_id,
        course_title: r.course_title,
        teacher_name: r.teacher_name,
        tenant_id: r.tenant_id,
        tenant_subdomain: r.tenant_subdomain,
      };
    }

    const group = await pool.query(
      `SELECT gm.title, gm.egress_url, gc.id AS course_id, gc.title AS course_title,
              u.name AS teacher_name, t.id AS tenant_id, t.subdomain AS tenant_subdomain
       FROM general_course_group_meeting gm
       JOIN general_course_groups g ON g.id = gm.group_id
       JOIN general_courses gc ON gc.id = g.general_course_id
       JOIN users u ON u.id = gm.created_by
       LEFT JOIN tenants t ON t.id = u.tenant_id
       WHERE gm.id = $1
       LIMIT 1`,
      [meetingId],
    );
    if (!group.rowCount) return null;
    const r = group.rows[0];
    return {
      meeting_table: 'general_course_group_meeting',
      session_title: r.title,
      egress_url: r.egress_url,
      course_id: r.course_id,
      course_title: r.course_title,
      teacher_name: r.teacher_name,
      tenant_id: r.tenant_id,
      tenant_subdomain: r.tenant_subdomain,
    };
  }

  static async claimNextQueuedJob(): Promise<YoutubeUploadJobRow | null> {
    const conn = await YoutubeConnectionService.getActiveConnection();
    if (!conn || conn.status !== 'connected') return null;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const res = await client.query<YoutubeUploadJobRow>(
        `SELECT * FROM youtube_upload_jobs
         WHERE status = 'queued'
         ORDER BY id ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED`,
      );
      if (!res.rowCount) {
        await client.query('COMMIT');
        return null;
      }
      const updated = await client.query<YoutubeUploadJobRow>(
        `UPDATE youtube_upload_jobs SET
           status = 'uploading',
           started_at = COALESCE(started_at, NOW()),
           updated_at = NOW(),
           progress_percent = 0,
           bytes_uploaded = 0,
           error_message = NULL
         WHERE id = $1
         RETURNING *`,
        [res.rows[0].id],
      );
      await client.query('COMMIT');
      return updated.rows[0];
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  static async updateProgress(jobId: number, bytesUploaded: number, total: number): Promise<void> {
    const percent = total > 0 ? Math.min(99, Math.floor((bytesUploaded / total) * 100)) : 0;
    await pool.query(
      `UPDATE youtube_upload_jobs SET
         bytes_uploaded = $1,
         progress_percent = $2,
         updated_at = NOW()
       WHERE id = $3 AND status = 'uploading'`,
      [bytesUploaded, percent, jobId],
    );
  }

  static async markDone(jobId: number, videoId: string, youtubeUrl: string): Promise<void> {
    const jobRes = await pool.query<YoutubeUploadJobRow>(
      `UPDATE youtube_upload_jobs SET
         status = 'done',
         progress_percent = 100,
         youtube_video_id = $1,
         youtube_url = $2,
         error_message = NULL,
         finished_at = NOW(),
         updated_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [videoId, youtubeUrl, jobId],
    );
    const job = jobRes.rows[0];
    if (!job) return;

    if (job.meeting_table === 'meeting') {
      await pool.query(
        `UPDATE meeting SET egress_url = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
        [youtubeUrl, job.meeting_id],
      );
    } else {
      await pool.query(
        `UPDATE general_course_group_meeting SET egress_url = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
        [youtubeUrl, job.meeting_id],
      );
    }
  }

  static async markFailed(jobId: number, message: string, status: YoutubeUploadJobStatus = 'failed'): Promise<void> {
    await pool.query(
      `UPDATE youtube_upload_jobs SET
         status = $1,
         error_message = $2,
         finished_at = NOW(),
         updated_at = NOW()
       WHERE id = $3`,
      [status, message.slice(0, 2000), jobId],
    );
  }

  static async processJob(job: YoutubeUploadJobRow): Promise<void> {
    const filePath = job.file_path || recordingPathForMeeting(String(job.meeting_id));
    if (!fs.existsSync(filePath)) {
      await this.markFailed(job.id, 'ملف التسجيل غير موجود على القرص');
      return;
    }

    const total = fs.statSync(filePath).size;
    const title = clipTitle(
      job.course_title ? `${job.session_title} — ${job.course_title}` : job.session_title,
    );
    const description = [
      job.course_title ? `الكورس: ${job.course_title}` : null,
      `الجلسة: ${job.session_title}`,
      job.teacher_name ? `المدرس: ${job.teacher_name}` : null,
      job.tenant_subdomain ? `المنصة: ${job.tenant_subdomain}` : null,
      `meeting_id: ${job.meeting_id}`,
    ]
      .filter(Boolean)
      .join('\n');

    let lastPersist = 0;
    const source = fs.createReadStream(filePath);
    let uploaded = 0;
    const counter = new Transform({
      transform(chunk, _enc, cb) {
        uploaded += chunk.length;
        const now = Date.now();
        if (now - lastPersist >= 2000 || uploaded === total) {
          lastPersist = now;
          void YoutubeAdminUploadsService.updateProgress(job.id, uploaded, total).catch(() => undefined);
        }
        cb(null, chunk);
      },
    });
    const body = source.pipe(counter);

    try {
      const auth = await YoutubeConnectionService.getAuthenticatedClient();
      const youtube = google.youtube({ version: 'v3', auth });
      const response = await youtube.videos.insert({
        part: ['snippet', 'status'],
        requestBody: {
          snippet: {
            title,
            description,
            tags: ['E-M online', 'live-session', String(job.course_id || '')].filter(Boolean),
            categoryId: '27',
          },
          status: {
            privacyStatus: (job.privacy_status as 'unlisted' | 'public' | 'private') || 'unlisted',
            selfDeclaredMadeForKids: false,
          },
        },
        media: {
          body,
        },
      });

      const videoId = response.data.id;
      if (!videoId) {
        await this.markFailed(job.id, 'YouTube لم يُرجع معرف الفيديو');
        return;
      }
      const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;
      await this.markDone(job.id, videoId, youtubeUrl);
      logger.info({ jobId: job.id, videoId, meetingId: job.meeting_id }, 'YouTube admin upload done');
    } catch (err: any) {
      source.destroy();
      if (isInvalidGrantError(err)) {
        await YoutubeConnectionService.markNeedsReauth('انتهت صلاحية توكن YouTube (invalid_grant)');
        await this.markFailed(job.id, 'انتهت صلاحية YouTube — سجّل الدخول مجدداً', 'needs_reauth');
        return;
      }
      if (isYoutubeQuotaError(err)) {
        await this.markFailed(
          job.id,
          'تم تجاوز حد رفع YouTube اليومي — أعد المحاولة غداً (منتصف الليل بتوقيت المحيط الهادئ)',
        );
        return;
      }
      const message = err?.message || String(err);
      logger.error({ err, jobId: job.id }, 'YouTube admin upload failed');
      await this.markFailed(job.id, message);
    }
  }
}
