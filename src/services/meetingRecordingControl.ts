import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import {
  EgressClient,
  EncodedFileOutput,
  EncodingOptions,
  RoomCompositeOptions,
  VideoCodec,
  type RoomServiceClient,
} from 'livekit-server-sdk';
import pool from '../db/pool';
import { config } from '../utils';
import { generateParticipantToken, resolveMeetingTeacherDisplay } from './meetings-room-services';
import {
  isRecorderIdentity,
  isScreenShareIdentity,
  parseUserIdFromMeetingIdentity,
} from './meetingIdentity';
import {
  processMeetingRecordingAfterEgress,
  type MeetingRecordingTable,
} from './meetingRecordingUpload';

const execPromise = promisify(exec);

const { LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_URL: LIVEKIT_SERVER_URL } = config;

const RECORDING_COMPOSITE_BASE_URL =
  process.env.LK_RECORDING_BASE_URL || 'https://lk-recording.next-edu.online';

export type MeetingRecordingStatus = 'idle' | 'recording' | 'paused' | 'finalized';

type MeetingTable = MeetingRecordingTable;

type MeetingRecordingRow = {
  id: string;
  title: string;
  created_by: number;
  status: string;
  recording_status?: string | null;
  active_egress_id?: string | null;
  recording_segment_index?: number | null;
  recording_segments?: unknown;
};

function getEgressClient() {
  return new EgressClient(LIVEKIT_SERVER_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
}

function segmentFilePath(roomName: string, segmentIndex: number): string {
  if (segmentIndex <= 1) return `/recordings/${roomName}.mp4`;
  return `/recordings/${roomName}_part${segmentIndex}.mp4`;
}

function parseSegments(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || '').trim()).filter(Boolean);
}

async function loadMeetingRow(
  roomName: string,
): Promise<{ table: MeetingTable; row: MeetingRecordingRow } | null> {
  const meeting = await pool.query<MeetingRecordingRow>(
    `SELECT id, title, created_by, status,
            recording_status, active_egress_id, recording_segment_index, recording_segments
     FROM meeting WHERE id = $1 LIMIT 1`,
    [roomName],
  );
  if (meeting.rowCount) {
    return { table: 'meeting', row: meeting.rows[0] };
  }
  const group = await pool.query<MeetingRecordingRow>(
    `SELECT id, title, created_by, status,
            recording_status, active_egress_id, recording_segment_index, recording_segments
     FROM general_course_group_meeting WHERE id = $1 LIMIT 1`,
    [roomName],
  );
  if (group.rowCount) {
    return { table: 'general_course_group_meeting', row: group.rows[0] };
  }
  return null;
}

async function updateRecordingState(
  table: MeetingTable,
  roomName: string,
  patch: {
    recording_status?: MeetingRecordingStatus;
    active_egress_id?: string | null;
    recording_segment_index?: number;
    recording_segments?: string[];
  },
) {
  const sets: string[] = ['updated_at = CURRENT_TIMESTAMP'];
  const values: unknown[] = [];
  let i = 1;
  if (patch.recording_status !== undefined) {
    sets.push(`recording_status = $${i++}`);
    values.push(patch.recording_status);
  }
  if (patch.active_egress_id !== undefined) {
    sets.push(`active_egress_id = $${i++}`);
    values.push(patch.active_egress_id);
  }
  if (patch.recording_segment_index !== undefined) {
    sets.push(`recording_segment_index = $${i++}`);
    values.push(patch.recording_segment_index);
  }
  if (patch.recording_segments !== undefined) {
    sets.push(`recording_segments = $${i++}::jsonb`);
    values.push(JSON.stringify(patch.recording_segments));
  }
  values.push(roomName);
  await pool.query(
    `UPDATE ${table} SET ${sets.join(', ')} WHERE id = $${i}`,
    values,
  );
}

export async function startMeetingRecordingSegment(
  roomName: string,
  meeting: { title: string; created_by: number },
  segmentIndex: number,
): Promise<{ egressId: string; filePath: string }> {
  const egressClient = getEgressClient();
  const egressToken = await generateParticipantToken({
    roomName,
    identity: `recorder_${Date.now()}`,
    name: 'egress',
    role: 'egress',
    ttl: '8760h',
  });

  const filePath = segmentFilePath(roomName, segmentIndex);
  const outputFile = new EncodedFileOutput({ filepath: filePath });
  const { teacherName } = await resolveMeetingTeacherDisplay(meeting.created_by);

  const egressParams = new URLSearchParams({
    token: egressToken,
    url: LIVEKIT_SERVER_URL,
  });
  if (meeting.title) egressParams.set('meetingTitle', meeting.title);
  if (teacherName) egressParams.set('teacherName', teacherName);

  // Max-quality file encode only — does not change live WebRTC adaptive layers for viewers.
  // Powerful host: prefer H.264 High + very high bitrate so screen-share/code stays sharp after save.
  const egressOpt: RoomCompositeOptions = {
    customBaseUrl: `${RECORDING_COMPOSITE_BASE_URL}?${egressParams.toString()}`,
    layout: 'grid',
    encodingOptions: new EncodingOptions({
      width: 1920,
      height: 1080,
      framerate: 30, // 30fps keeps more bits per frame for sharp UI/text than 60
      videoCodec: VideoCodec.H264_HIGH,
      videoBitrate: 20000, // kbps — archival-grade 1080p for lectures
      audioBitrate: 256,
      audioFrequency: 48000,
      keyFrameInterval: 2,
    }),
  };

  const info = await egressClient.startRoomCompositeEgress(roomName, outputFile, egressOpt);
  const egressId = String((info as { egressId?: string }).egressId || '');
  console.log('[MeetingRecording] started segment', { roomName, segmentIndex, egressId, filePath });
  return { egressId, filePath };
}

export async function ensureInitialRecordingStarted(roomName: string): Promise<void> {
  const loaded = await loadMeetingRow(roomName);
  if (!loaded) return;
  const { table, row } = loaded;
  const status = String(row.recording_status || 'idle');
  if (status === 'recording' || status === 'finalized') return;
  if (status === 'paused' && parseSegments(row.recording_segments).length > 0) return;

  const segmentIndex = Math.max(1, Number(row.recording_segment_index || 0) + 1);
  const started = await startMeetingRecordingSegment(roomName, row, segmentIndex);
  await updateRecordingState(table, roomName, {
    recording_status: 'recording',
    active_egress_id: started.egressId || null,
    recording_segment_index: segmentIndex,
  });
}

export async function pauseMeetingRecording(roomName: string): Promise<{ paused: boolean }> {
  const loaded = await loadMeetingRow(roomName);
  if (!loaded) return { paused: false };
  const { table, row } = loaded;
  if (String(row.recording_status || '') !== 'recording') {
    return { paused: false };
  }

  const egressId = row.active_egress_id ? String(row.active_egress_id) : '';
  const segmentIndex = Math.max(1, Number(row.recording_segment_index || 1));
  const filePath = segmentFilePath(roomName, segmentIndex);
  const segments = parseSegments(row.recording_segments);

  if (egressId) {
    try {
      await getEgressClient().stopEgress(egressId);
    } catch (err) {
      console.warn('[MeetingRecording] stopEgress on pause failed:', err);
    }
  }

  if (!segments.includes(filePath)) segments.push(filePath);

  await updateRecordingState(table, roomName, {
    recording_status: 'paused',
    active_egress_id: null,
    recording_segments: segments,
  });
  return { paused: true };
}

export async function resumeMeetingRecording(roomName: string): Promise<{ resumed: boolean }> {
  const loaded = await loadMeetingRow(roomName);
  if (!loaded) return { resumed: false };
  const { table, row } = loaded;
  const status = String(row.recording_status || 'idle');
  // الاستكمال فقط من حالة paused — البداية الأولى تتم عبر room_started
  if (status !== 'paused') return { resumed: false };
  if (String(row.status || '') === 'ended') return { resumed: false };

  const nextIndex = Math.max(1, Number(row.recording_segment_index || 0) + 1);
  const started = await startMeetingRecordingSegment(roomName, row, nextIndex);
  await updateRecordingState(table, roomName, {
    recording_status: 'recording',
    active_egress_id: started.egressId || null,
    recording_segment_index: nextIndex,
  });
  return { resumed: true };
}

async function concatRecordingSegments(
  roomName: string,
  segments: string[],
): Promise<string | null> {
  const existing = segments.filter((p) => fs.existsSync(p));
  if (!existing.length) return null;
  if (existing.length === 1) {
    const only = existing[0];
    const finalPath = `/recordings/${roomName}.mp4`;
    if (only !== finalPath) {
      try {
        fs.copyFileSync(only, finalPath);
      } catch {
        return only;
      }
    }
    return finalPath;
  }

  const listPath = `/recordings/${roomName}_concat.txt`;
  const finalPath = `/recordings/${roomName}.mp4`;
  const listBody = existing
    .map((file) => `file '${String(file).replace(/'/g, `'\\''`)}'`)
    .join('\n');
  fs.writeFileSync(listPath, listBody, 'utf8');
  try {
    await execPromise(
      `ffmpeg -y -f concat -safe 0 -i "${listPath}" -c copy "${finalPath}"`,
    );
    return finalPath;
  } catch (err) {
    console.error('[MeetingRecording] ffmpeg concat failed:', err);
    return existing[existing.length - 1] || null;
  } finally {
    try {
      fs.unlinkSync(listPath);
    } catch {
      // ignore
    }
  }
}

export async function finalizeMeetingRecording(roomName: string): Promise<{ finalized: boolean }> {
  const loaded = await loadMeetingRow(roomName);
  if (!loaded) return { finalized: false };
  const { table, row } = loaded;
  if (String(row.recording_status || '') === 'finalized') {
    return { finalized: true };
  }

  const egressId = row.active_egress_id ? String(row.active_egress_id) : '';
  const segmentIndex = Math.max(1, Number(row.recording_segment_index || 1));
  const currentPath = segmentFilePath(roomName, segmentIndex);
  const segments = parseSegments(row.recording_segments);
  if (segmentIndex > 0 && !segments.includes(currentPath)) {
    segments.push(currentPath);
  }

  // علّم finalized أولاً حتى يتعامل webhook egress_ended مع الرفع مرة واحدة
  await updateRecordingState(table, roomName, {
    recording_status: 'finalized',
    active_egress_id: null,
    recording_segments: segments,
  });

  if (egressId) {
    try {
      await getEgressClient().stopEgress(egressId);
    } catch (err) {
      console.warn('[MeetingRecording] stopEgress on finalize failed:', err);
      // إن لم يوجد egress نشط، ارفع مباشرة من الأجزاء المحفوظة
      const finalPath = (await concatRecordingSegments(roomName, segments)) || currentPath;
      void processMeetingRecordingAfterEgress({
        roomName,
        recordingFilePath: finalPath,
        meetingTitle: row.title,
        table,
      }).catch((uploadErr) => console.error('[MeetingRecording] finalize upload failed:', uploadErr));
    }
  } else {
    const finalPath = (await concatRecordingSegments(roomName, segments)) || currentPath;
    void processMeetingRecordingAfterEgress({
      roomName,
      recordingFilePath: finalPath,
      meetingTitle: row.title,
      table,
    }).catch((uploadErr) => console.error('[MeetingRecording] finalize upload failed:', uploadErr));
  }

  return { finalized: true };
}

export async function listHostDeviceParticipants(
  roomService: RoomServiceClient,
  roomName: string,
  teacherUserId: number,
) {
  try {
    const participants = await roomService.listParticipants(roomName);
    return participants.filter((p) => {
      const identity = String(p.identity || '');
      if (isRecorderIdentity(identity) || isScreenShareIdentity(identity)) return false;
      return parseUserIdFromMeetingIdentity(identity) === Number(teacherUserId);
    });
  } catch {
    return [];
  }
}

export async function teacherHasActiveDeviceInRoom(
  roomService: RoomServiceClient,
  roomName: string,
  teacherUserId: number,
): Promise<boolean> {
  const hosts = await listHostDeviceParticipants(roomService, roomName, teacherUserId);
  return hosts.length > 0;
}

/**
 * عند مغادرة آخر جهاز للمدرس: علّق التسجيل دون إنهاء الميتنج.
 * عند عودة جهاز مدرس والتسجيل معلّق: استكمل بجزء جديد.
 */
export async function syncRecordingWithTeacherPresence(opts: {
  roomService: RoomServiceClient;
  roomName: string;
  event: 'joined' | 'left';
  identity: string;
}): Promise<void> {
  const loaded = await loadMeetingRow(opts.roomName);
  if (!loaded) return;
  const teacherId = Number(loaded.row.created_by);
  const eventUserId = parseUserIdFromMeetingIdentity(opts.identity);
  if (!eventUserId || eventUserId !== teacherId) return;
  if (isRecorderIdentity(opts.identity)) return;

  const hasTeacher = await teacherHasActiveDeviceInRoom(
    opts.roomService,
    opts.roomName,
    teacherId,
  );
  const status = String(loaded.row.recording_status || 'idle');

  if (opts.event === 'left' && !hasTeacher && status === 'recording') {
    await pauseMeetingRecording(opts.roomName);
    return;
  }

  if (opts.event === 'joined' && hasTeacher && status === 'paused') {
    await resumeMeetingRecording(opts.roomName);
  }
}

export function recordingFilePathForLegacyEgress(roomName: string): string {
  return path.posix.join('/recordings', `${roomName}.mp4`);
}

/** يُستدعى من webhook egress_ended بعد وضع التسجيل على finalized */
export async function uploadFinalizedMeetingRecording(roomName: string): Promise<void> {
  const loaded = await loadMeetingRow(roomName);
  if (!loaded) return;
  if (String(loaded.row.recording_status || '') === 'paused') return;
  if (String(loaded.row.recording_status || '') === 'recording') return;

  const segments = parseSegments(loaded.row.recording_segments);
  const fallback = segmentFilePath(
    roomName,
    Math.max(1, Number(loaded.row.recording_segment_index || 1)),
  );
  const finalPath =
    (await concatRecordingSegments(roomName, segments.length ? segments : [fallback])) ||
    fallback;

  await processMeetingRecordingAfterEgress({
    roomName,
    recordingFilePath: finalPath,
    meetingTitle: loaded.row.title,
    table: loaded.table,
  });
}
