import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import {
  AudioCodec,
  EgressClient,
  EncodedFileOutput,
  EncodingOptions,
  EncodingOptionsPreset,
  RoomCompositeOptions,
  RoomServiceClient,
  TrackSource,
  VideoCodec,
  type ParticipantInfo,
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

/**
 * Recording mode:
 * - teacher_tracks (default): Participant/TrackComposite from teacher media (closer to live quality)
 * - room_composite: legacy Chrome template composite
 *
 * Rollback without code revert: MEETING_RECORDING_MODE=room_composite
 */
function resolveRecordingMode(): 'teacher_tracks' | 'room_composite' {
  const raw = String(process.env.MEETING_RECORDING_MODE || 'teacher_tracks')
    .trim()
    .toLowerCase();
  if (raw === 'room_composite' || raw === 'composite' || raw === 'legacy') {
    return 'room_composite';
  }
  return 'teacher_tracks';
}

/**
 * Full-meeting recorder template (screen full + camera PiP).
 * Prefer LK_RECORDING_BASE_URL; otherwise API_URL/lk-recording when set.
 */
function resolveRecordingCompositeBaseUrl(): string {
  const fromEnv = String(process.env.LK_RECORDING_BASE_URL || '').trim().replace(/\/$/, '');
  const apiUrl = String(config.API_URL || config.BASE_URL || '').trim().replace(/\/$/, '');
  const apiTemplate = apiUrl ? `${apiUrl}/lk-recording` : '';
  // Prefer the template shipped with this backend (screen full + camera PiP).
  // Old hosted lk-recording.next-edu.online layout made camera tiny / incomplete.
  if (apiTemplate && (!fromEnv || /lk-recording\.next-edu\.online/i.test(fromEnv))) {
    return apiTemplate;
  }
  if (fromEnv) return fromEnv;
  return apiTemplate || 'https://lk-recording.next-edu.online';
}

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

type TeacherTrackTarget =
  | {
      kind: 'track_composite';
      videoTrackId: string;
      audioTrackId?: string;
      reason: string;
    }
  | {
      kind: 'participant';
      identity: string;
      screenShare: boolean;
      reason: string;
    };

function getEgressClient() {
  return new EgressClient(LIVEKIT_SERVER_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
}

function getRoomServiceClient() {
  return new RoomServiceClient(LIVEKIT_SERVER_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
}

/** Rooms whose active segment is already capturing teacher screen share. */
const screenShareSegmentRooms = new Set<string>();

function markScreenShareSegment(roomName: string, enabled: boolean) {
  if (enabled) screenShareSegmentRooms.add(roomName);
  else screenShareSegmentRooms.delete(roomName);
}

function isScreenShareTarget(target: TeacherTrackTarget): boolean {
  return (
    (target.kind === 'track_composite' && target.reason === 'teacher_screen_track') ||
    (target.kind === 'participant' && target.screenShare === true)
  );
}

function highQualityEncodingOptions(): EncodingOptions {
  return new EncodingOptions({
    width: 1920,
    height: 1080,
    framerate: 30,
    videoCodec: VideoCodec.H264_HIGH,
    videoBitrate: 14000,
    audioCodec: AudioCodec.AAC,
    audioBitrate: 192,
    audioFrequency: 48000,
    keyFrameInterval: 2,
  });
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

function teacherParticipants(
  participants: ParticipantInfo[],
  teacherUserId: number,
): ParticipantInfo[] {
  return participants.filter((p) => {
    const identity = String(p.identity || '');
    if (isRecorderIdentity(identity)) return false;
    return parseUserIdFromMeetingIdentity(identity) === Number(teacherUserId);
  });
}

function findTrackSid(
  participants: ParticipantInfo[],
  source: TrackSource,
): string | undefined {
  for (const p of participants) {
    for (const t of p.tracks || []) {
      if (Number(t.source) === Number(source) && t.sid) {
        return String(t.sid);
      }
    }
  }
  return undefined;
}

function pickPrimaryTeacherIdentity(participants: ParticipantInfo[]): string | null {
  const nonScreen = participants.find((p) => !isScreenShareIdentity(p.identity));
  if (nonScreen?.identity) return String(nonScreen.identity);
  if (participants[0]?.identity) return String(participants[0].identity);
  return null;
}

/**
 * Prefer teacher screen + mic tracks (closest to live quality).
 * Fallback: participant camera/mic, then participant screenShare wait.
 */
async function resolveTeacherTrackTarget(
  roomName: string,
  teacherUserId: number,
): Promise<TeacherTrackTarget | null> {
  let participants: ParticipantInfo[] = [];
  try {
    participants = await getRoomServiceClient().listParticipants(roomName);
  } catch (err) {
    console.warn('[MeetingRecording] listParticipants failed:', err);
  }

  const teacherParts = teacherParticipants(participants, teacherUserId);
  const screenVideoId = findTrackSid(teacherParts, TrackSource.SCREEN_SHARE);
  const screenAudioId = findTrackSid(teacherParts, TrackSource.SCREEN_SHARE_AUDIO);
  const micId = findTrackSid(
    teacherParts.filter((p) => !isScreenShareIdentity(p.identity)),
    TrackSource.MICROPHONE,
  );
  const cameraId = findTrackSid(
    teacherParts.filter((p) => !isScreenShareIdentity(p.identity)),
    TrackSource.CAMERA,
  );
  const primaryIdentity = pickPrimaryTeacherIdentity(teacherParts);
  const screenShareIdentity =
    teacherParts.find((p) => isScreenShareIdentity(p.identity))?.identity || null;

  if (screenVideoId) {
    return {
      kind: 'track_composite',
      videoTrackId: screenVideoId,
      audioTrackId: screenAudioId || micId,
      reason: 'teacher_screen_track',
    };
  }

  if (cameraId || micId) {
    if (primaryIdentity) {
      return {
        kind: 'participant',
        identity: primaryIdentity,
        screenShare: false,
        reason: 'teacher_camera_mic',
      };
    }
  }

  if (screenShareIdentity) {
    return {
      kind: 'participant',
      identity: String(screenShareIdentity),
      screenShare: true,
      reason: 'wait_screen_share_identity',
    };
  }

  if (primaryIdentity) {
    // Waits until teacher publishes camera/mic (or we later upgrade on screen publish).
    return {
      kind: 'participant',
      identity: primaryIdentity,
      screenShare: false,
      reason: 'wait_teacher_media',
    };
  }

  // Teacher not listed yet — still start participant egress on canonical identity.
  return {
    kind: 'participant',
    identity: `user_${teacherUserId}_meeting_${roomName}`,
    screenShare: false,
    reason: 'canonical_identity_fallback',
  };
}

async function startTeacherTracksRecordingSegment(
  roomName: string,
  meeting: { title: string; created_by: number },
  segmentIndex: number,
): Promise<{ egressId: string; filePath: string }> {
  const egressClient = getEgressClient();
  const filePath = segmentFilePath(roomName, segmentIndex);
  const outputFile = new EncodedFileOutput({ filepath: filePath });
  const encodingOptions = highQualityEncodingOptions();
  const target = await resolveTeacherTrackTarget(roomName, meeting.created_by);

  if (!target) {
    throw new Error('Unable to resolve teacher recording target');
  }

  let info;
  if (target.kind === 'track_composite') {
    info = await egressClient.startTrackCompositeEgress(roomName, outputFile, {
      videoTrackId: target.videoTrackId,
      audioTrackId: target.audioTrackId,
      encodingOptions,
    });
  } else {
    info = await egressClient.startParticipantEgress(
      roomName,
      target.identity,
      { file: outputFile },
      {
        screenShare: target.screenShare,
        // Prefer explicit high-bitrate options over 1080p preset defaults.
        encodingOptions:
          process.env.MEETING_RECORDING_USE_PRESET === '1'
            ? EncodingOptionsPreset.H264_1080P_30
            : encodingOptions,
      },
    );
  }

  const egressId = String((info as { egressId?: string }).egressId || '');
  markScreenShareSegment(roomName, isScreenShareTarget(target));
  console.log('[MeetingRecording] started teacher-tracks segment', {
    roomName,
    segmentIndex,
    egressId,
    filePath,
    target,
  });
  return { egressId, filePath };
}

/** Legacy Room Composite path — kept for MEETING_RECORDING_MODE=room_composite rollback. */
async function startRoomCompositeRecordingSegment(
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
    hidden: true,
  });

  const filePath = segmentFilePath(roomName, segmentIndex);
  const outputFile = new EncodedFileOutput({ filepath: filePath });
  const { teacherName, teacherIcon } = await resolveMeetingTeacherDisplay(
    meeting.created_by,
  );

  const egressParams = new URLSearchParams({
    token: egressToken,
    url: LIVEKIT_SERVER_URL,
  });
  if (meeting.title) egressParams.set('meetingTitle', meeting.title);
  if (teacherName) egressParams.set('teacherName', teacherName);
  if (teacherIcon) egressParams.set('teacherIcon', teacherIcon);
  if (meeting.created_by != null) {
    egressParams.set('teacherUserId', String(meeting.created_by));
  }

  const recordingBase = resolveRecordingCompositeBaseUrl();
  const egressOpt: RoomCompositeOptions = {
    customBaseUrl: `${recordingBase}?${egressParams.toString()}`,
    layout: 'speaker',
    encodingOptions: highQualityEncodingOptions(),
  };

  const info = await egressClient.startRoomCompositeEgress(roomName, outputFile, egressOpt);
  const egressId = String((info as { egressId?: string }).egressId || '');
  console.log('[MeetingRecording] started room-composite segment', {
    roomName,
    segmentIndex,
    egressId,
    filePath,
    recordingBase,
  });
  return { egressId, filePath };
}

export async function startMeetingRecordingSegment(
  roomName: string,
  meeting: { title: string; created_by: number },
  segmentIndex: number,
): Promise<{ egressId: string; filePath: string }> {
  const mode = resolveRecordingMode();
  if (mode === 'room_composite') {
    return startRoomCompositeRecordingSegment(roomName, meeting, segmentIndex);
  }
  return startTeacherTracksRecordingSegment(roomName, meeting, segmentIndex);
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

/**
 * If we were recording camera-only and teacher just published screen share,
 * rotate to a new segment that captures the screen track (better teaching quality).
 */
export async function upgradeRecordingToScreenShareIfNeeded(
  roomName: string,
): Promise<{ upgraded: boolean }> {
  if (resolveRecordingMode() !== 'teacher_tracks') {
    return { upgraded: false };
  }
  if (screenShareSegmentRooms.has(roomName)) {
    return { upgraded: false };
  }

  const loaded = await loadMeetingRow(roomName);
  if (!loaded) return { upgraded: false };
  if (String(loaded.row.recording_status || '') !== 'recording') {
    return { upgraded: false };
  }

  const target = await resolveTeacherTrackTarget(roomName, loaded.row.created_by);
  if (!target || !isScreenShareTarget(target)) return { upgraded: false };

  console.log('[MeetingRecording] upgrading segment to screen share', { roomName, target });
  await pauseMeetingRecording(roomName);
  await resumeMeetingRecording(roomName);
  return { upgraded: true };
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
  markScreenShareSegment(roomName, false);
  return { paused: true };
}

export async function resumeMeetingRecording(roomName: string): Promise<{ resumed: boolean }> {
  const loaded = await loadMeetingRow(roomName);
  if (!loaded) return { resumed: false };
  const { table, row } = loaded;
  const status = String(row.recording_status || 'idle');
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

  await updateRecordingState(table, roomName, {
    recording_status: 'finalized',
    active_egress_id: null,
    recording_segments: segments,
  });
  markScreenShareSegment(roomName, false);

  if (egressId) {
    try {
      await getEgressClient().stopEgress(egressId);
    } catch (err) {
      console.warn('[MeetingRecording] stopEgress on finalize failed:', err);
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

  if (opts.event === 'joined' && hasTeacher && (status === 'idle' || !status)) {
    await ensureInitialRecordingStarted(opts.roomName);
  }
}

export function recordingFilePathForLegacyEgress(roomName: string): string {
  return path.posix.join('/recordings', `${roomName}.mp4`);
}

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
