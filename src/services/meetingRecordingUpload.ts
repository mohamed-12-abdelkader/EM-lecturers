import fs from 'node:fs';
import pool from '../db/pool';
import { uploadToBunnyStorage, uploadToBunnyStream } from './bunny';
import { uploadToYouTube } from './uploadToYoutube';
import { logger } from '../utils';

export type MeetingRecordingTable = 'meeting' | 'general_course_group_meeting';

export type ProcessMeetingRecordingInput = {
  roomName: string;
  recordingFilePath: string;
  meetingTitle: string;
  table: MeetingRecordingTable;
};

function resolveRecordingProvider(): 'bunny' | 'bunny_stream' | 'youtube' {
  const raw = (process.env.MEETING_RECORDING_PROVIDER || 'bunny').trim().toLowerCase();
  if (raw === 'youtube') return 'youtube';
  // Default: original MP4 on Bunny Storage (no Stream re-encode quality loss).
  if (raw === 'bunny_stream' || raw === 'stream') return 'bunny_stream';
  return 'bunny';
}

async function saveRecordingUrl(
  table: MeetingRecordingTable,
  roomName: string,
  playbackUrl: string,
): Promise<void> {
  if (table === 'meeting') {
    await pool.query(
      `UPDATE meeting SET egress_url = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
      [playbackUrl, roomName],
    );
    return;
  }
  await pool.query(
    `UPDATE general_course_group_meeting SET egress_url = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
    [playbackUrl, roomName],
  );
}

async function waitForRecordingFile(
  filePath: string,
  maxAttempts = 30,
  delayMs = 2000,
): Promise<boolean> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (fs.existsSync(filePath)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return false;
}

export async function processMeetingRecordingAfterEgress(
  input: ProcessMeetingRecordingInput,
): Promise<string | null> {
  const { roomName, recordingFilePath, meetingTitle, table } = input;

  const fileReady = await waitForRecordingFile(recordingFilePath);
  if (!fileReady) {
    logger.warn({ roomName, recordingFilePath }, 'Meeting recording file not found after egress');
    return null;
  }

  const provider = resolveRecordingProvider();
  let playbackUrl: string;

  try {
    if (provider === 'youtube') {
      const ytResponse = await uploadToYouTube({
        filePath: recordingFilePath,
        title: meetingTitle,
        privacyStatus: 'unlisted',
      });
      playbackUrl = `https://www.youtube.com/watch?v=${ytResponse.id}`;
    } else if (provider === 'bunny_stream') {
      playbackUrl = await uploadToBunnyStream(
        {
          path: recordingFilePath,
          ext: 'mp4',
          mime: 'video/mp4',
          originalname: meetingTitle,
        },
        {
          maxAttempts: 5,
          retryDelay: 3000,
          deleteSource: false,
          uploadTimeoutMs: 3_600_000,
        },
      );
    } else {
      // Original high-quality MP4 — avoids Bunny Stream re-encoding that softens text/code.
      playbackUrl = await uploadToBunnyStorage(
        {
          path: recordingFilePath,
          ext: 'mp4',
          mime: 'video/mp4',
          originalname: meetingTitle,
        },
        5,
        3000,
        {
          deleteSource: false,
          uploadTimeoutMs: 3_600_000,
          subPath: 'meeting-recordings',
        },
      );
    }

    await saveRecordingUrl(table, roomName, playbackUrl);
    logger.info({ roomName, provider, playbackUrl }, 'Meeting recording uploaded');
    return playbackUrl;
  } catch (error) {
    logger.error({ err: error, roomName, provider }, 'Meeting recording upload failed');
    throw error;
  }
}
