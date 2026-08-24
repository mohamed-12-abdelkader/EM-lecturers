/**
 * Upload local /recordings/{meetingId}.mp4 files to Bunny and set egress_url.
 * Usage (from repo root):
 *   node -r dotenv/config scripts/backfill-meeting-recordings.mjs [meetingId ...]
 */
import pg from 'pg';
import fs from 'node:fs';

const { Pool } = pg;

async function main() {
  const ids = process.argv.slice(2);
  if (ids.length === 0) {
    console.error('Usage: node -r dotenv/config scripts/backfill-meeting-recordings.mjs <meetingId> ...');
    process.exit(1);
  }

  const { processMeetingRecordingAfterEgress } = await import('../dist/services/meetingRecordingUpload.js');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  for (const roomName of ids) {
    const filePath = `/recordings/${roomName}.mp4`;
    if (!fs.existsSync(filePath)) {
      console.warn('Skip (no file):', roomName);
      continue;
    }

    let meetingTitle = roomName;
    let table = 'meeting';

    const meeting = await pool.query('SELECT title FROM meeting WHERE id = $1 LIMIT 1', [roomName]);
    if (meeting.rowCount) {
      meetingTitle = meeting.rows[0].title;
    } else {
      const group = await pool.query(
        'SELECT title FROM general_course_group_meeting WHERE id = $1 LIMIT 1',
        [roomName],
      );
      if (!group.rowCount) {
        console.warn('Skip (meeting not in DB):', roomName);
        continue;
      }
      meetingTitle = group.rows[0].title;
      table = 'general_course_group_meeting';
    }

    try {
      const url = await processMeetingRecordingAfterEgress({
        roomName,
        recordingFilePath: filePath,
        meetingTitle,
        table,
      });
      console.log('OK', roomName, url);
    } catch (err) {
      console.error('FAIL', roomName, err?.message || err);
    }
  }

  await pool.end();
}

main();
