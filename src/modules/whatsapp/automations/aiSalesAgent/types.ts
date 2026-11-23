import type {
  DEFAULT_ENABLED_TOOLS,
  DEFAULT_FOLLOWUP_SETTINGS,
} from './constants';

export type SalesSessionStatus = 'draft' | 'active' | 'paused' | 'archived' | 'error';

export type SalesLeadStatus = 'open' | 'won' | 'lost' | 'archived';

export type SalesKbKind =
  | 'note'
  | 'faq'
  | 'product'
  | 'pricing'
  | 'offer'
  | 'terms'
  | 'competitor'
  | 'objection'
  | 'instruction'
  | 'pdf'
  | 'docx'
  | 'txt'
  | 'image'
  | 'url';

export type SalesFollowupStatus =
  | 'pending'
  | 'processing'
  | 'sent'
  | 'cancelled'
  | 'failed'
  | 'skipped';

export type SalesToolName = (typeof DEFAULT_ENABLED_TOOLS)[number] | string;

export type SalesFollowupSettings = typeof DEFAULT_FOLLOWUP_SETTINGS & {
  instructions?: string;
};

export type SalesPackage = {
  id?: string;
  name: string;
  price?: string | null;
  currency?: string | null;
  description?: string | null;
  features?: string[];
};

export type SalesStage = { key: string; label: string };

export type SalesAgentSessionRow = {
  id: number;
  name: string;
  description: string | null;
  product_name: string;
  product_description: string | null;
  goal: string | null;
  target_audience: string | null;
  language: string;
  dialect: string | null;
  tone: string | null;
  persona: string | null;
  formality: 'casual' | 'neutral' | 'formal';
  sales_instructions: string | null;
  general_instructions: string | null;
  wa_session_slug: string | null;
  status: SalesSessionStatus;
  enabled_tools: SalesToolName[];
  followup_settings: SalesFollowupSettings;
  packages: SalesPackage[];
  demo_url: string | null;
  signup_url: string | null;
  media_urls: string[];
  custom_stages: SalesStage[];
  stats_cache: Record<string, unknown>;
  last_error: string | null;
  created_by: number | null;
  created_at: string;
  updated_at: string;
};

export type SalesLeadRow = {
  id: number;
  session_id: number;
  conversation_id: number | null;
  contact_phone: string;
  contact_name: string | null;
  source: string | null;
  campaign_id: string | null;
  campaign_name: string | null;
  ad_id: string | null;
  ad_name: string | null;
  adset: string | null;
  referral_data: Record<string, unknown>;
  stage: string;
  interest_score: number;
  product_interest: string | null;
  needs: string | null;
  business_size: string | null;
  budget: string | null;
  objections: string[];
  ai_notes: string | null;
  human_notes: string | null;
  last_action: string | null;
  next_followup_at: string | null;
  followup_count: number;
  followups_stopped: boolean;
  followup_stop_reason: string | null;
  ai_enabled: boolean;
  status: SalesLeadStatus;
  context_summary: string | null;
  memory: Record<string, unknown>;
  first_contact_at: string;
  last_contact_at: string;
  won_at: string | null;
  created_at: string;
  updated_at: string;
};

export type SalesKbDocumentRow = {
  id: number;
  session_id: number;
  kind: SalesKbKind;
  title: string;
  content: string;
  source_url: string | null;
  file_path: string | null;
  mime_type: string | null;
  file_size: number | null;
  metadata: Record<string, unknown>;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type SalesFollowupRow = {
  id: number;
  session_id: number;
  lead_id: number;
  scheduled_at: string;
  status: SalesFollowupStatus;
  reason: string | null;
  instructions: string | null;
  message_preview: string | null;
  outbound_job_id: number | null;
  attempts: number;
  last_error: string | null;
  sent_at: string | null;
  created_at: string;
  updated_at: string;
};
