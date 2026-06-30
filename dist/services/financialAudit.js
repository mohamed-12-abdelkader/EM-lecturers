"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FinancialAuditService = void 0;
exports.recordFinancialTransaction = recordFinancialTransaction;
const pool_1 = __importDefault(require("../db/pool"));
class FinancialAuditService {
    static async log(input) {
        const result = await pool_1.default.query(`INSERT INTO platform_financial_audit_logs
         (entity_type, entity_id, action, actor_id, before_data, after_data, notes)
       VALUES ($1, $2, $3, $4, $5::JSONB, $6::JSONB, $7)
       RETURNING *`, [
            input.entity_type,
            input.entity_id ?? null,
            input.action,
            input.actor_id,
            input.before_data ? JSON.stringify(input.before_data) : null,
            input.after_data ? JSON.stringify(input.after_data) : null,
            input.notes ?? null,
        ]);
        return result.rows[0];
    }
    static async list(filters = {}) {
        const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
        const offset = Math.max(filters.offset ?? 0, 0);
        const conditions = [];
        const values = [];
        let i = 1;
        if (filters.entity_type) {
            conditions.push(`a.entity_type = $${i++}`);
            values.push(filters.entity_type);
        }
        if (filters.entity_id) {
            conditions.push(`a.entity_id = $${i++}`);
            values.push(filters.entity_id);
        }
        if (filters.action) {
            conditions.push(`a.action = $${i++}`);
            values.push(filters.action);
        }
        if (filters.actor_id) {
            conditions.push(`a.actor_id = $${i++}`);
            values.push(filters.actor_id);
        }
        if (filters.start_date) {
            conditions.push(`a.created_at::date >= $${i++}::date`);
            values.push(filters.start_date);
        }
        if (filters.end_date) {
            conditions.push(`a.created_at::date <= $${i++}::date`);
            values.push(filters.end_date);
        }
        const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
        const countResult = await pool_1.default.query(`SELECT COUNT(*)::text AS total FROM platform_financial_audit_logs a ${where}`, values);
        const listResult = await pool_1.default.query(`SELECT a.*, u.name AS actor_name
       FROM platform_financial_audit_logs a
       LEFT JOIN users u ON u.id = a.actor_id
       ${where}
       ORDER BY a.created_at DESC
       LIMIT $${i++} OFFSET $${i}`, [...values, limit, offset]);
        return {
            logs: listResult.rows,
            total: Number(countResult.rows[0]?.total ?? 0),
            limit,
            offset,
        };
    }
}
exports.FinancialAuditService = FinancialAuditService;
async function recordFinancialTransaction(input) {
    await pool_1.default.query(`INSERT INTO platform_financial_transactions (
       transaction_kind, reference_table, reference_id, amount, direction,
       teacher_id, plan_code, category, transaction_date, description, created_by
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`, [
        input.transaction_kind,
        input.reference_table,
        input.reference_id,
        input.amount,
        input.direction,
        input.teacher_id ?? null,
        input.plan_code ?? null,
        input.category ?? null,
        input.transaction_date,
        input.description ?? null,
        input.created_by,
    ]);
}
