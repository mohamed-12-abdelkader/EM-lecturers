export type WaServiceType = 'chatbot' | 'transactional' | 'broadcast';
export type WaServiceScope = 'platform' | 'tenant';
export type WaConversationStatus = 'bot' | 'waiting_human' | 'human' | 'closed';

export interface WaServiceRow {
  id: number;
  key: string;
  name: string;
  description: string | null;
  type: WaServiceType;
  scope: WaServiceScope;
  tenant_id: number | null;
  is_enabled: boolean;
  config: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

export interface WaSessionRow {
  id: number;
  slug: string;
  label: string | null;
  phone_number: string | null;
  status: string;
  is_enabled: boolean;
  max_messages_per_minute: number;
  last_ready_at: Date | null;
  last_error: string | null;
  teacher_id: number | null;
  created_at: Date;
  updated_at: Date;
}

export interface WaConversationRow {
  id: number;
  service_id: number | null;
  session_slug: string;
  tenant_id: number | null;
  student_user_id: number | null;
  contact_phone: string;
  status: WaConversationStatus;
  metadata: Record<string, unknown>;
  wwebjs_conversation_id: string | null;
  last_message_at: Date;
  assigned_at: Date;
  created_at: Date;
  updated_at: Date;
}

export interface InboundMedia {
  mimetype: string;
  data: string;
  filename?: string | null;
  caption?: string | null;
}

export interface InboundContext {
  sessionSlug: string;
  fromPhone: string;
  body: string;
  waMessageId: string;
  eventType: string;
  metadata: Record<string, unknown>;
  media?: InboundMedia | null;
  mediaError?: string | null;
  service: WaServiceRow | null;
  conversation: WaConversationRow | null;
}

export interface HandlerResult {
  handled: boolean;
  reply?: string;
  /** Public image URL to send as WhatsApp media (caption = reply). */
  mediaUrl?: string;
  escalate?: boolean;
  metadata?: Record<string, unknown>;
}

export interface WhatsAppAutomationHandler {
  key: string;
  onInbound(ctx: InboundContext): Promise<HandlerResult>;
}
