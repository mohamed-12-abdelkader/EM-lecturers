"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TeacherSubscriptionPlansService = void 0;
const pool_1 = __importDefault(require("../db/pool"));
const financialAudit_1 = require("./financialAudit");
class TeacherSubscriptionPlansService {
    static async list(activeOnly = true) {
        const result = await pool_1.default.query(`SELECT * FROM teacher_subscription_plans
       ${activeOnly ? 'WHERE is_active = TRUE' : ''}
       ORDER BY sort_order ASC, id ASC`);
        return result.rows;
    }
    static async getById(id) {
        const result = await pool_1.default.query(`SELECT * FROM teacher_subscription_plans WHERE id = $1`, [id]);
        return result.rows[0] ?? null;
    }
    static async getByCode(code) {
        const result = await pool_1.default.query(`SELECT * FROM teacher_subscription_plans WHERE code = $1`, [
            code,
        ]);
        return result.rows[0] ?? null;
    }
    static async update(id, patch, actorId) {
        const existing = await this.getById(id);
        if (!existing)
            throw new Error('Plan not found');
        const fields = [];
        const values = [];
        let i = 1;
        const add = (col, val) => {
            fields.push(`${col} = $${i++}`);
            values.push(val);
        };
        if (patch.name_ar !== undefined)
            add('name_ar', patch.name_ar);
        if (patch.name_en !== undefined)
            add('name_en', patch.name_en);
        if (patch.description !== undefined)
            add('description', patch.description);
        if (patch.default_price !== undefined)
            add('default_price', patch.default_price);
        if (patch.duration_days !== undefined)
            add('duration_days', patch.duration_days);
        if (patch.features !== undefined)
            add('features', JSON.stringify(patch.features));
        if (patch.is_active !== undefined)
            add('is_active', patch.is_active);
        if (patch.sort_order !== undefined)
            add('sort_order', patch.sort_order);
        if (!fields.length)
            return existing;
        values.push(id);
        const result = await pool_1.default.query(`UPDATE teacher_subscription_plans
       SET ${fields.join(', ')}, updated_at = NOW()
       WHERE id = $${i}
       RETURNING *`, values);
        await financialAudit_1.FinancialAuditService.log({
            entity_type: 'teacher_subscription_plan',
            entity_id: id,
            action: 'update',
            actor_id: actorId,
            before_data: existing,
            after_data: result.rows[0],
        });
        return result.rows[0];
    }
}
exports.TeacherSubscriptionPlansService = TeacherSubscriptionPlansService;
