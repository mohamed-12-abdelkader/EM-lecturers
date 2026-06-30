-- Up Migration
-- مزامنة lecture_views و completion_percentage من سجلات video_views الموجودة

INSERT INTO lecture_views (user_id, lecture_id, viewed_at)
SELECT DISTINCT user_id, lecture_id, MAX(viewed_at)
FROM video_views
GROUP BY user_id, lecture_id
ON CONFLICT (user_id, lecture_id)
DO UPDATE SET viewed_at = GREATEST(lecture_views.viewed_at, EXCLUDED.viewed_at);

WITH lecture_progress AS (
  SELECT
    vv.user_id,
    vv.lecture_id,
    CASE
      WHEN totals.total = 0 THEN 0
      ELSE ROUND(COUNT(DISTINCT vv.video_id)::numeric / totals.total * 100, 2)
    END AS pct,
    CASE
      WHEN totals.total > 0 AND COUNT(DISTINCT vv.video_id) >= totals.total THEN true
      ELSE false
    END AS completed
  FROM video_views vv
  JOIN (
    SELECT lecture_id, COUNT(*)::numeric AS total
    FROM lecture_videos
    GROUP BY lecture_id
  ) totals ON totals.lecture_id = vv.lecture_id
  GROUP BY vv.user_id, vv.lecture_id, totals.total
)
UPDATE video_views vv
SET completion_percentage = GREATEST(vv.completion_percentage, lp.pct),
    is_completed = CASE WHEN lp.completed THEN true ELSE vv.is_completed END,
    updated_at = NOW()
FROM lecture_progress lp
WHERE vv.user_id = lp.user_id
  AND vv.lecture_id = lp.lecture_id;

-- Down Migration
-- لا يمكن التراجع بأمان عن البيانات المُحدَّثة
