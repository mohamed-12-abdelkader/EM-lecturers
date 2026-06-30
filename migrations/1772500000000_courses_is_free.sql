-- كورس مجاني: المحتوى متاح لكل الطلاب بدون اشتراك

ALTER TABLE courses
  ADD COLUMN IF NOT EXISTS is_free BOOLEAN NOT NULL DEFAULT FALSE;

-- الكورسات التي سعرها 0 تُعتبر مجانية
UPDATE courses
SET is_free = TRUE
WHERE COALESCE(price, 0) = 0
  AND is_free = FALSE;

CREATE INDEX IF NOT EXISTS idx_courses_is_free ON courses(is_free) WHERE is_free = TRUE;
