import { Router } from 'express';
import { authMiddleware } from '../middleware/authentication';
import { asyncWrapper } from '../utils';
import { SocialService } from '../services/social';
import { NotificationService } from '../services/notifications';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { uploadToCloudinary } from '../utils';
import { z } from 'zod';
import pool from '../db/pool';

export const router = Router();
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(__dirname, '../../uploads');
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const uniqueName = `${Date.now()}-${file.originalname}`;
      cb(null, uniqueName);
    },
  }),
  limits: { fileSize: 30 * 1024 * 1024 },
});

// Create post
router.post(
  '/posts',
  authMiddleware(['student', 'teacher', 'admin']),
  upload.array('media', 10),
  asyncWrapper(async (req, res) => {
    const parse = z
      .object({
        content: z.string().trim().optional(),
        visibility: z.enum(['public', 'grades', 'teachers', 'students']).optional(),
        media_type: z.enum(['image', 'video', 'file']).optional(),
      })
      .safeParse(req.body || {});
    if (!parse.success) {
      return res.status(400).json({ message: 'Invalid payload', errors: parse.error.flatten() });
    }
    const { content, visibility, media_type } = parse.data;
    const files = ((req as any).files as Express.Multer.File[] | undefined) || [];
    let mediaUrl: string | undefined = undefined;
    let type: string | undefined = media_type;
    const media_list: any[] = [];

    if (files.length) {
      for (const f of files) {
        const uploaded = await uploadToCloudinary(f.path);
        const mime = f.mimetype;
        const inferred = mime.startsWith('image/')
          ? 'image'
          : mime.startsWith('video/')
            ? 'video'
            : 'file';
        media_list.push({
          url: uploaded.secure_url,
          type: inferred,
          name: f.originalname,
          mime,
          size: f.size,
        });
      }
      // keep top-level media fields for backward compatibility (first media)
      mediaUrl = media_list[0]?.url;
      type = type ?? media_list[0]?.type;
    }

    if ((!content || content.length === 0) && !mediaUrl) {
      return res.status(400).json({ message: 'content or media is required' });
    }

    const post = await SocialService.createPost(req.user!.id, {
      content,
      media_url: mediaUrl,
      media_type: type,
      visibility,
      media_list,
    });
    const appAny = req.app as any;
    if (typeof appAny.emitPostCreated === 'function') appAny.emitPostCreated(post);
    res.status(201).json({ post });
  }),
);

// Feed
router.get(
  '/posts',
  authMiddleware(),
  asyncWrapper(async (req, res) => {
    const { limit, before } = req.query as any;
    const posts = await SocialService.listPosts(req.user!.id, req.user!.role, limit ? Number(limit) : 20, before);
    res.json({ posts });
  }),
);

// جلب جميع البوستات مع البوستات المثبتة في المقدمة (مع تطبيق قواعد الظهور)
router.get(
  '/posts/feed',
  authMiddleware(),
  asyncWrapper(async (req, res) => {
    const { limit = 20, before } = req.query as any;

    // جلب البوستات المثبتة التي يسمح للمستخدم برؤيتها فقط
    const pinnedPosts = await SocialService.listVisiblePinnedPosts(req.user!.id, req.user!.role);

    // جلب البوستات العادية (بدون المثبتة لتجنب التكرار)
    const regularPosts = await SocialService.listPosts(req.user!.id, req.user!.role, limit, before, true);

    // دمج البوستات مع البوستات المثبتة في المقدمة
    const allPosts = [...pinnedPosts, ...regularPosts];

    // إضافة media_list للبوستات المثبتة
    if (pinnedPosts.length > 0) {
      const pinnedIds = pinnedPosts.map((p: any) => p.id);
      const media = await pool.query(
        `SELECT * FROM social_post_media WHERE post_id = ANY($1::bigint[]) ORDER BY position`,
        [pinnedIds],
      );
      const mediaMap: Record<number, any[]> = {};
      for (const m of media.rows) {
        (mediaMap[m.post_id] ||= []).push({
          id: m.id,
          url: m.url,
          type: m.type,
          name: m.name,
          mime: m.mime,
          size: m.size,
          position: m.position,
        });
      }
      for (const p of pinnedPosts) {
        p.media_list = mediaMap[p.id] || [];
      }
    }

    res.json({
      posts: allPosts,
      pinned_count: pinnedPosts.length,
      regular_count: regularPosts.length,
    });
  }),
);

// Add comment or reply
router.post(
  '/posts/:postId/comments',
  authMiddleware(),
  asyncWrapper(async (req, res) => {
    const postId = Number(req.params.postId);
    if (isNaN(postId)) return res.status(400).json({ message: 'Invalid post id' });
    const canSee = await SocialService.canUserSeePost(req.user!.id, req.user!.role, postId);
    if (!canSee) return res.status(403).json({ message: 'You cannot comment on this post' });
    const comment = await SocialService.addComment(postId, req.user!.id, req.body || {});

    // إرسال إشعار لصاحب المنشور
    try {
      const postResult = await pool.query('SELECT author_id FROM social_posts WHERE id = $1', [
        postId,
      ]);
      if (postResult.rowCount && postResult.rows[0].author_id !== req.user!.id) {
        const actorResult = await pool.query('SELECT name, role FROM users WHERE id = $1', [
          req.user!.id,
        ]);
        const actorName =
          req.user!.role === 'admin' ? 'Next Edu' : actorResult.rows[0]?.name || 'مستخدم';

        // تحديد نوع الإشعار (تعليق أو رد)
        const isReply = comment.parent_comment_id ? 'reply' : 'comment';
        const actionType = isReply === 'reply' ? 'reply' : 'comment';

        await NotificationService.notifySocialInteraction(
          postResult.rows[0].author_id,
          postId,
          comment.id,
          actorName,
          req.body?.content || 'تعليق جديد',
          actionType,
          req.user!.id, // إضافة sender_id
        );
      }
    } catch (error) {
      console.error('خطأ في إرسال إشعار التعليق:', error);
    }

    const appAny = req.app as any;
    if (typeof appAny.emitCommentCreated === 'function')
      appAny.emitCommentCreated({ post_id: postId, comment });
    res.status(201).json({ comment });
  }),
);

// List comments
router.get(
  '/posts/:postId/comments',
  authMiddleware(),
  asyncWrapper(async (req, res) => {
    const postId = Number(req.params.postId);
    if (isNaN(postId)) return res.status(400).json({ message: 'Invalid post id' });
    const canSee = await SocialService.canUserSeePost(req.user!.id, req.user!.role, postId);
    if (!canSee) return res.status(403).json({ message: 'You cannot view comments for this post' });
    const comments = await SocialService.listComments(postId);
    res.json({ comments });
  }),
);

// Update post (owner or admin)
router.put(
  '/posts/:postId',
  authMiddleware(['student', 'teacher', 'admin']),
  asyncWrapper(async (req, res) => {
    const postId = Number(req.params.postId);
    if (isNaN(postId)) return res.status(400).json({ message: 'Invalid post id' });

    const row = await pool.query('SELECT author_id FROM social_posts WHERE id = $1', [postId]);
    if (!row.rowCount) return res.status(404).json({ message: 'Post not found' });
    if (req.user!.role !== 'admin' && row.rows[0].author_id !== req.user!.id) {
      return res.status(403).json({ message: 'Not allowed' });
    }

    const schema = z.object({
      content: z.string().optional(),
      visibility: z.enum(['public', 'grades', 'teachers', 'students']).optional(),
    });
    const parsed = schema.safeParse(req.body || {});
    if (!parsed.success)
      return res.status(400).json({ message: 'Invalid payload', errors: parsed.error.flatten() });

    const fields: string[] = [];
    const values: any[] = [];
    let i = 1;
    if (parsed.data.content !== undefined) {
      fields.push(`content = $${i++}`);
      values.push(parsed.data.content);
    }
    if (parsed.data.visibility !== undefined) {
      fields.push(`visibility = $${i++}`);
      values.push(parsed.data.visibility);
    }
    if (!fields.length) return res.status(400).json({ message: 'No fields to update' });
    values.push(postId);
    const updated = await pool.query(
      `UPDATE social_posts SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`,
      values,
    );
    res.json({ post: updated.rows[0] });
  }),
);

// Delete post (owner or admin)
router.delete(
  '/posts/:postId',
  authMiddleware(['student', 'teacher', 'admin']),
  asyncWrapper(async (req, res) => {
    const postId = Number(req.params.postId);
    if (isNaN(postId)) return res.status(400).json({ message: 'Invalid post id' });
    const row = await pool.query('SELECT author_id FROM social_posts WHERE id = $1', [postId]);
    if (!row.rowCount) return res.status(404).json({ message: 'Post not found' });
    if (req.user!.role !== 'admin' && row.rows[0].author_id !== req.user!.id) {
      return res.status(403).json({ message: 'Not allowed' });
    }
    await pool.query('DELETE FROM social_posts WHERE id = $1', [postId]);
    res.json({ success: true });
  }),
);

// Update comment (owner or admin)
router.put(
  '/comments/:commentId',
  authMiddleware(['student', 'teacher', 'admin']),
  asyncWrapper(async (req, res) => {
    const commentId = Number(req.params.commentId);
    if (isNaN(commentId)) return res.status(400).json({ message: 'Invalid comment id' });
    const row = await pool.query('SELECT author_id FROM social_comments WHERE id = $1', [
      commentId,
    ]);
    if (!row.rowCount) return res.status(404).json({ message: 'Comment not found' });
    if (req.user!.role !== 'admin' && row.rows[0].author_id !== req.user!.id) {
      return res.status(403).json({ message: 'Not allowed' });
    }
    const schema = z.object({ content: z.string().min(1) });
    const parsed = schema.safeParse(req.body || {});
    if (!parsed.success)
      return res.status(400).json({ message: 'Invalid payload', errors: parsed.error.flatten() });
    const updated = await pool.query(
      'UPDATE social_comments SET content = $1 WHERE id = $2 RETURNING *',
      [parsed.data.content, commentId],
    );
    res.json({ comment: updated.rows[0] });
  }),
);

// Delete comment (owner or admin)
router.delete(
  '/comments/:commentId',
  authMiddleware(['student', 'teacher', 'admin']),
  asyncWrapper(async (req, res) => {
    const commentId = Number(req.params.commentId);
    if (isNaN(commentId)) return res.status(400).json({ message: 'Invalid comment id' });
    const row = await pool.query('SELECT author_id FROM social_comments WHERE id = $1', [
      commentId,
    ]);
    if (!row.rowCount) return res.status(404).json({ message: 'Comment not found' });
    if (req.user!.role !== 'admin' && row.rows[0].author_id !== req.user!.id) {
      return res.status(403).json({ message: 'Not allowed' });
    }
    await pool.query('DELETE FROM social_comments WHERE id = $1', [commentId]);
    res.json({ success: true });
  }),
);
// React to post or comment
router.post(
  '/reactions',
  authMiddleware(),
  asyncWrapper(async (req, res) => {
    const { post_id, comment_id, reaction } = req.body || {};
    if (!reaction || !['like', 'love', 'support'].includes(reaction)) {
      return res.status(400).json({ message: 'Invalid reaction' });
    }
    if (!post_id && !comment_id)
      return res.status(400).json({ message: 'post_id or comment_id required' });
    if (post_id) {
      const canSee = await SocialService.canUserSeePost(req.user!.id, req.user!.role, post_id);
      if (!canSee) return res.status(403).json({ message: 'You cannot react to this post' });
    } else if (comment_id) {
      const commentRow = await pool.query('SELECT post_id FROM social_comments WHERE id = $1', [comment_id]);
      if (commentRow.rowCount && commentRow.rows[0].post_id) {
        const canSee = await SocialService.canUserSeePost(req.user!.id, req.user!.role, commentRow.rows[0].post_id);
        if (!canSee) return res.status(403).json({ message: 'You cannot react to this comment' });
      }
    }
    await SocialService.react(req.user!.id, { post_id, comment_id, reaction });

    // إرسال إشعار للمالك
    try {
      const actorResult = await pool.query('SELECT name, role FROM users WHERE id = $1', [
        req.user!.id,
      ]);
      const actorName =
        req.user!.role === 'admin' ? 'Next Edu' : actorResult.rows[0]?.name || 'مستخدم';

      if (post_id) {
        // إعجاب على منشور
        const postResult = await pool.query('SELECT author_id FROM social_posts WHERE id = $1', [
          post_id,
        ]);
        if (postResult.rowCount && postResult.rows[0].author_id !== req.user!.id) {
          await NotificationService.notifySocialInteraction(
            postResult.rows[0].author_id,
            post_id,
            null,
            actorName,
            reaction,
            'like',
            req.user!.id, // إضافة sender_id
          );
        }
      } else if (comment_id) {
        // إعجاب على تعليق
        const commentResult = await pool.query(
          'SELECT author_id FROM social_comments WHERE id = $1',
          [comment_id],
        );
        if (commentResult.rowCount && commentResult.rows[0].author_id !== req.user!.id) {
          await NotificationService.notifySocialInteraction(
            commentResult.rows[0].author_id,
            null,
            comment_id,
            actorName,
            reaction,
            'reaction',
            req.user!.id, // إضافة sender_id
          );
        }
      }
    } catch (error) {
      console.error('خطأ في إرسال إشعار الإعجاب:', error);
    }

    res.json({ success: true });
  }),
);

// تثبيت/إلغاء تثبيت بوست (للإدمن فقط)
router.patch(
  '/posts/:postId/pin',
  authMiddleware(['admin']),
  asyncWrapper(async (req, res) => {
    const postId = Number(req.params.postId);
    if (isNaN(postId)) return res.status(400).json({ message: 'Invalid post id' });

    const { is_pinned, pinned_order } = req.body;

    // التحقق من وجود البوست
    const postCheck = await pool.query('SELECT id FROM social_posts WHERE id = $1', [postId]);
    if (!postCheck.rowCount) {
      return res.status(404).json({ message: 'Post not found' });
    }

    let updateQuery = 'UPDATE social_posts SET is_pinned = $1';
    const queryParams: any[] = [is_pinned];
    let paramIndex = 2;

    if (is_pinned && pinned_order !== undefined) {
      updateQuery += `, pinned_order = $${paramIndex}`;
      queryParams.push(pinned_order);
      paramIndex++;
    } else if (!is_pinned) {
      updateQuery += ', pinned_order = NULL';
    }

    updateQuery += ` WHERE id = $${paramIndex} RETURNING *`;
    queryParams.push(postId);

    const result = await pool.query(updateQuery, queryParams);

    res.json({
      success: true,
      post: result.rows[0],
      message: is_pinned ? 'Post pinned successfully' : 'Post unpinned successfully',
    });
  }),
);

// تحديث ترتيب البوستات المثبتة (للإدمن فقط)
router.patch(
  '/posts/pinned-order',
  authMiddleware(['admin']),
  asyncWrapper(async (req, res) => {
    const { pinned_posts } = req.body;

    if (!Array.isArray(pinned_posts)) {
      return res.status(400).json({ message: 'pinned_posts must be an array' });
    }

    try {
      // تحديث ترتيب كل بوست مثبت
      for (let i = 0; i < pinned_posts.length; i++) {
        const postId = pinned_posts[i];
        if (typeof postId === 'number') {
          await pool.query(
            'UPDATE social_posts SET pinned_order = $1 WHERE id = $2 AND is_pinned = true',
            [i + 1, postId],
          );
        }
      }

      res.json({
        success: true,
        message: 'Pinned posts order updated successfully',
      });
    } catch (error) {
      console.error('Error updating pinned posts order:', error);
      res.status(500).json({ message: 'Failed to update pinned posts order' });
    }
  }),
);

// جلب البوستات المثبتة (مع تطبيق قواعد الظهور)
router.get(
  '/posts/pinned',
  authMiddleware(),
  asyncWrapper(async (req, res) => {
    const pinnedPosts = await SocialService.listVisiblePinnedPosts(req.user!.id, req.user!.role);
    if (pinnedPosts.length > 0) {
      const ids = pinnedPosts.map((p: any) => p.id);
      const media = await pool.query(
        `SELECT * FROM social_post_media WHERE post_id = ANY($1::bigint[]) ORDER BY position`,
        [ids],
      );
      const mediaMap: Record<number, any[]> = {};
      for (const m of media.rows) {
        (mediaMap[m.post_id] ||= []).push({
          id: m.id,
          url: m.url,
          type: m.type,
          name: m.name,
          mime: m.mime,
          size: m.size,
          position: m.position,
        });
      }
      for (const p of pinnedPosts) {
        p.media_list = mediaMap[p.id] || [];
      }
    }
    res.json({ pinned_posts: pinnedPosts });
  }),
);

// ---- Stories Endpoints ----

router.post(
  '/stories',
  authMiddleware(['admin', 'teacher']),
  upload.single('media'),
  asyncWrapper(async (req, res) => {
    const parse = z
      .object({
        type: z.enum(['text', 'image', 'video', 'text_image', 'text_video']),
        content: z.string().optional(),
      })
      .safeParse(req.body || {});
    if (!parse.success) {
      return res.status(400).json({ message: 'Invalid payload', errors: parse.error.flatten() });
    }
    const { type, content } = parse.data;
    const file = (req as any).file as Express.Multer.File | undefined;
    let mediaUrl: string | undefined = undefined;

    if (file) {
      const uploaded = await uploadToCloudinary(file.path);
      mediaUrl = uploaded.secure_url;
    }

    if (type.includes('text') && (!content || content.trim().length === 0)) {
      return res.status(400).json({ message: 'Text content is required for this story type' });
    }

    const story = await SocialService.createStory(req.user!.id, {
      type,
      content,
      media_url: mediaUrl,
    });

    // Optional socket emit
    const appAny = req.app as any;
    if (typeof appAny.emitStoryCreated === 'function') appAny.emitStoryCreated(story);

    res.status(201).json({ story });
  }),
);

router.get(
  '/stories',
  authMiddleware(),
  asyncWrapper(async (req, res) => {
    const stories = await SocialService.listStories(req.user!.id, req.user!.role);
    res.json({ stories });
  }),
);

// تسجيل مشاهدة استوري (يُستدعى عند فتح/عرض الاستوري — لتمييز المشاهد من غير المشاهد)
router.post(
  '/stories/:storyId/view',
  authMiddleware(),
  asyncWrapper(async (req, res) => {
    const storyId = Number(req.params.storyId);
    if (isNaN(storyId)) return res.status(400).json({ message: 'Invalid story id' });

    const canSee = await SocialService.canUserSeeStory(req.user!.id, req.user!.role, storyId);
    if (!canSee) return res.status(403).json({ message: 'You cannot view this story' });

    await SocialService.recordStoryView(req.user!.id, storyId);
    res.json({ success: true, viewed: true });
  }),
);

router.delete(
  '/stories/:storyId',
  authMiddleware(['admin', 'teacher']),
  asyncWrapper(async (req, res) => {
    const storyId = Number(req.params.storyId);
    if (isNaN(storyId)) return res.status(400).json({ message: 'Invalid story id' });

    const row = await pool.query('SELECT author_id FROM social_stories WHERE id = $1', [storyId]);
    if (!row.rowCount) return res.status(404).json({ message: 'Story not found' });
    if (req.user!.role !== 'admin' && row.rows[0].author_id !== req.user!.id) {
      return res.status(403).json({ message: 'Not allowed' });
    }

    await SocialService.deleteStory(storyId);
    res.json({ success: true });
  }),
);

router.post(
  '/stories/:storyId/replies',
  authMiddleware(),
  asyncWrapper(async (req, res) => {
    const storyId = Number(req.params.storyId);
    if (isNaN(storyId)) return res.status(400).json({ message: 'Invalid story id' });

    const { content, student_id } = req.body || {};
    if (!content || typeof content !== 'string' || !content.trim()) {
      return res.status(400).json({ message: 'Content is required' });
    }

    let targetStudentId: number;
    if (req.user!.role === 'student') {
      targetStudentId = req.user!.id;
      const canSee = await SocialService.canUserSeeStory(req.user!.id, 'student', storyId);
      if (!canSee) return res.status(403).json({ message: 'You cannot reply to this story' });
    } else if (req.user!.role === 'teacher') {
      targetStudentId = Number(student_id);
      if (!student_id || isNaN(targetStudentId)) {
        return res.status(400).json({ message: 'student_id is required when teacher replies' });
      }
      const storyRow = await pool.query(
        'SELECT author_id FROM social_stories WHERE id = $1 AND expires_at > NOW()',
        [storyId]
      );
      if (!storyRow.rowCount) return res.status(404).json({ message: 'Story not found' });
      const authorId = storyRow.rows[0].author_id;
      const authorRole = (await pool.query('SELECT role FROM users WHERE id = $1', [authorId])).rows[0]?.role;
      const isOwnOrAdminStory = authorId === req.user!.id || authorRole === 'admin';
      if (!isOwnOrAdminStory) return res.status(403).json({ message: 'You cannot reply to this story' });
      const canAccess = await SocialService.canTeacherAccessStudentForStory(req.user!.id, targetStudentId);
      if (!canAccess) return res.status(403).json({ message: 'You can only reply to students in your courses' });
    } else {
      // admin
      targetStudentId = Number(student_id);
      if (!student_id || isNaN(targetStudentId)) {
        return res.status(400).json({ message: 'student_id is required when admin replies' });
      }
    }

    const reply = await SocialService.addStoryReply(storyId, req.user!.id, targetStudentId, content.trim());

    // TODO: Socket.io emission if available
    res.status(201).json({ reply });
  }),
);

router.get(
  '/stories/:storyId/replies/:studentId',
  authMiddleware(),
  asyncWrapper(async (req, res) => {
    const storyId = Number(req.params.storyId);
    let targetStudentId = Number(req.params.studentId);
    if (isNaN(storyId)) return res.status(400).json({ message: 'Invalid story id' });

    if (req.user!.role === 'student') {
      targetStudentId = req.user!.id;
      const canSee = await SocialService.canUserSeeStory(req.user!.id, 'student', storyId);
      if (!canSee) return res.status(403).json({ message: 'You cannot view replies for this story' });
    } else if (req.user!.role === 'teacher') {
      if (isNaN(targetStudentId)) return res.status(400).json({ message: 'Invalid student id' });
      const canAccess = await SocialService.canTeacherAccessStudentForStory(req.user!.id, targetStudentId);
      if (!canAccess) return res.status(403).json({ message: 'You can only view replies for students in your courses' });
    } else if (isNaN(targetStudentId)) {
      return res.status(400).json({ message: 'Invalid student id' });
    }

    const replies = await SocialService.getStoryReplies(storyId, targetStudentId);
    res.json({ replies });
  }),
);

export default router;
