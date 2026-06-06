"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createQuestionBankChangeRequest = createQuestionBankChangeRequest;
const pool_1 = __importDefault(require("../db/pool"));
async function createQuestionBankChangeRequest(params) {
    const result = await pool_1.default.query(`INSERT INTO question_bank_change_requests (entity_type, entity_id, action, payload, requested_by)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`, [
        params.entityType,
        params.entityId,
        params.action,
        JSON.stringify(params.payload || {}),
        params.requestedBy,
    ]);
    return result.rows[0];
}
