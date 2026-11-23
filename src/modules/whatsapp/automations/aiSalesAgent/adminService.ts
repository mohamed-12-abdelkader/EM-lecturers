import fs from 'node:fs';
import path from 'node:path';
import { HttpError } from '../../../../utils';
import { SalesFollowupStore } from './followupStore';
import { SalesKnowledgeStore } from './knowledgeStore';
import { SalesLeadStore } from './leadStore';
import { SalesAgentSessionStore } from './sessionStore';
import type { SalesKbKind, SalesSessionStatus } from './types';
import pool from '../../../../db/pool';
import { WhatsAppServiceAdmin } from '../../services/whatsappServiceAdmin.service';

const UPLOAD_DIR = path.join(process.cwd(), 'uploads/wa-sales-agent');

function ensureUploadDir() {
  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

export class AiSalesAdminService {
  static listSessions = SalesAgentSessionStore.list.bind(SalesAgentSessionStore);
  static getSession = SalesAgentSessionStore.getById.bind(SalesAgentSessionStore);
  static getOverview = SalesAgentSessionStore.getOverview.bind(SalesAgentSessionStore);

  static async createSession(body: any, userId?: number) {
    if (!body?.name || String(body.name).trim().length < 2) {
      throw new HttpError(400, 'اسم الجلسة مطلوب');
    }
    return SalesAgentSessionStore.create({
      ...body,
      created_by: userId ?? null,
    });
  }

  static async updateSession(id: number, body: any) {
    const existing = await SalesAgentSessionStore.getById(id);
    if (!existing) throw new HttpError(404, 'الجلسة غير موجودة');
    if (body.wa_session_slug) {
      const clash = await pool.query(
        `SELECT id FROM wa_sales_agent_sessions
         WHERE wa_session_slug = $1 AND id <> $2
           AND status IN ('active','paused','draft')
         LIMIT 1`,
        [body.wa_session_slug, id],
      );
      if (clash.rowCount) {
        throw new HttpError(409, 'رقم واتساب ده مربوط بجلسة Sales أخرى');
      }
    }
    const updated = await SalesAgentSessionStore.update(id, body);
    if (!updated) throw new HttpError(404, 'الجلسة غير موجودة');
    return updated;
  }

  static async setSessionStatus(id: number, status: SalesSessionStatus) {
    const existing = await SalesAgentSessionStore.getById(id);
    if (!existing) throw new HttpError(404, 'الجلسة غير موجودة');
    if (status === 'active' && !existing.wa_session_slug) {
      throw new HttpError(400, 'اربط رقم واتساب قبل تشغيل الجلسة');
    }
    return SalesAgentSessionStore.setStatus(id, status, null);
  }

  static async getSessionDashboard(id: number) {
    const session = await SalesAgentSessionStore.getById(id);
    if (!session) throw new HttpError(404, 'الجلسة غير موجودة');
    const stats = await SalesAgentSessionStore.getSessionStats(id);
    const recentLeads = await SalesLeadStore.list(id, { limit: 10 });
    const dueFollowups = await pool.query(
      `SELECT COUNT(*)::int AS c FROM wa_sales_followups
       WHERE session_id = $1 AND status = 'pending' AND scheduled_at <= NOW()`,
      [id],
    );
    return {
      session,
      stats: {
        ...stats,
        pending_followups: Number(dueFollowups.rows[0]?.c || 0),
      },
      recent_leads: recentLeads.rows,
    };
  }

  static async listKnowledge(sessionId: number) {
    await this.requireSession(sessionId);
    return SalesKnowledgeStore.list(sessionId, { activeOnly: false, limit: 200 });
  }

  static async addKnowledge(sessionId: number, body: any) {
    await this.requireSession(sessionId);
    if (!String(body?.content || body?.title || '').trim() && !body?.source_url) {
      throw new HttpError(400, 'المحتوى أو العنوان مطلوب');
    }
    return SalesKnowledgeStore.create({
      sessionId,
      kind: (body.kind as SalesKbKind) || 'note',
      title: body.title || '',
      content: body.content || '',
      source_url: body.source_url || null,
      metadata: body.metadata || {},
    });
  }

  static async updateKnowledge(sessionId: number, docId: number, body: any) {
    await this.requireSession(sessionId);
    const updated = await SalesKnowledgeStore.update(docId, sessionId, body);
    if (!updated) throw new HttpError(404, 'المستند غير موجود');
    return updated;
  }

  static async deleteKnowledge(sessionId: number, docId: number) {
    await this.requireSession(sessionId);
    const ok = await SalesKnowledgeStore.remove(docId, sessionId);
    if (!ok) throw new HttpError(404, 'المستند غير موجود');
    return { deleted: true };
  }

  static async uploadKnowledgeFile(
    sessionId: number,
    file: Express.Multer.File,
    meta: { title?: string; kind?: SalesKbKind },
  ) {
    await this.requireSession(sessionId);
    ensureUploadDir();
    const safeName = `${Date.now()}-${file.originalname.replace(/[^\w.\-ء-ي]+/g, '_')}`;
    const dest = path.join(UPLOAD_DIR, String(sessionId), safeName);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, file.buffer);

    let content = '';
    const mime = file.mimetype || '';
    if (mime.startsWith('text/') || mime.includes('json') || file.originalname.endsWith('.txt')) {
      content = file.buffer.toString('utf8').slice(0, 100_000);
    } else {
      content = `ملف مرفوع: ${file.originalname}. أضف ملخصاً نصياً يدوياً إن لزم لاستفادة الـ Agent.`;
    }

    return SalesKnowledgeStore.create({
      sessionId,
      kind: meta.kind || (mime.includes('pdf') ? 'pdf' : mime.startsWith('image/') ? 'image' : 'txt'),
      title: meta.title || file.originalname,
      content,
      file_path: dest,
      mime_type: mime || null,
      file_size: file.size,
      metadata: { original_name: file.originalname },
    });
  }

  static async listLeads(sessionId: number, query: any) {
    await this.requireSession(sessionId);
    return SalesLeadStore.list(sessionId, {
      stage: query.stage,
      status: query.status,
      search: query.search,
      limit: Number(query.limit) || 50,
      offset: Number(query.offset) || 0,
    });
  }

  static async getLead(sessionId: number, leadId: number) {
    await this.requireSession(sessionId);
    const lead = await SalesLeadStore.getById(leadId, sessionId);
    if (!lead) throw new HttpError(404, 'العميل غير موجود');
    const [followups, actions, messages] = await Promise.all([
      SalesFollowupStore.listForLead(sessionId, leadId),
      SalesLeadStore.listActions(sessionId, leadId, 40),
      lead.conversation_id
        ? WhatsAppServiceAdmin.listMessages(lead.conversation_id, { limit: 100 }).catch(() => ({
            messages: [],
            conversation_id: lead.conversation_id!,
          }))
        : Promise.resolve({ messages: [], conversation_id: 0 }),
    ]);
    return { lead, followups, actions, messages: messages.messages || [] };
  }

  static async updateLead(sessionId: number, leadId: number, body: any) {
    await this.requireSession(sessionId);
    const updated = await SalesLeadStore.update(leadId, sessionId, body);
    if (!updated) throw new HttpError(404, 'العميل غير موجود');
    return updated;
  }

  static async setLeadAi(sessionId: number, leadId: number, enabled: boolean) {
    return this.updateLead(sessionId, leadId, { ai_enabled: enabled });
  }

  static async createFollowup(sessionId: number, leadId: number, body: any) {
    await this.requireSession(sessionId);
    const lead = await SalesLeadStore.getById(leadId, sessionId);
    if (!lead) throw new HttpError(404, 'العميل غير موجود');
    const hours = Math.max(1, Number(body.hours_from_now || 24));
    const when = body.scheduled_at
      ? new Date(body.scheduled_at)
      : new Date(Date.now() + hours * 3600 * 1000);
    if (Number.isNaN(when.getTime())) throw new HttpError(400, 'موعد غير صالح');
    return SalesFollowupStore.create({
      sessionId,
      leadId,
      scheduledAt: when,
      reason: body.reason || 'manual',
      instructions: body.instructions || '',
    });
  }

  private static async requireSession(id: number) {
    const s = await SalesAgentSessionStore.getById(id);
    if (!s) throw new HttpError(404, 'الجلسة غير موجودة');
    return s;
  }
}
