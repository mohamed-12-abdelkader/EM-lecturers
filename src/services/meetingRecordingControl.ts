import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import {
  AudioCodec,
  EgressClient,
  EncodedFileOutput,
  EncodingOptions,
  RoomServiceClient,
  TrackSource,
  TrackType,
  VideoCodec,
  type ParticipantInfo,
  type TrackInfo,
} from 'livekit-server-sdk';
import pool from '../db/pool';
import { config } from '../utils';
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

type ResolvedRecordingTracks = {
  videoTrackId: string;
  audioTrackId?: string;
  source: 'screen' | 'camera';
  width: number;
  height: number;
};

function getEgressClient() {
  return new EgressClient(LIVEKIT_SERVER_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
}

function getRoomService() {
  return new RoomServiceClient(LIVEKIT_SERVER_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
}

function segmentFilePath(roomName: string, segmentIndex: number): string {
  if (segmentIndex <= 1) return `/recordings/${roomName}.mp4`;
  return `/recordings/${roomName}_part${segmentIndex}.mp4`;
}

function parseSegments(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || '').trim()).filter(Boolean);
}

function evenDim(value: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  const rounded = Math.round(n);
  return rounded % 2 === 0 ? rounded : rounded + 1;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function trackSourceOf(track: TrackInfo): TrackSource {
  return Number((track as any).source ?? TrackSource.UNKNOWN) as TrackSource;
}

function trackTypeOf(track: TrackInfo): TrackType {
  return Number((track as any).type ?? TrackType.AUDIO) as TrackType;
}

function collectTeacherParticipants(
  participants: ParticipantInfo[],
  teacherUserId: number,
): ParticipantInfo[] {
  return participants.filter((p) => {
    const identity = String(p.identity || '');
    if (isRecorderIdentity(identity)) return false;
    return parseUserIdFromMeetingIdentity(identity) === Number(teacherUserId);
  });
}

function pickTrackDims(track: TrackInfo | undefined, fallbackW: number, fallbackH: number) {
  const width = evenDim(Number(track?.width || 0), fallbackW);
  const height = evenDim(Number(track?.height || 0), fallbackH);
  // Keep teaching masters sharp — never force below source when available.
  return {
    width: Math.min(3840, Math.max(1280, width)),
    height: Math.min(2160, Math.max(720, height)),
  };
}

/**
 * Prefer teacher screen-share video + microphone audio (no browser composite).
 * Falls back to camera + mic. Looks across multi-device / _screenShare identities.
 */
export function resolveTeacherRecordingTracks(
  participants: ParticipantInfo[],
  teacherUserId: number,
): ResolvedRecordingTracks | null {
  const teacherParticipants = collectTeacherParticipants(participants, teacherUserId);
  if (!teacherParticipants.length) return null;

  let screenVideo: TrackInfo | undefined;
  let cameraVideo: TrackInfo | undefined;
  let micAudio: TrackInfo | undefined;
  let screenAudio: TrackInfo | undefined;

  for (const participant of teacherParticipants) {
    const identity = String(participant.identity || '');
    const tracks = Array.isArray(participant.tracks) ? participant.tracks : [];
    for (const track of tracks) {
      if (track.muted) continue;
      const source = trackSourceOf(track);
      const type = trackTypeOf(track);
      if (type === TrackType.VIDEO && source === TrackSource.SCREEN_SHARE) {
        screenVideo = track;
      } else if (type === TrackType.VIDEO && source === TrackSource.CAMERA) {
        // Prefer camera from a non-screenShare identity when both exist.
        if (!cameraVideo || !isScreenShareIdentity(identity)) cameraVideo = track;
      } else if (type === TrackType.AUDIO && source === TrackSource.MICROPHONE) {
        if (!micAudio || !isScreenShareIdentity(identity)) micAudio = track;
      } else if (type === TrackType.AUDIO && source === TrackSource.SCREEN_SHARE_AUDIO) {
        screenAudio = track;
      }
    }
  }

  const video = screenVideo || cameraVideo;
  if (!video?.sid) return null;

  const source: 'screen' | 'camera' = screenVideo ? 'screen' : 'camera';
  const dims = pickTrackDims(
    video,
    source === 'screen' ? 1920 : 1920,
    source === 'screen' ? 1080 : 1080,
  );
  const audio = micAudio || screenAudio;

  return {
    videoTrackId: String(video.sid),
    audioTrackId: audio?.sid ? String(audio.sid) : undefined,
    source,
    width: dims.width,
    height: dims.height,
  };
}

function buildHighFidelityEncoding(tracks: ResolvedRecordingTracks): EncodingOptions {
  // TrackComposite encodes the published track itself (no UI capture).
  // Match source resolution and keep bitrate at/above live publish to avoid extra softness.
  const isScreen = tracks.source === 'screen';
  const pixels = tracks.width * tracks.height;
  const bitrateFloor = isScreen ? 12000 : 9000;
  const bitrateByPixels = Math.round(pixels / 120); // ~16Mbps @ 1080p, higher for 1440/4K
  return new EncodingOptions({
    width: tracks.width,
    height: tracks.height,
    framerate: 30,
    videoCodec: VideoCodec.H264_HIGH,
    videoBitrate: Math.min(20000, Math.max(bitrateFloor, bitrateByPixels)),
    audioCodec: AudioCodec.AAC,
    audioBitrate: 192,
    audioFrequency: 48000,
    keyFrameInterval: 2,
  });
}

async function waitForTeacherRecordingTracks(
  roomName: string,
  teacherUserId: number,
  attempts = 12,
  delayMs = 1500,
): Promise<ResolvedRecordingTracks | null> {
  const roomService = getRoomService();
  for (let i = 0; i < attempts; i += 1) {
    try {
      const participants = await roomService.listParticipants(roomName);
      const resolved = resolveTeacherRecordingTracks(participants, teacherUserId);
      if (resolved) return resolved;
    } catch (err) {
      console.warn('[MeetingRecording] listParticipants failed while waiting for tracks:', err);
    }
    if (i < attempts - 1) await sleep(delayMs);
  }
  return null;
}

export async function startMeetingRecordingSegment(
  roomName: string,
  meeting: { title: string; created_by: number },
  segmentIndex: number,
): Promise<{ egressId: string; filePath: string; source: 'screen' | 'camera' }> {
  const tracks = await waitForTeacherRecordingTracks(roomName, Number(meeting.created_by));
  if (!tracks) {
    throw new Error(
      'Teacher media tracks are not published yet — cannot start high-quality track recording',
    );
  }

  const filePath = segmentFilePath(roomName, segmentIndex);
  const outputFile = new EncodedFileOutput({ filepath: filePath });
  const encodingOptions = buildHighFidelityEncoding(tracks);

  // Direct track composite: records the live WebRTC track (+ mic), not a browser UI screenshot.
  const info = await getEgressClient().startTrackCompositeEgress(roomName, outputFile, {
    videoTrackId: tracks.videoTrackId,
    audioTrackId: tracks.audioTrackId,
    encodingOptions,
  });

  const egressId = String((info as { egressId?: string }).egressId || '');
  console.log('[MeetingRecording] started track-composite segment', {
    roomName,
    segmentIndex,
    egressId,
    filePath,
    source: tracks.source,
    videoTrackId: tracks.videoTrackId,
    audioTrackId: tracks.audioTrackId || null,
    width: tracks.width,
    height: tracks.height,
  });
  return { egressId, filePath, source: tracks.source };
}

export async function ensureInitialRecordingStarted(roomName: string): Promise<void> {
  const loaded = await loadMeetingRow(roomName);
  if (!loaded) return;
  const { table, row } = loaded;
  const status = String(row.recording_status || 'idle');
  if (status === 'recording' || status === 'finalized') return;
  if (status === 'paused' && parseSegments(row.recording_segments).length > 0) return;

  const segmentIndex = Math.max(1, Number(row.recording_segment_index || 0) + 1);
  try {
    const started = await startMeetingRecordingSegment(roomName, row, segmentIndex);
    await updateRecordingState(table, roomName, {
      recording_status: 'recording',
      active_egress_id: started.egressId || null,
      recording_segment_index: segmentIndex,
    });
  } catch (err) {
    console.warn('[MeetingRecording] initial track recording deferred:', err);
  }
}

/**
 * When teacher starts/stops screen share, cut a new segment so recording always
 * follows the sharpest available live track (screen preferred over camera).
 */
export async function syncRecordingWithTeacherTracks(opts: {
  roomName: string;
  identity: string;
  event: 'published' | 'unpublished';
  trackSource?: number | string | null;
}): Promise<void> {
  const loaded = await loadMeetingRow(opts.roomName);
  if (!loaded) return;
  if (String(loaded.row.recording_status || '') !== 'recording') return;

  const teacherId = Number(loaded.row.created_by);
  const eventUserId = parseUserIdFromMeetingIdentity(opts.identity);
  if (!eventUserId || eventUserId !== teacherId) return;
  if (isRecorderIdentity(opts.identity)) return;

  const sourceNum = Number(opts.trackSource);
  const isScreenVideo =
    sourceNum === TrackSource.SCREEN_SHARE ||
    String(opts.trackSource || '').toLowerCase().includes('screen_share');
  // Camera publish at start is handled by ensureInitialRecordingStarted.
  if (opts.event === 'published' && !isScreenVideo) return;
  if (opts.event === 'unpublished' && !isScreenVideo) return;

  const preferred = await waitForTeacherRecordingTracks(opts.roomName, teacherId, 4, 800);
  if (!preferred) return;

  const { table, row } = loaded;
  const egressId = row.active_egress_id ? String(row.active_egress_id) : '';
  const segmentIndex = Math.max(1, Number(row.recording_segment_index || 1));
  const filePath = segmentFilePath(opts.roomName, segmentIndex);
  const segments = parseSegments(row.recording_segments);
  if (!segments.includes(filePath)) segments.push(filePath);

  if (egressId) {
    try {
      await getEgressClient().stopEgress(egressId);
    } catch (err) {
      console.warn('[MeetingRecording] stopEgress on track rotate failed:', err);
    }
  }

  const nextIndex = segmentIndex + 1;
  try {
    const started = await startMeetingRecordingSegment(opts.roomName, row, nextIndex);
    await updateRecordingState(table, opts.roomName, {
      recording_status: 'recording',
      active_egress_id: started.egressId || null,
      recording_segment_index: nextIndex,
      recording_segments: segments,
    });
    console.log('[MeetingRecording] rotated to', started.source, 'for', opts.roomName);
  } catch (err) {
    // Keep segments; leave status recording so a later publish can retry.
    await updateRecordingState(table, opts.roomName, {
      recording_status: 'recording',
      active_egress_id: null,
      recording_segments: segments,
    });
    console.warn('[MeetingRecording] track rotate restart failed:', err);
  }
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
  try {
    const started = await startMeetingRecordingSegment(roomName, row, nextIndex);
    await updateRecordingState(table, roomName, {
      recording_status: 'recording',
      active_egress_id: started.egressId || null,
      recording_segment_index: nextIndex,
    });
    return { resumed: true };
  } catch (err) {
    console.warn('[MeetingRecording] resume track recording failed:', err);
    return { resumed: false };
  }
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
    // stream copy only — no re-encode/compress after save
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

  // Host joined but recording never started (tracks were not ready at room_started).
  if (opts.event === 'joined' && hasTeacher && (status === 'idle' || !status)) {
    await ensureInitialRecordingStarted(opts.roomName);
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
