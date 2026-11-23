-- Up Migration: AI Sales Agent multi-session service

INSERT INTO wa_services (key, name, description, type, scope, is_enabled, config)
VALUES (
  'ai_sales_agent',
  'وكيل المبيعات الذكي',
  'وكلاء مبيعات متعددين على واتساب — كل Session مستقلة (منتج، معرفة، عملاء، متابعات)',
  'chatbot',
  'platform',
  FALSE,
  '{"human_mute_minutes":60,"language":"ar","owner":"platform"}'::jsonb
)
ON CONFLICT (key) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  updated_at = NOW();

-- Sales Agent Sessions (multi-product, isolated)
CREATE TABLE IF NOT EXISTS wa_sales_agent_sessions (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NULL,
  product_name TEXT NOT NULL DEFAULT '',
  product_description TEXT NULL,
  goal TEXT NULL,
  target_audience TEXT NULL,
  language TEXT NOT NULL DEFAULT 'ar',
  dialect TEXT NULL DEFAULT 'egyptian',
  tone TEXT NULL DEFAULT 'friendly',
  persona TEXT NULL,
  formality TEXT NOT NULL DEFAULT 'casual'
    CHECK (formality IN ('casual', 'neutral', 'formal')),
  sales_instructions TEXT NULL,
  general_instructions TEXT NULL,
  wa_session_slug TEXT NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'paused', 'archived', 'error')),
  enabled_tools JSONB NOT NULL DEFAULT '["search_knowledge","list_packages","send_demo_link","send_signup_link","update_lead","set_lead_stage","add_note","create_followup","cancel_followup","stop_followups","mark_won","escalate_human"]'::jsonb,
  followup_settings JSONB NOT NULL DEFAULT '{
    "enabled": true,
    "max_followups": 3,
    "min_hours_between": 24,
    "quiet_hours_start": 22,
    "quiet_hours_end": 9,
    "workdays": [0,1,2,3,4],
    "stop_on_won": true,
    "stop_on_not_interested": true,
    "stop_on_opt_out": true,
    "instructions": ""
  }'::jsonb,
  packages JSONB NOT NULL DEFAULT '[]'::jsonb,
  demo_url TEXT NULL,
  signup_url TEXT NULL,
  media_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
  custom_stages JSONB NOT NULL DEFAULT '[
    {"key":"new","label":"New Lead"},
    {"key":"contacted","label":"Contacted"},
    {"key":"interested","label":"Interested"},
    {"key":"qualified","label":"Qualified"},
    {"key":"demo_requested","label":"Demo Requested"},
    {"key":"demo_completed","label":"Demo Completed"},
    {"key":"negotiation","label":"Negotiation"},
    {"key":"follow_up","label":"Follow-up"},
    {"key":"won","label":"Won"},
    {"key":"lost","label":"Lost"},
    {"key":"not_interested","label":"Not Interested"}
  ]'::jsonb,
  stats_cache JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_error TEXT NULL,
  created_by INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_wa_sales_agent_sessions_slug_active
  ON wa_sales_agent_sessions (wa_session_slug)
  WHERE wa_session_slug IS NOT NULL AND status IN ('active', 'paused', 'draft');

CREATE INDEX IF NOT EXISTS idx_wa_sales_agent_sessions_status
  ON wa_sales_agent_sessions (status, updated_at DESC);

-- Knowledge base documents (per session)
CREATE TABLE IF NOT EXISTS wa_sales_kb_documents (
  id SERIAL PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES wa_sales_agent_sessions(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'note'
    CHECK (kind IN (
      'note', 'faq', 'product', 'pricing', 'offer', 'terms',
      'competitor', 'objection', 'instruction', 'pdf', 'docx',
      'txt', 'image', 'url'
    )),
  title TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  source_url TEXT NULL,
  file_path TEXT NULL,
  mime_type TEXT NULL,
  file_size INTEGER NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wa_sales_kb_documents_session
  ON wa_sales_kb_documents (session_id, is_active, kind);

CREATE INDEX IF NOT EXISTS idx_wa_sales_kb_documents_fts
  ON wa_sales_kb_documents
  USING gin (to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(content, '')));

-- Leads (per session)
CREATE TABLE IF NOT EXISTS wa_sales_leads (
  id SERIAL PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES wa_sales_agent_sessions(id) ON DELETE CASCADE,
  conversation_id INTEGER NULL REFERENCES wa_conversations(id) ON DELETE SET NULL,
  contact_phone TEXT NOT NULL,
  contact_name TEXT NULL,
  source TEXT NULL DEFAULT 'whatsapp',
  campaign_id TEXT NULL,
  campaign_name TEXT NULL,
  ad_id TEXT NULL,
  ad_name TEXT NULL,
  adset TEXT NULL,
  referral_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  stage TEXT NOT NULL DEFAULT 'new',
  interest_score INTEGER NOT NULL DEFAULT 0 CHECK (interest_score BETWEEN 0 AND 100),
  product_interest TEXT NULL,
  needs TEXT NULL,
  business_size TEXT NULL,
  budget TEXT NULL,
  objections JSONB NOT NULL DEFAULT '[]'::jsonb,
  ai_notes TEXT NULL,
  human_notes TEXT NULL,
  last_action TEXT NULL,
  next_followup_at TIMESTAMPTZ NULL,
  followup_count INTEGER NOT NULL DEFAULT 0,
  followups_stopped BOOLEAN NOT NULL DEFAULT FALSE,
  followup_stop_reason TEXT NULL,
  ai_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'won', 'lost', 'archived')),
  context_summary TEXT NULL,
  memory JSONB NOT NULL DEFAULT '{}'::jsonb,
  first_contact_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_contact_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  won_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (session_id, contact_phone)
);

CREATE INDEX IF NOT EXISTS idx_wa_sales_leads_session_stage
  ON wa_sales_leads (session_id, stage, last_contact_at DESC);

CREATE INDEX IF NOT EXISTS idx_wa_sales_leads_followup_due
  ON wa_sales_leads (next_followup_at)
  WHERE next_followup_at IS NOT NULL AND followups_stopped = FALSE AND status = 'open';

CREATE INDEX IF NOT EXISTS idx_wa_sales_leads_conversation
  ON wa_sales_leads (conversation_id);

-- Follow-up tasks
CREATE TABLE IF NOT EXISTS wa_sales_followups (
  id SERIAL PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES wa_sales_agent_sessions(id) ON DELETE CASCADE,
  lead_id INTEGER NOT NULL REFERENCES wa_sales_leads(id) ON DELETE CASCADE,
  scheduled_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'sent', 'cancelled', 'failed', 'skipped')),
  reason TEXT NULL,
  instructions TEXT NULL,
  message_preview TEXT NULL,
  outbound_job_id INTEGER NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT NULL,
  sent_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wa_sales_followups_due
  ON wa_sales_followups (status, scheduled_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_wa_sales_followups_lead
  ON wa_sales_followups (lead_id, scheduled_at DESC);

-- Agent action / execution log
CREATE TABLE IF NOT EXISTS wa_sales_agent_actions (
  id SERIAL PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES wa_sales_agent_sessions(id) ON DELETE CASCADE,
  lead_id INTEGER NULL REFERENCES wa_sales_leads(id) ON DELETE SET NULL,
  conversation_id INTEGER NULL REFERENCES wa_conversations(id) ON DELETE SET NULL,
  action_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  result JSONB NOT NULL DEFAULT '{}'::jsonb,
  success BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wa_sales_agent_actions_session
  ON wa_sales_agent_actions (session_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_wa_sales_agent_actions_lead
  ON wa_sales_agent_actions (lead_id, created_at DESC);

-- Down Migration
-- DROP TABLE IF EXISTS wa_sales_agent_actions;
-- DROP TABLE IF EXISTS wa_sales_followups;
-- DROP TABLE IF EXISTS wa_sales_leads;
-- DROP TABLE IF EXISTS wa_sales_kb_documents;
-- DROP TABLE IF EXISTS wa_sales_agent_sessions;
-- DELETE FROM wa_services WHERE key = 'ai_sales_agent';
