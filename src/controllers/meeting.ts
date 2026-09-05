import fs from 'node:fs';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execPromise = promisify(exec);

import {
  WebhookReceiver,
  RoomServiceClient,
  EgressClient,
  RoomCompositeOptions,
  EncodedFileOutput,
} from 'livekit-server-sdk';

import { Router } from 'express';
import { authMiddleware } from '../middleware/authentication';
import { asyncWrapper } from '../utils';
import pool from '../db/pool';
import { config } from '../utils';
import { z } from 'zod';
import { validate } from '../middleware/validateReq';
import {
  checkKickedStatus,
  checkMeetingAccess,
  getActiveMeeting,
  isEnrolledInMeetingCourse,
  isMeetingOwnerOrAdmin,
  isMeetingOwnerOrAdminOrGroupManager,
  singleActiveMeetingLimit,
} from '../middleware/meetings';
import { canIssueScreenShareToken as canUserIssueScreenShareToken, generateParticipantToken, getParticipantsCount, resolveMeetingTeacherDisplay, sameUserId } from '../services/meetings-room-services';
import {
  processMeetingRecordingAfterEgress,
  type MeetingRecordingTable,
} from '../services/meetingRecordingUpload';
import { enforceTeacherLiveCreationLimit } from '../services/teacherLivePackagePolicy';
import { buildScreenShareAppInfo } from '../services/easAppClient';

const router = Router();

const { LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_URL: LIVEKIT_SERVER_URL } = config;

const roomService = new RoomServiceClient(LIVEKIT_SERVER_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
const egressClient = new EgressClient(LIVEKIT_SERVER_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);

const RECORDING_COMPOSITE_BASE_URL =
  process.env.LK_RECORDING_BASE_URL || 'https://lk-recording.next-edu.online';

type MeetingEgressRow = { title: string; created_by: number };

async function startMeetingRecordingEgress(
  roomName: string,
  meeting: MeetingEgressRow,
): Promise<void> {
  const egressToken = await generateParticipantToken({
    roomName,
    identity: `recorder_${Date.now()}`,
    name: 'egress',
    role: 'egress',
    ttl: '8760h',
  });

  const outputFile = new EncodedFileOutput({
    filepath: `/recordings/${roomName}.mp4`,
  });

  const { teacherName } = await resolveMeetingTeacherDisplay(meeting.created_by);

  const egressParams = new URLSearchParams({
    token: egressToken,
    url: LIVEKIT_SERVER_URL,
  });
  if (meeting.title) {
    egressParams.set('meetingTitle', meeting.title);
  }
  if (teacherName) {
    egressParams.set('teacherName', teacherName);
  }

  const egressOpt: RoomCompositeOptions = {
    customBaseUrl: `${RECORDING_COMPOSITE_BASE_URL}?${egressParams.toString()}`,
    layout: 'grid',
  };

  await egressClient.startRoomCompositeEgress(roomName, outputFile, egressOpt);
  console.log('[Meeting] Started recording egress for room:', roomName);
}

/**
 * -------------------------
 * MEETING MANAGEMENT
 * -------------------------
 */

// Create meeting (Teacher/Admin)
router.post(
  '/',
  authMiddleware(['teacher', 'admin']),
  singleActiveMeetingLimit,
  validate(
    z.object({
      title: z.string().min(3, 'Title must be at least 3 characters long'),
      course_id: z.coerce.number().int().positive(),
    }),
  ),
  asyncWrapper(async (req, res) => {
    const { title, course_id } = req.body;
    const user = req.user!;
    if (user.role === 'teacher') {
      await enforceTeacherLiveCreationLimit(user.id);
    }

    const { rows } = await pool.query(
      `INSERT INTO meeting (title, course_id, created_by, status)
       VALUES ($1, $2, $3, 'idle')
       RETURNING *`,
      [title, course_id, user.id],
    );

    res.status(201).json({ message: 'Meeting created', meeting: rows[0] });
  }),
);

// Update meeting (title و/أو حفظ رابط التسجيل egress_url)
router.put(
  '/:id',
  isMeetingOwnerOrAdmin,
  validate(
    z.object({
      title: z.string().min(3).optional(),
      egress_url: z.union([z.string().url(), z.literal(null)]).optional(),
    }),
  ),
  asyncWrapper(async (req, res) => {
    const { id } = req.params;
    const { title, egress_url } = req.body;

    const updates: string[] = ['updated_at = CURRENT_TIMESTAMP'];
    const values: any[] = [];
    let idx = 1;
    if (title !== undefined) {
      updates.push(`title = $${idx++}`);
      values.push(title);
    }
    if (egress_url !== undefined) {
      updates.push(`egress_url = $${idx++}`);
      values.push(egress_url);
    }
    if (values.length === 0) {
      const { rows } = await pool.query(`SELECT * FROM meeting WHERE id = $1 LIMIT 1`, [id]);
      return res.json({ message: 'Meeting updated', meeting: rows[0] });
    }
    values.push(id);
    const { rows } = await pool.query(
      `UPDATE meeting SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
      values,
    );

    res.json({ message: 'Meeting updated', meeting: rows[0] });
  }),
);

// Delete meeting
router.delete(
  '/:id',
  isMeetingOwnerOrAdmin,
  asyncWrapper(async (req, res) => {
    const { id } = req.params;

    const { rows } = await pool.query(
      `DELETE FROM meeting
       WHERE id = $1
       RETURNING *`,
      [id],
    );

    // Also close room in LiveKit if still active
    try {
      await roomService.deleteRoom(rows[0].room_name);
    } catch (err) {
      console.warn('LiveKit room deletion failed or room not found:', err);
    }

    res.json({ message: 'Meeting deleted', meeting: rows[0] });
  }),
);

// Close meeting room (كورس عادي أو جلسة مجموعة كورس عام)
router.post(
  '/:id/close',
  isMeetingOwnerOrAdminOrGroupManager,
  asyncWrapper(async (req, res) => {
    const { id } = req.params;
    const meetingSource = (req as any).meetingSource;

    try {
      await roomService.deleteRoom(id);
    } catch {
      // ignore
    }

    if (meetingSource === 'general_course_group') {
      await pool.query(`UPDATE general_course_group_meeting SET status = 'ended' WHERE id = $1`, [id]);
    } else {
      await pool.query(`UPDATE meeting SET status = 'ended' WHERE id = $1`, [id]);
    }

    res.json({ message: 'Meeting closed' });
  }),
);

// Update participant permissions
router.patch(
  '/:id/participant/:participantId',
  isMeetingOwnerOrAdmin,
  asyncWrapper(async (req, res) => {
    const { id, participantId } = req.params;
    const { permissions } = req.body;

    // Update participant in LiveKit
    await roomService.updateParticipant(id, participantId, undefined, {
      ...permissions,
      canSubscribe: true,
    });

    res.json({ message: 'Participant permissions updated' });
  }),
);

// Toggle wave hand button visibility
router.patch(
  '/:id/wavehand',
  isMeetingOwnerOrAdmin, // only host/moderator can do this
  validate(
    z.object({
      visible: z.boolean(), // expected true/false
    }),
  ),
  asyncWrapper(async (req, res) => {
    const { id: meetingId } = req.params;
    const { visible } = req.body;

    await roomService.updateRoomMetadata(
      meetingId,
      JSON.stringify({
        waveHandVisible: visible,
      }),
    );

    res.json({
      message: `Done.`,
    });
  }),
);

// Kick participant
router.post(
  '/:id/participant/:participantId/kick',
  isMeetingOwnerOrAdmin,
  asyncWrapper(async (req, res) => {
    const { id: meetingId, participantId } = req.params;

    await roomService.removeParticipant(meetingId, participantId);

    await pool.query(`INSERT INTO kicked_participants (meeting_id, user_id) VALUES ($1, $2)`, [
      meetingId,
      participantId,
    ]);

    res.json({ message: 'Participant kicked successfully.' });
  }),
);

/**
 * -------------------------
 * MEETING ACCESS
 * -------------------------
 */

// Pre-join info
router.get(
  '/:id/pre-join',
  authMiddleware(),
  getActiveMeeting,
  checkKickedStatus,
  checkMeetingAccess,
  asyncWrapper(async (req, res) => {
    const meetingId = req.params.id;
    const meeting = req.meeting!;
    const authUser = req.user!;

    // Get participants count
    const participantsCount = await getParticipantsCount(meetingId, roomService);

    // Get user fresh from DB
    const { rows } = await pool.query(`SELECT id, name, avatar FROM users WHERE id = $1 LIMIT 1`, [
      authUser.id,
    ]);

    const dbUser = rows[0];

    const user = {
      id: dbUser.id,
      isOwner: dbUser.id === meeting.created_by,
      username: dbUser.name,
      avatar: dbUser.avatar,
    };

    // الطالب يمكنه الدخول فوراً دون انتظار وصول المحاضر (يعتمد الفرونت على canEnter لتفعيل زر الدخول)
    const canEnter = true;

    res.json({
      meeting: { ...req.meeting, participantsCount: participantsCount ?? 0 },
      user,
      canEnter,
    });
  }),
);

// Download recording (Teacher/Admin)
router.get(
  '/:id/recording/download',
  isMeetingOwnerOrAdmin,
  asyncWrapper(async (req, res) => {
    const { id } = req.params;
    const recordingPath = `/recordings/${id}.mp4`;
    const lowResPath = `/recordings/${id}_low.mp4`;

    if (!fs.existsSync(recordingPath)) {
      return res.status(404).json({ message: 'Recording not found' });
    }

    // If compressed version doesn't exist, create it
    if (!fs.existsSync(lowResPath)) {
      try {
        console.log(`Starting compression for ${id}...`);
        // -crf 28 is a good balance for size/quality
        // -preset faster makes it reasonably quick
        await execPromise(
          `ffmpeg -i "${recordingPath}" -vcodec libx264 -crf 28 -preset faster -acodec aac -b:a 128k "${lowResPath}"`,
        );
        console.log(`Compression finished for ${id}`);
      } catch (err) {
        console.error('Compression error:', err);
        // If compression fails, fallback to original
        return res.download(recordingPath, `recording-${id}.mp4`);
      }
    }

    res.download(lowResPath, `recording-${id}-low.mp4`);
  }),
);

// Connection details (LiveKit token)
router.get(
  '/:id/connection',
  authMiddleware(),
  getActiveMeeting,
  checkKickedStatus,
  checkMeetingAccess,
  asyncWrapper(async (req, res) => {
    try {
      const meetingId = req.params.id;
      const user = req.user!;
      const meeting = req.meeting!;
      const meetingSource = (req as any).meetingSource as 'course' | 'general_course_group' | undefined;

      const isOwner = sameUserId(user.id, meeting.created_by);
      const canScreenShare = await canUserIssueScreenShareToken({
        user,
        meeting,
        meetingSource,
      });
      const { teacherName, teacherIcon } = await resolveMeetingTeacherDisplay(
        meeting.created_by,
        req.tenant as any,
      );

      // Mark live for students immediately. Do NOT start egress here — LiveKit room
      // usually does not exist until the host joins; room_started webhook starts recording.
      if (isOwner && (meeting as any).status === 'idle') {
        if (meetingSource === 'general_course_group') {
          await pool.query(
            `UPDATE general_course_group_meeting SET status = 'started', updated_at = CURRENT_TIMESTAMP
             WHERE id = $1 AND status = 'idle'`,
            [meetingId],
          );
        } else {
          const courseStart = await pool.query<{ title: string; course_id: number }>(
            `UPDATE meeting SET status = 'started', updated_at = CURRENT_TIMESTAMP
             WHERE id = $1 AND status = 'idle'
             RETURNING title, course_id`,
            [meetingId],
          );
          if (courseStart.rowCount && courseStart.rowCount > 0) {
            const startedRow = courseStart.rows[0];
            try {
              // eslint-disable-next-line @typescript-eslint/ban-ts-comment
              // @ts-ignore
              const { NotificationService } = await import('../services/notifications');
              const courseInfo = await pool.query(`SELECT id, title FROM courses WHERE id = $1 LIMIT 1`, [
                startedRow.course_id,
              ]);
              if (courseInfo.rowCount && courseInfo.rowCount > 0) {
                await NotificationService.notifyLiveStreamStarted(
                  startedRow.course_id,
                  startedRow.title,
                  courseInfo.rows[0].title,
                  true,
                  meetingId,
                );
              }
            } catch (notifError) {
              console.error('❌ [Notification] Error sending live-start notification:', notifError);
            }
          }
        }
      }

      const participantName =
        (typeof req.query.name === 'string' && req.query.name.trim()) || user.name || 'Guest';

      const participantIdentity = `user_${user.id}_meeting_${meetingId}`;

      const hostRole = isOwner || canScreenShare;

      const participantToken = await generateParticipantToken({
        roomName: meetingId, // meeting.id is also the LiveKit room name
        identity: participantIdentity,
        name: participantName,
        role: hostRole ? 'host' : 'participant',
        allowChat: (meeting as any).allow_chat !== false,
        metadata: JSON.stringify({
          avatar: user.avatar || null,
          role: hostRole ? 'host' : 'participant',
        }),
      });

      let screenShareToken: string | undefined;
      let screenShareApp: ReturnType<typeof buildScreenShareAppInfo> | undefined;

      if (canScreenShare) {
        screenShareApp = buildScreenShareAppInfo(req, meetingId);
        // الموقع يحتاج التوكن لفتح التطبيق. لا نمنع الإصدار بسبب غياب هيدر EAS.
        screenShareToken = await generateParticipantToken({
          roomName: meetingId,
          identity: `${participantIdentity}_screenShare`,
          name: participantName,
          role: 'host',
          ttl: '2h',
          metadata: JSON.stringify({
            role: 'host',
            hidden: true,
            easProjectId: screenShareApp.easProjectId,
          }),
        });
      }

      return res.json({
        participantToken,
        screenShareToken: screenShareToken || null,
        screenShareApp: screenShareApp ?? null,
        serverUrl: LIVEKIT_SERVER_URL,
        roomName: meetingId,
        meetingName: meeting.title,
        teacherName,
        teacherIcon,
        participantName,
        isOwner: hostRole,
      });
    } catch (err) {
      console.log('error', err);
    }
  }),
);

// Get current active meeting
router.get(
  '/me/current',
  authMiddleware(['admin', 'teacher']),
  asyncWrapper(async (req, res) => {
    const user = req.user!;

    const result = await pool.query(
      `
      SELECT *
      FROM meeting
      WHERE created_by = $1
        AND status IN ('started', 'idle')
      ORDER BY created_at DESC
      LIMIT 1
      `,
      [user.id],
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'No active meeting found' });
    }

    return res.json({ meeting: result.rows[0] });
  }),
);

/**
 * -------------------------
 * MEETING LISTINGS
 * -------------------------
 */

// Get my meetings (optionally filter by course)
router.get(
  '/me',
  authMiddleware(['admin', 'teacher']),
  asyncWrapper(async (req, res) => {
    const user = req.user!;
    const { courseId, limit = 10, skip = 0 } = req.query;

    let query = `
      SELECT m.*
      FROM meeting m
      WHERE m.created_by = $1
    `;
    const params: any[] = [user.id];
    let paramIndex = 2;

    if (courseId) {
      query += ` AND m.course_id = $${paramIndex++}`;
      params.push(courseId);
    }

    query += ` ORDER BY m.created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex}`;
    params.push(Number(limit), Number(skip));

    const result = await pool.query(query, params);
    res.json({
      meetings: result.rows,
      pagination: {
        limit: Number(limit),
        skip: Number(skip),
        count: result.rows.length,
      },
    });
  }),
);

// Admin: list all meetings (optionally filter by course) with pagination
router.get(
  '/',
  authMiddleware(['admin']),
  asyncWrapper(async (req, res) => {
    const { courseId, limit = 10, skip = 0 } = req.query;

    const limitNum = Number(limit);
    const skipNum = Number(skip);

    // Base query
    let query = `
      SELECT m.*, u.name AS creator_name, c.title AS course_title
      FROM meeting m
      JOIN users u ON u.id = m.created_by
      JOIN courses c ON c.id = m.course_id
    `;
    const params: any[] = [];

    if (courseId) {
      query += ` WHERE m.course_id = $1`;
      params.push(courseId);
    }

    query += ` ORDER BY m.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limitNum, skipNum);

    const result = await pool.query(query, params);

    // Count total rows (for pagination UI)
    let countQuery = `SELECT COUNT(*) FROM meeting`;
    const countParams: any[] = [];

    if (courseId) {
      countQuery += ` WHERE course_id = $1`;
      countParams.push(courseId);
    }

    const countResult = await pool.query(countQuery, countParams);
    const total = Number(countResult.rows[0].count);

    res.json({
      meetings: result.rows,
      pagination: {
        total,
        page: Math.floor(skipNum / limitNum) + 1,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  }),
);

// Get meetings for a specific course
router.get(
  '/course/:courseId',
  isEnrolledInMeetingCourse,
  asyncWrapper(async (req, res) => {
    const { courseId } = req.params;

    const result = await pool.query(
      `
      SELECT m.*, u.name AS creator_name
      FROM meeting m
      JOIN users u ON u.id = m.created_by
      WHERE m.course_id = $1
      ORDER BY m.created_at DESC
      `,
      [courseId],
    );

    res.json({ meetings: result.rows });
  }),
);

/**
 * -------------------------
 * WEBHOOKS
 * -------------------------
 */

const receiver = new WebhookReceiver(LIVEKIT_API_KEY, LIVEKIT_API_SECRET);

// Handle LiveKit events
router.post('/webhook', async (req, res) => {
  try {
    const event = await receiver.receive(req.body, req.get('Authorization'));
    if (event.event === 'room_started') {
      const { name, sid } = event.room!;
      // Claim recording when:
      // - idle → started (normal), OR
      // - already started by /connection but room_sid still null (host got token before room existed)
      // Do NOT restart after ended or when room_sid is already set (avoids overwriting MP4).
      const idleStart = await pool.query(
        `UPDATE meeting SET status = 'started', room_sid = $1, updated_at = CURRENT_TIMESTAMP
         WHERE id = $2 AND status = 'idle'
         RETURNING *`,
        [sid, name],
      );

      let shouldStartEgress = Boolean(idleStart.rowCount && idleStart.rowCount > 0);
      let startedMeeting: { title: string; created_by: number } | null =
        shouldStartEgress && idleStart.rows[0] ? idleStart.rows[0] : null;

      if (shouldStartEgress) {
        try {
          const meeting = idleStart.rows[0];
          const courseInfo = await pool.query(`SELECT id, title FROM courses WHERE id = $1`, [
            meeting.course_id,
          ]);
          if (courseInfo.rowCount && courseInfo.rowCount > 0) {
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            const { NotificationService } = await import('../services/notifications');
            await NotificationService.notifyLiveStreamStarted(
              meeting.course_id,
              meeting.title,
              courseInfo.rows[0].title,
              true,
              meeting.id,
            );
          }
        } catch (notifError) {
          console.error('Error sending live stream notification:', notifError);
        }
      } else {
        const lateClaim = await pool.query(
          `UPDATE meeting SET room_sid = $1, updated_at = CURRENT_TIMESTAMP
           WHERE id = $2 AND status = 'started' AND room_sid IS NULL
           RETURNING title, created_by`,
          [sid, name],
        );
        if (lateClaim.rowCount && lateClaim.rowCount > 0) {
          shouldStartEgress = true;
          startedMeeting = lateClaim.rows[0];
        }
      }

      if (!shouldStartEgress) {
        const groupIdle = await pool.query(
          `UPDATE general_course_group_meeting SET status = 'started', room_sid = $1, updated_at = CURRENT_TIMESTAMP
           WHERE id = $2 AND status = 'idle'
           RETURNING *`,
          [sid, name],
        );
        if (groupIdle.rowCount && groupIdle.rowCount > 0) {
          shouldStartEgress = true;
          startedMeeting = groupIdle.rows[0];
          try {
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            const { NotificationService } = await import('../services/notifications');
            const meeting = groupIdle.rows[0];
            const groupRow = await pool.query(
              `SELECT g.general_course_id, c.title FROM general_course_groups g
               JOIN general_courses c ON c.id = g.general_course_id WHERE g.id = $1`,
              [meeting.group_id],
            );
            if (groupRow.rowCount) {
              await NotificationService.notifyGeneralCourseGroupLiveStreamStarted(
                meeting.group_id,
                groupRow.rows[0].general_course_id,
                meeting.title,
                groupRow.rows[0].title,
                true,
              );
            }
          } catch (notifError) {
            console.error('Error sending group live stream notification:', notifError);
          }
        } else {
          const groupLate = await pool.query(
            `UPDATE general_course_group_meeting SET room_sid = $1, updated_at = CURRENT_TIMESTAMP
             WHERE id = $2 AND status = 'started' AND room_sid IS NULL
             RETURNING title, created_by`,
            [sid, name],
          );
          if (groupLate.rowCount && groupLate.rowCount > 0) {
            shouldStartEgress = true;
            startedMeeting = groupLate.rows[0];
          }
        }
      }

      if (shouldStartEgress && startedMeeting) {
        console.log('[Meeting webhook] room_started → starting egress for', name);
        await startMeetingRecordingEgress(name, startedMeeting);
      } else {
        console.warn('Skipping egress restart for room (already claimed or ended):', name);
      }
    } else if (event.event === 'room_finished') {
      const sid = event.room!.sid;
      const meetingUpdated = await pool.query<{ id: string }>(
        `UPDATE meeting SET status = 'ended' WHERE room_sid = $1 RETURNING id`,
        [sid],
      );
      if (meetingUpdated.rowCount === 0) {
        const groupUpdated = await pool.query<{ id: string }>(
          `UPDATE general_course_group_meeting SET status = 'ended' WHERE room_sid = $1 RETURNING id`,
          [sid],
        );
        if (groupUpdated.rowCount && groupUpdated.rowCount > 0) {
          try {
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            const { NotificationService } = await import('../services/notifications');
            await NotificationService.removeLiveStreamNotificationsByMeetingId(groupUpdated.rows[0].id);
          } catch (notifError) {
            console.error('Error removing ended group live notifications:', notifError);
          }
        }
      } else {
        try {
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-ignore
          const { NotificationService } = await import('../services/notifications');
          await NotificationService.removeLiveStreamNotificationsByMeetingId(meetingUpdated.rows[0].id);
        } catch (notifError) {
          console.error('Error removing ended live notifications:', notifError);
        }
      }
    } else if (event.event === 'egress_ended') {
      const roomName = event.egressInfo?.roomName;
      console.log('[Meeting webhook] egress_ended for room:', roomName);

      if (!roomName) {
        console.warn('Room name not available in egress_ended event', event);
        return res.status(400).send('Room name missing');
      }

      const recordingFilePath = `/recordings/${roomName}.mp4`;
      let meetingTitle: string | null = null;
      let table: 'meeting' | 'general_course_group_meeting' = 'meeting';

      const meetingResult = await pool.query(`SELECT title FROM meeting WHERE id = $1 LIMIT 1`, [roomName]);
      if (meetingResult.rowCount && meetingResult.rowCount > 0) {
        meetingTitle = meetingResult.rows[0].title;
      } else {
        const groupResult = await pool.query(
          `SELECT title FROM general_course_group_meeting WHERE id = $1 LIMIT 1`,
          [roomName],
        );
        if (groupResult.rowCount && groupResult.rowCount > 0) {
          meetingTitle = groupResult.rows[0].title;
          table = 'general_course_group_meeting';
        }
      }

      if (!meetingTitle) {
        console.warn('Meeting not found for room:', roomName);
        return res.status(404).send('Meeting not found');
      }

      const recordingTable: MeetingRecordingTable = table;
      void processMeetingRecordingAfterEgress({
        roomName,
        recordingFilePath,
        meetingTitle,
        table: recordingTable,
      }).catch((uploadError) => {
        console.error('Async meeting recording upload failed:', uploadError);
      });
    }
    res.status(200).send('OK');
  } catch (err) {
    console.error('Webhook error:', err);
    res.status(500).send('Error handling webhook');
  }
});

export { router };
