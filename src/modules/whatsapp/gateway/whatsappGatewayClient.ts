import axios, { AxiosInstance } from 'axios';
import crypto from 'node:crypto';
import { whatsappConfig } from '../config/whatsapp';
import { HttpError } from '../../../utils';

export interface GatewaySession {
  id: string;
  status: string;
  phone_number?: string | null;
  qr?: string | null;
  created_at?: string;
  note?: string;
}

function createClient(): AxiosInstance {
  return axios.create({
    baseURL: whatsappConfig.gatewayUrl,
    headers: {
      Authorization: `Bearer ${whatsappConfig.apiKey}`,
    },
    timeout: 30_000,
  });
}

function getClient(): AxiosInstance {
  if (!whatsappConfig.configured) {
    throw new HttpError(503, 'WhatsApp gateway is not configured (WHATSAPP_API_KEY).');
  }
  return createClient();
}

/** Normalize phone to WhatsApp digits (E.164 without +). */
export function normalizePhone(phone: string): string {
  let digits = phone.replace(/[^0-9]/g, '');

  if (digits.startsWith('00')) {
    digits = digits.slice(2);
  }

  if (
    digits.startsWith('966') ||
    digits.startsWith('20') ||
    digits.startsWith('971') ||
    digits.startsWith('973') ||
    digits.startsWith('965') ||
    digits.startsWith('974')
  ) {
    return digits;
  }

  if (digits.startsWith('05') && digits.length === 10) {
    return `966${digits.slice(1)}`;
  }
  if (digits.startsWith('5') && digits.length === 9) {
    return `966${digits}`;
  }

  if (digits.startsWith('01') && digits.length === 11) {
    return `20${digits.slice(1)}`;
  }
  if (/^1[0125]\d{8}$/.test(digits)) {
    return `20${digits}`;
  }

  return digits;
}

export function isWhatsAppConfigured(): boolean {
  return whatsappConfig.configured;
}

export async function listSessions(): Promise<GatewaySession[]> {
  const { data } = await getClient().get('/v1/sessions');
  return Array.isArray(data) ? data : [];
}

export async function getSession(id: string): Promise<GatewaySession> {
  const { data } = await getClient().get(`/v1/sessions/${encodeURIComponent(id)}`);
  return data;
}

export async function createSession(id: string): Promise<GatewaySession> {
  const { data } = await getClient().post(
    '/v1/sessions',
    { id },
    { headers: { 'Content-Type': 'application/json' } },
  );
  return data;
}

export async function deleteSession(id: string): Promise<unknown> {
  const { data } = await getClient().delete(`/v1/sessions/${encodeURIComponent(id)}`);
  return data;
}

export async function reconnectSession(id: string): Promise<GatewaySession> {
  const { data } = await getClient().post(
    `/v1/sessions/${encodeURIComponent(id)}/reconnect`,
    {},
    { headers: { 'Content-Type': 'application/json' } },
  );
  return data;
}

export async function sendMessage(params: {
  sessionId: string;
  to: string;
  body?: string;
  media?: { url?: string; data?: string; mimetype?: string; filename?: string };
  metadata?: Record<string, unknown>;
}): Promise<unknown> {
  const payload: Record<string, unknown> = {
    session_id: params.sessionId,
    to: normalizePhone(params.to),
    metadata: params.metadata ?? {},
  };
  if (params.body != null && params.body !== '') {
    payload.body = params.body;
  }
  if (params.media) {
    payload.media = params.media;
  }
  const { data } = await getClient().post('/v1/messages', payload, {
    headers: { 'Content-Type': 'application/json' },
  });
  return data;
}

export function verifyWebhookSignature(
  rawBody: Buffer | string | undefined,
  signatureHeader: string | undefined,
): boolean {
  const secret = whatsappConfig.webhookSecret;
  if (!secret) return true;
  if (!rawBody || !signatureHeader) return false;

  const expected =
    'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

  try {
    const a = Buffer.from(signatureHeader);
    const b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
