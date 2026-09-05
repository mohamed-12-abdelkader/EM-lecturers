import { AccessToken, VideoGrant } from 'livekit-server-sdk';
import { buildFileUrl, config } from '../utils';
import pool from '../db/pool';

const { LIVEKIT_API_KEY, LIVEKIT_API_SECRET } = config;

export type MeetingTeacherDisplay = {
  teacherName: string | null;
  teacherIcon: string | null;
};

/**
 * اسم المدرس صاحب الميتنج + أيقونة منصة المدرس (avatar/favicon من tenants).
 */
export async function resolveMeetingTeacherDisplay(
  createdBy: number,
  tenant?: {
    owner_user_id?: number | null;
    avatar_url?: string | null;
    favicon_url?: string | null;
  } | null,
): Promise<MeetingTeacherDisplay> {
  const ownerResult = await pool.query<{
    name: string | null;
    user_avatar: string | null;
    tenant_avatar_url: string | null;
    tenant_favicon_url: string | null;
  }>(
    `SELECT
       u.name,
       u.avatar AS user_avatar,
       t.avatar_url AS tenant_avatar_url,
       t.favicon_url AS tenant_favicon_url
     FROM users u
     LEFT JOIN LATERAL (
       SELECT avatar_url, favicon_url
       FROM tenants
       WHERE owner_user_id = u.id
       ORDER BY CASE WHEN COALESCE(is_active, TRUE) THEN 0 ELSE 1 END, id DESC
       LIMIT 1
     ) t ON TRUE
     WHERE u.id = $1
     LIMIT 1`,
    [createdBy],
  );

  const row = ownerResult.rows[0];
  const teacherName = row?.name ?? null;

  let iconRaw: string | null = null;
  if (tenant && Number(tenant.owner_user_id) === Number(createdBy)) {
    iconRaw = tenant.avatar_url || tenant.favicon_url || null;
  }
  if (!iconRaw) {
    iconRaw = row?.tenant_avatar_url || row?.tenant_favicon_url || row?.user_avatar || null;
  }

  return {
    teacherName,
    teacherIcon: buildFileUrl(iconRaw),
  };
}

export function sameUserId(a: unknown, b: unknown): boolean {
  const left = Number(a);
  const right = Number(b);
  return Number.isFinite(left) && Number.isFinite(right) && left === right;
}

/**
 * من يحق له توكن مشاركة الشاشة (تطبيق الموبايل): صاحب الجلسة، أدمن،
 * مدرس الكورس، أو مدرس مجموعة الكورس العام.
 */
export async function canIssueScreenShareToken(params: {
  user: { id: unknown; role?: string | null };
  meeting: { created_by?: unknown; course_id?: unknown; group_id?: unknown };
  meetingSource?: 'course' | 'general_course_group';
}): Promise<boolean> {
  const { user, meeting, meetingSource } = params;
  if (sameUserId(user.id, meeting.created_by)) return true;
  if (user.role === 'admin') return true;

  if (meetingSource === 'general_course_group' && meeting.group_id) {
    const group = await pool.query(
      `SELECT 1 FROM general_course_groups WHERE id = $1 AND teacher_id = $2 LIMIT 1`,
      [meeting.group_id, user.id],
    );
    if (group.rowCount) return true;
  }

  if (meeting.course_id) {
    const course = await pool.query(
      `SELECT 1 FROM courses WHERE id = $1 AND teacher_id = $2 LIMIT 1`,
      [meeting.course_id, user.id],
    );
    if (course.rowCount) return true;
  }

  return false;
}

export const getParticipantsCount = async (roomName: string, roomService: any) => {
  try {
    const participants = await roomService.listParticipants(roomName);
    return participants.length;
  } catch {
    return null;
  }
};

type UserRole = 'participant' | 'host' | 'egress';

interface GenerateParticipantTokenParams {
  roomName: string;
  identity: string;
  name: string;
  metadata?: string;
  role?: UserRole; // default: 'participant'
  allowChat?: boolean; // default: true
  canPublishSources?: string[]; // Optional: camera, microphone, screen_share, etc.
  ttl?: string;
  hidden?: boolean;
}

export async function generateParticipantToken({
  roomName,
  identity,
  name,
  metadata,
  role = 'participant',
  allowChat = true,
  ttl = '10m',
  hidden,
  // canPublishSources = [],
}: GenerateParticipantTokenParams): Promise<string> {
  const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
    identity,
    name,
    ttl,
    metadata,
  });

  const videoGrant: VideoGrant = {
    room: roomName,
    roomJoin: true,
    canSubscribe: true,
    canPublishData: allowChat,
    hidden,
  };

  if (role === 'participant') {
    videoGrant.canPublish = false;
    videoGrant.canUpdateOwnMetadata = false;
    // Uncomment if you want to restrict publishing to specific sources
    // videoGrant.canPublishSources = canPublishSources.map(
    //   source => TrackSource[source.toUpperCase() as keyof typeof TrackSource]
    // );
  } else if (role === 'host') {
    Object.assign(videoGrant, {
      roomAdmin: true,
      roomCreate: true,
      canUpdateOwnMetadata: true,
    });
  } else if (role === 'egress') {
    Object.assign(videoGrant, {
      roomRecord: true,
      canUpdateOwnMetadata: true,
    });
  }

  at.addGrant(videoGrant);
  return await at.toJwt();
}
