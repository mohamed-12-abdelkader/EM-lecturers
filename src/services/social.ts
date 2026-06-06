import pool from '../db/pool';

export type Post = {
  id: number;
  author_id: number;
  content: string | null;
  media_url: string | null;
  media_type: 'image' | 'video' | 'file' | null;
  visibility: 'public' | 'grades' | 'teachers' | 'students';
  created_at: string;
  author_name?: string;
  reactions?: Record<string, number>;
};

export class SocialService {
  static async createPost(
    authorId: number,
    data: {
      content?: string;
      media_url?: string;
      media_type?: string;
      visibility?: string;
      media_list?: {
        url: string;
        type: string;
        name?: string | null;
        mime?: string | null;
        size?: number | null;
      }[];
    },
  ) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const res = await client.query<Post>(
        `INSERT INTO social_posts (author_id, content, media_url, media_type, visibility)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [
          authorId,
          data.content ?? null,
          data.media_url ?? null,
          data.media_type ?? null,
          data.visibility ?? 'public',
        ],
      );
      const post = res.rows[0];

      // جلب بيانات المؤلف (الاسم والصورة)
      const authorRes = await client.query(
        `SELECT 
          CASE WHEN role = 'admin' THEN 'Next Edu' ELSE name END AS author_name,
          avatar AS author_avatar
         FROM users WHERE id = $1`,
        [authorId],
      );
      if (authorRes.rowCount && authorRes.rowCount > 0) {
        post.author_name = authorRes.rows[0].author_name;
        (post as any).author_avatar = authorRes.rows[0].author_avatar;
      }
      if (data.media_list && data.media_list.length) {
        let pos = 0;
        for (const m of data.media_list) {
          await client.query(
            `INSERT INTO social_post_media (post_id, url, type, name, mime, size, position) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [post.id, m.url, m.type, m.name ?? null, m.mime ?? null, m.size ?? null, pos++],
          );
        }
      }
      await client.query('COMMIT');
      return post;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  /** Check if a user (viewer) is allowed to see a specific post (for comment/reaction access). */
  static async canUserSeePost(viewerId: number, viewerRole: string, postId: number): Promise<boolean> {
    const postRow = await pool.query(
      `SELECT p.author_id, u.role AS author_role FROM social_posts p JOIN users u ON u.id = p.author_id WHERE p.id = $1`,
      [postId]
    );
    if (!postRow.rowCount) return false;
    const authorId = postRow.rows[0].author_id;
    const authorRole = postRow.rows[0].author_role;

    if (viewerRole === 'admin') return true;
    if (authorId === viewerId) return true;
    if (authorRole === 'admin') return true;

    if (viewerRole === 'teacher') {
      // Teacher sees: admin, own, students in their courses
      if (authorRole === 'student') {
        const enrolled = await pool.query(
          `SELECT 1 FROM enrollments e JOIN courses c ON c.id = e.course_id WHERE c.teacher_id = $1 AND e.user_id = $2 LIMIT 1`,
          [viewerId, authorId]
        );      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
        return enrolled.rowCount > 0;
      }
      return false; // teacher does not see other teachers' posts
    }

    // viewer is student
    if (authorRole === 'teacher') {
      const hasCourse = await pool.query(
        `SELECT 1 FROM enrollments e JOIN courses c ON c.id = e.course_id WHERE e.user_id = $1 AND c.teacher_id = $2 LIMIT 1`,
        [viewerId, authorId]
      );      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      return hasCourse.rowCount > 0;
    }
    if (authorRole === 'student') {
      const sameCourse = await pool.query(
        `SELECT 1 FROM enrollments e1 JOIN enrollments e2 ON e1.course_id = e2.course_id
         WHERE e1.user_id = $1 AND e2.user_id = $2 LIMIT 1`,
        [viewerId, authorId]
      );      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      return sameCourse.rowCount > 0;
    }
    return false;
  }

  /** Check if a user can see a specific story (for reply access). */
  static async canUserSeeStory(viewerId: number, viewerRole: string, storyId: number): Promise<boolean> {
    const storyRow = await pool.query(
      `SELECT s.author_id, u.role AS author_role FROM social_stories s JOIN users u ON u.id = s.author_id WHERE s.id = $1 AND s.expires_at > NOW()`,
      [storyId]
    );
    if (!storyRow.rowCount) return false;
    const authorId = storyRow.rows[0].author_id;
    const authorRole = storyRow.rows[0].author_role;

    if (viewerRole === 'admin') return true;
    if (authorId === viewerId) return true;
    if (authorRole === 'admin') return true; // admin story visible to all

    if (viewerRole === 'student' && authorRole === 'teacher') {
      const enrolled = await pool.query(
        `SELECT 1 FROM enrollments e JOIN courses c ON c.id = e.course_id WHERE e.user_id = $1 AND c.teacher_id = $2 LIMIT 1`,
        [viewerId, authorId]
      );      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      return enrolled.rowCount > 0;
    }
    return false;
  }

  /** Check if teacher can access story replies for this student (student enrolled in teacher's courses). */
  static async canTeacherAccessStudentForStory(teacherId: number, studentId: number): Promise<boolean> {
    const enrolled = await pool.query(
      `SELECT 1 FROM enrollments e JOIN courses c ON c.id = e.course_id WHERE c.teacher_id = $1 AND e.user_id = $2 LIMIT 1`,
      [teacherId, studentId]
    );
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
    return enrolled.rowCount > 0;
  }

  static async getVisibilityWhereClause(userId: number, role: string, params: any[]) {
    // Determine the base params index length based on existing params

    if (role === 'admin') {
      return '1=1';
    } else if (role === 'teacher') {
      params.push(userId);
      const idIdx = `$${params.length}`;
      return `(
        u.role = 'admin' OR 
        p.author_id = ${idIdx} OR
        p.author_id IN (
          SELECT e.user_id FROM enrollments e JOIN courses c ON c.id = e.course_id WHERE c.teacher_id = ${idIdx}
        )
      )`;
    } else {
      // student
      params.push(userId);
      const idIdx = `$${params.length}`;
      return `(
        u.role = 'admin' OR 
        p.author_id = ${idIdx} OR
        p.author_id IN (
          SELECT c.teacher_id FROM courses c JOIN enrollments e ON e.course_id = c.id WHERE e.user_id = ${idIdx}
        ) OR
        p.author_id IN (
          SELECT e2.user_id FROM enrollments e1 JOIN enrollments e2 ON e1.course_id = e2.course_id WHERE e1.user_id = ${idIdx}
        )
      )`;
    }
  }

  /** Get pinned posts that the user is allowed to see (same visibility as feed). */
  static async listVisiblePinnedPosts(userId: number, role: string) {
    const params: any[] = [];
    const visibilityCondition = await this.getVisibilityWhereClause(userId, role, params);
    const res = await pool.query<any>(
      `SELECT p.*,
              CASE WHEN u.role = 'admin' THEN 'Next Edu' ELSE u.name END AS author_name,
              u.avatar AS author_avatar,
              COALESCE(pr.c_like,0) AS likes,
              COALESCE(pr.c_love,0) AS loves,
              COALESCE(pr.c_support,0) AS supports,
              COALESCE(cc.c_comments,0) AS comments_count
       FROM social_posts p
       JOIN users u ON u.id = p.author_id
       LEFT JOIN (
         SELECT post_id,
                COUNT(*) FILTER (WHERE reaction='like')  AS c_like,
                COUNT(*) FILTER (WHERE reaction='love')  AS c_love,
                COUNT(*) FILTER (WHERE reaction='support') AS c_support
         FROM social_reactions WHERE post_id IS NOT NULL GROUP BY post_id
       ) pr ON pr.post_id = p.id
       LEFT JOIN (
         SELECT post_id, COUNT(*) AS c_comments FROM social_comments GROUP BY post_id
       ) cc ON cc.post_id = p.id
       WHERE p.is_pinned = true AND ${visibilityCondition}
       ORDER BY p.pinned_order ASC NULLS LAST, p.created_at DESC`,
      params
    );
    return res.rows;
  }

  static async listPosts(userId: number, role: string, limit = 20, before?: string, excludePinned = false) {
    const params: any[] = [];
    const visibilityCondition = await this.getVisibilityWhereClause(userId, role, params);
    let where = `WHERE ${visibilityCondition}`;
    if (excludePinned) where += ` AND (p.is_pinned IS NOT TRUE)`;

    if (before) {
      params.push(before);
      where += ` AND p.created_at < $${params.length}`;
    }
    params.push(limit);
    const res = await pool.query<any>(
      `SELECT p.*,
              CASE WHEN u.role = 'admin' THEN 'Next Edu' ELSE u.name END AS author_name,
              u.avatar AS author_avatar,
              COALESCE(pr.c_like,0) AS likes,
              COALESCE(pr.c_love,0) AS loves,
              COALESCE(pr.c_support,0) AS supports,
              COALESCE(cc.c_comments,0) AS comments_count
       FROM social_posts p 
       JOIN users u ON u.id = p.author_id
       LEFT JOIN (
         SELECT post_id,
                COUNT(*) FILTER (WHERE reaction='like')  AS c_like,
                COUNT(*) FILTER (WHERE reaction='love')  AS c_love,
                COUNT(*) FILTER (WHERE reaction='support') AS c_support
         FROM social_reactions WHERE post_id IS NOT NULL GROUP BY post_id
       ) pr ON pr.post_id = p.id
       LEFT JOIN (
         SELECT post_id, COUNT(*) AS c_comments FROM social_comments GROUP BY post_id
       ) cc ON cc.post_id = p.id
       ${where}
       ORDER BY p.is_pinned DESC, p.pinned_order ASC, p.created_at DESC
       LIMIT $${params.length}`,
      params,
    );
    const posts = res.rows;
    // attach media list
    if (posts.length) {
      const ids = posts.map((p: any) => p.id);
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
      for (const p of posts) {
        p.media_list = mediaMap[p.id] || [];
      }
    }
    return posts;
  }

  static async addComment(
    postId: number,
    authorId: number,
    data: {
      content?: string;
      media_url?: string;
      media_type?: string;
      parent_comment_id?: number | null;
    },
  ) {
    const res = await pool.query(
      `INSERT INTO social_comments (post_id, author_id, content, media_url, media_type, parent_comment_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        postId,
        authorId,
        data.content ?? null,
        data.media_url ?? null,
        data.media_type ?? null,
        data.parent_comment_id ?? null,
      ],
    );
    const comment = res.rows[0];

    // جلب بيانات المؤلف (الاسم والصورة)
    const authorRes = await pool.query(
      `SELECT 
        CASE WHEN role = 'admin' THEN 'Next Edu' ELSE name END AS author_name,
        avatar AS author_avatar
       FROM users WHERE id = $1`,
      [authorId],
    );
    if (authorRes.rowCount && authorRes.rowCount > 0) {
      (comment as any).author_name = authorRes.rows[0].author_name;
      (comment as any).author_avatar = authorRes.rows[0].author_avatar;
    }

    return comment;
  }

  static async listComments(postId: number) {
    const res = await pool.query(
      `SELECT c.*,
              CASE WHEN u.role = 'admin' THEN 'Next Edu' ELSE u.name END AS author_name,
              u.avatar AS author_avatar
       FROM social_comments c JOIN users u ON u.id = c.author_id
       WHERE c.post_id = $1
       ORDER BY c.created_at ASC`,
      [postId],
    );
    return res.rows;
  }

  static async react(
    userId: number,
    data: { post_id?: number; comment_id?: number; reaction: 'like' | 'love' | 'support' },
  ) {
    // Upsert reaction
    if (data.post_id) {
      await pool.query(
        `INSERT INTO social_reactions (user_id, post_id, reaction)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, post_id) WHERE post_id IS NOT NULL
         DO UPDATE SET reaction = EXCLUDED.reaction, created_at = NOW()`,
        [userId, data.post_id, data.reaction],
      );
    } else if (data.comment_id) {
      await pool.query(
        `INSERT INTO social_reactions (user_id, comment_id, reaction)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, comment_id) WHERE comment_id IS NOT NULL
         DO UPDATE SET reaction = EXCLUDED.reaction, created_at = NOW()`,
        [userId, data.comment_id, data.reaction],
      );
    }
  }

  // ---- Stories System ----

  static async createStory(
    authorId: number,
    data: {
      type: string;
      content?: string;
      media_url?: string;
    }
  ) {
    // Story expires in 24 hours
    const res = await pool.query(
      `INSERT INTO social_stories (author_id, type, content, media_url, expires_at)
       VALUES ($1, $2, $3, $4, NOW() + INTERVAL '24 hours')
       RETURNING *`,
      [authorId, data.type, data.content ?? null, data.media_url ?? null]
    );
    const story = res.rows[0];

    const authorRes = await pool.query(
      `SELECT CASE WHEN role = 'admin' THEN 'Next Edu' ELSE name END AS author_name, avatar AS author_avatar FROM users WHERE id = $1`,
      [authorId]
    );
    if (authorRes.rowCount) {
      story.author_name = authorRes.rows[0].author_name;
      story.author_avatar = authorRes.rows[0].author_avatar;
    }
    return story;
  }

  static async listStories(userId: number, role: string) {
    const params: any[] = [];

    // Visibility logic for stories is similar, but we alias the table differently and only want active stories.
    let visibilityCondition = '1=1';
    if (role === 'teacher') {
      params.push(userId);
      visibilityCondition = `(u.role = 'admin' OR s.author_id = $${params.length})`; // Teachers see their own and admin stories
    } else if (role === 'student') {
      params.push(userId);
      const idIdx = `$${params.length}`;
      visibilityCondition = `(
        u.role = 'admin' OR 
        s.author_id IN (
          SELECT c.teacher_id FROM courses c JOIN enrollments e ON e.course_id = c.id WHERE e.user_id = ${idIdx}
        )
      )`; // Students see admin's and their courses' teachers' stories
    }

    params.push(userId);
    const viewerParam = `$${params.length}`;

    const res = await pool.query(
      `SELECT s.*,
              CASE WHEN u.role = 'admin' THEN 'Next Edu' ELSE u.name END AS author_name,
              u.avatar AS author_avatar,
              v.viewed_at AS viewed_at,
              (v.viewed_at IS NOT NULL) AS is_viewed
       FROM social_stories s
       JOIN users u ON u.id = s.author_id
       LEFT JOIN social_story_views v ON v.story_id = s.id AND v.user_id = ${viewerParam}
       WHERE s.expires_at > NOW() AND ${visibilityCondition}
       ORDER BY s.created_at DESC`,
      params
    );

    // Grouping logic can be done on the client side, but we return a list of active stories.
    return res.rows;
  }

  /** تسجيل مشاهدة استوري من مستخدم (يُستدعى عند فتح/عرض الاستوري). */
  static async recordStoryView(userId: number, storyId: number): Promise<void> {
    await pool.query(
      `INSERT INTO social_story_views (user_id, story_id) VALUES ($1, $2)
       ON CONFLICT (user_id, story_id) DO NOTHING`,
      [userId, storyId]
    );
  }

  /** حذف الاستوريات المنتهية (expires_at مر عليها 24 ساعة). يُستدعى دورياً من الـ scheduler. */
  static async deleteExpiredStories(): Promise<number> {
    const res = await pool.query(
      `DELETE FROM social_stories WHERE expires_at < NOW() RETURNING id`
    );
    return res.rowCount ?? 0;
  }

  static async deleteStory(storyId: number) {
    await pool.query('DELETE FROM social_stories WHERE id = $1', [storyId]);
  }

  static async addStoryReply(
    storyId: number,
    senderId: number,
    studentId: number,
    message: string
  ) {
    const res = await pool.query(
      `INSERT INTO social_story_replies (story_id, sender_id, student_id, message)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [storyId, senderId, studentId, message]
    );
    return res.rows[0];
  }

  static async getStoryReplies(storyId: number, studentId: number) {
    const res = await pool.query(
      `SELECT r.*,
              CASE WHEN u.role = 'admin' THEN 'Next Edu' ELSE u.name END AS sender_name,
              u.avatar AS sender_avatar
       FROM social_story_replies r
       JOIN users u ON u.id = r.sender_id
       WHERE r.story_id = $1 AND r.student_id = $2
       ORDER BY r.created_at ASC`,
      [storyId, studentId]
    );
    return res.rows;
  }
}
