import type { PoolClient } from 'pg';
import pool from '../db/pool';
import { HttpError } from '../utils';

export type InvoiceType = 'subscription' | 'renewal' | 'upgrade';
export type InvoiceStatus = 'paid' | 'partial' | 'unpaid' | 'cancelled';

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: 'نقدي',
  bank_transfer: 'تحويل بنكي',
  online_payment: 'دفع إلكتروني',
  check: 'شيك',
};

const INVOICE_TYPE_LABELS: Record<InvoiceType, string> = {
  subscription: 'اشتراك جديد',
  renewal: 'تجديد اشتراك',
  upgrade: 'ترقية باقة',
};

const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  paid: 'مدفوعة بالكامل',
  partial: 'مدفوعة جزئياً',
  unpaid: 'غير مدفوعة',
  cancelled: 'ملغاة',
};

async function generateInvoiceNumber(client: PoolClient): Promise<string> {
  const year = new Date().getFullYear();
  const result = await client.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM teacher_subscription_invoices
     WHERE EXTRACT(YEAR FROM created_at) = $1`,
    [year],
  );
  const seq = Number(result.rows[0]?.n ?? 0) + 1;
  return `INV-${year}-${String(seq).padStart(6, '0')}`;
}

function enrichInvoiceRow(row: Record<string, unknown>) {
  const invoiceType = row.invoice_type as InvoiceType;
  const paymentMethod =
    row.payment_method != null ? String(row.payment_method) : null;
  const status = row.status as InvoiceStatus;
  return {
    ...row,
    invoice_type_label: INVOICE_TYPE_LABELS[invoiceType] ?? invoiceType,
    status_label: INVOICE_STATUS_LABELS[status] ?? status,
    payment_method_label: paymentMethod
      ? (PAYMENT_METHOD_LABELS[paymentMethod] ?? paymentMethod)
      : null,
  };
}

export class TeacherSubscriptionInvoicesService {
  static async createInTransaction(
    client: PoolClient,
    input: {
      teacher_id: number;
      subscription_id?: number | null;
      renewal_id?: number | null;
      upgrade_id?: number | null;
      invoice_type: InvoiceType;
      plan_id: number;
      plan_code: string;
      plan_name_ar: string;
      subscription_number?: string | null;
      amount: number;
      paid_amount?: number;
      remaining_amount?: number;
      status?: InvoiceStatus;
      payment_method?: string | null;
      period_start: string;
      period_end: string;
      notes?: string | null;
      income_id?: number | null;
      issued_at?: string;
      created_by: number;
    },
  ) {
    const paidAmount = input.paid_amount ?? input.amount;
    const remainingAmount = input.remaining_amount ?? 0;
    const status =
      input.status ??
      (remainingAmount <= 0 ? 'paid' : paidAmount > 0 ? 'partial' : 'unpaid');
    const invoiceNumber = await generateInvoiceNumber(client);
    const result = await client.query(
      `INSERT INTO teacher_subscription_invoices (
         invoice_number, teacher_id, subscription_id, renewal_id, upgrade_id, invoice_type,
         plan_id, subscription_number, plan_code, plan_name_ar, amount, paid_amount,
         remaining_amount, payment_method, period_start, period_end, status, notes,
         income_id, issued_at, created_by
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
       RETURNING *`,
      [
        invoiceNumber,
        input.teacher_id,
        input.subscription_id ?? null,
        input.renewal_id ?? null,
        input.upgrade_id ?? null,
        input.invoice_type,
        input.plan_id,
        input.subscription_number ?? null,
        input.plan_code,
        input.plan_name_ar,
        input.amount,
        paidAmount,
        remainingAmount,
        input.payment_method ?? null,
        input.period_start,
        input.period_end,
        status,
        input.notes ?? null,
        input.income_id ?? null,
        input.issued_at ?? input.period_start,
        input.created_by,
      ],
    );
    return enrichInvoiceRow(result.rows[0]);
  }

  static async getById(id: number, scope?: { teacher_id?: number }) {
    const conditions = ['i.id = $1'];
    const values: unknown[] = [id];
    if (scope?.teacher_id) {
      conditions.push(`i.teacher_id = $${values.length + 1}`);
      values.push(scope.teacher_id);
    }

    const result = await pool.query(
      `SELECT i.*,
              t.name AS teacher_name, t.email AS teacher_email, t.phone AS teacher_phone,
              cb.name AS created_by_name
       FROM teacher_subscription_invoices i
       JOIN users t ON t.id = i.teacher_id
       LEFT JOIN users cb ON cb.id = i.created_by
       WHERE ${conditions.join(' AND ')}`,
      values,
    );
    if (!result.rowCount) return null;
    return enrichInvoiceRow(result.rows[0]);
  }

  static async list(
    filters: {
      teacher_id?: number;
      subscription_id?: number;
      invoice_type?: InvoiceType;
      status?: InvoiceStatus;
      search?: string;
      start_date?: string;
      end_date?: string;
      limit?: number;
      offset?: number;
    } = {},
  ) {
    const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
    const offset = Math.max(filters.offset ?? 0, 0);
    const conditions: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    if (filters.teacher_id) {
      conditions.push(`i.teacher_id = $${i++}`);
      values.push(filters.teacher_id);
    }
    if (filters.subscription_id) {
      conditions.push(`i.subscription_id = $${i++}`);
      values.push(filters.subscription_id);
    }
    if (filters.invoice_type) {
      conditions.push(`i.invoice_type = $${i++}`);
      values.push(filters.invoice_type);
    }
    if (filters.status) {
      conditions.push(`i.status = $${i++}`);
      values.push(filters.status);
    }
    if (filters.start_date) {
      conditions.push(`i.issued_at >= $${i++}`);
      values.push(filters.start_date);
    }
    if (filters.end_date) {
      conditions.push(`i.issued_at <= $${i++}`);
      values.push(filters.end_date);
    }
    if (filters.search) {
      conditions.push(
        `(i.invoice_number ILIKE $${i} OR i.subscription_number ILIKE $${i} OR t.name ILIKE $${i} OR t.email ILIKE $${i})`,
      );
      values.push(`%${filters.search}%`);
      i++;
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const countResult = await pool.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total
       FROM teacher_subscription_invoices i
       JOIN users t ON t.id = i.teacher_id
       ${where}`,
      values,
    );

    const listResult = await pool.query(
      `SELECT i.*,
              t.name AS teacher_name, t.email AS teacher_email,
              cb.name AS created_by_name
       FROM teacher_subscription_invoices i
       JOIN users t ON t.id = i.teacher_id
       LEFT JOIN users cb ON cb.id = i.created_by
       ${where}
       ORDER BY i.issued_at DESC, i.id DESC
       LIMIT $${i++} OFFSET $${i}`,
      [...values, limit, offset],
    );

    return {
      invoices: listResult.rows.map((row) => enrichInvoiceRow(row)),
      total: Number(countResult.rows[0]?.total ?? 0),
      limit,
      offset,
    };
  }

  static async listForTeacher(
    teacherId: number,
    filters: {
      invoice_type?: InvoiceType;
      limit?: number;
      offset?: number;
    } = {},
  ) {
    return this.list({
      teacher_id: teacherId,
      invoice_type: filters.invoice_type,
      limit: filters.limit,
      offset: filters.offset,
    });
  }

  static async requireForTeacher(invoiceId: number, teacherId: number) {
    const invoice = await this.getById(invoiceId, { teacher_id: teacherId });
    if (!invoice) {
      throw new HttpError(404, 'الفاتورة غير موجودة');
    }
    return invoice;
  }
}
