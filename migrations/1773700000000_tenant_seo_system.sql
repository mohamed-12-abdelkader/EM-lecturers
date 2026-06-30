-- Multi-tenant SEO: extended settings, course slugs, search analytics, FTS indexes

BEGIN;

CREATE TABLE IF NOT EXISTS tenant_seo_settings (
  tenant_id INTEGER PRIMARY KEY REFERENCES tenants (id) ON DELETE CASCADE,
  seo_keywords TEXT[] NOT NULL DEFAULT '{}',
  canonical_url TEXT,
  og_title TEXT,
  og_description TEXT,
  og_image TEXT,
  twitter_title TEXT,
  twitter_description TEXT,
  twitter_image TEXT,
  robots_index BOOLEAN NOT NULL DEFAULT TRUE,
  robots_follow BOOLEAN NOT NULL DEFAULT TRUE,
  auto_generate BOOLEAN NOT NULL DEFAULT TRUE,
  sitemap_xml TEXT,
  sitemap_generated_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tenant_seo_settings_robots
  ON tenant_seo_settings (robots_index, robots_follow);

INSERT INTO tenant_seo_settings (tenant_id, og_title, og_description, og_image)
SELECT
  t.id,
  t.seo_title,
  t.seo_meta_description,
  t.og_image_url
FROM tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM tenant_seo_settings s WHERE s.tenant_id = t.id
);

ALTER TABLE courses ADD COLUMN IF NOT EXISTS slug VARCHAR(200);
ALTER TABLE courses ADD COLUMN IF NOT EXISTS seo_title TEXT;
ALTER TABLE courses ADD COLUMN IF NOT EXISTS seo_description TEXT;
ALTER TABLE courses ADD COLUMN IF NOT EXISTS seo_keywords TEXT[] DEFAULT '{}';
ALTER TABLE courses ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

UPDATE courses
SET slug = 'course-' || id::TEXT
WHERE slug IS NULL OR trim(slug) = '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_courses_teacher_slug_unique
  ON courses (teacher_id, slug)
  WHERE slug IS NOT NULL;

CREATE TABLE IF NOT EXISTS course_seo_stats (
  course_id INTEGER PRIMARY KEY REFERENCES courses (id) ON DELETE CASCADE,
  view_count INTEGER NOT NULL DEFAULT 0,
  search_hits INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO course_seo_stats (course_id)
SELECT c.id
FROM courses c
WHERE NOT EXISTS (
  SELECT 1 FROM course_seo_stats s WHERE s.course_id = c.id
);

CREATE TABLE IF NOT EXISTS seo_search_logs (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER REFERENCES tenants (id) ON DELETE SET NULL,
  query TEXT NOT NULL,
  filters JSONB NOT NULL DEFAULT '{}'::JSONB,
  result_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_seo_search_logs_query_created
  ON seo_search_logs (lower(trim(query)), created_at DESC);

CREATE INDEX IF NOT EXISTS idx_seo_search_logs_tenant_created
  ON seo_search_logs (tenant_id, created_at DESC)
  WHERE tenant_id IS NOT NULL;

-- Full-text search vectors (simple config works for Arabic + Latin mixed content)
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS seo_search_vector TSVECTOR;

UPDATE tenants t
SET seo_search_vector =
  setweight(to_tsvector('simple', coalesce(t.display_name, '')), 'A') ||
  setweight(to_tsvector('simple', coalesce(t.specialty, '')), 'B') ||
  setweight(to_tsvector('simple', coalesce(t.bio, '')), 'C') ||
  setweight(to_tsvector('simple', coalesce(t.subdomain, '')), 'A')
WHERE t.seo_search_vector IS NULL;

CREATE INDEX IF NOT EXISTS idx_tenants_seo_search_vector
  ON tenants USING GIN (seo_search_vector);

ALTER TABLE courses ADD COLUMN IF NOT EXISTS seo_search_vector TSVECTOR;

UPDATE courses c
SET seo_search_vector =
  setweight(to_tsvector('simple', coalesce(c.title, '')), 'A') ||
  setweight(to_tsvector('simple', coalesce(c.description, '')), 'B') ||
  setweight(to_tsvector('simple', coalesce(c.slug, '')), 'A')
WHERE c.seo_search_vector IS NULL;

CREATE INDEX IF NOT EXISTS idx_courses_seo_search_vector
  ON courses USING GIN (seo_search_vector);

CREATE OR REPLACE FUNCTION refresh_tenant_seo_search_vector()
RETURNS TRIGGER AS $$
BEGIN
  NEW.seo_search_vector :=
    setweight(to_tsvector('simple', coalesce(NEW.display_name, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(NEW.specialty, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(NEW.bio, '')), 'C') ||
    setweight(to_tsvector('simple', coalesce(NEW.subdomain, '')), 'A');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_tenants_seo_search_vector ON tenants;
CREATE TRIGGER trg_tenants_seo_search_vector
  BEFORE INSERT OR UPDATE OF display_name, specialty, bio, subdomain
  ON tenants
  FOR EACH ROW
  EXECUTE FUNCTION refresh_tenant_seo_search_vector();

CREATE OR REPLACE FUNCTION refresh_course_seo_search_vector()
RETURNS TRIGGER AS $$
BEGIN
  NEW.seo_search_vector :=
    setweight(to_tsvector('simple', coalesce(NEW.title, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(NEW.description, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(NEW.slug, '')), 'A');
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_courses_seo_search_vector ON courses;
CREATE TRIGGER trg_courses_seo_search_vector
  BEFORE INSERT OR UPDATE OF title, description, slug
  ON courses
  FOR EACH ROW
  EXECUTE FUNCTION refresh_course_seo_search_vector();

COMMIT;
