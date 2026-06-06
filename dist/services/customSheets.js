"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createSheet = createSheet;
exports.getSheets = getSheets;
exports.getSheetById = getSheetById;
exports.updateSheet = updateSheet;
exports.deleteSheet = deleteSheet;
exports.createRow = createRow;
exports.updateRow = updateRow;
exports.deleteRow = deleteRow;
exports.getRows = getRows;
const pool_1 = __importDefault(require("../db/pool"));
async function createSheet(name, fields, createdBy) {
    const result = await pool_1.default.query(`INSERT INTO custom_sheets (name, fields, created_by)
     VALUES ($1, $2, $3) RETURNING *`, [name, JSON.stringify(fields), createdBy]);
    return result.rows[0];
}
async function getSheets() {
    const result = await pool_1.default.query('SELECT * FROM custom_sheets ORDER BY created_at DESC');
    return result.rows;
}
async function getSheetById(id) {
    const result = await pool_1.default.query('SELECT * FROM custom_sheets WHERE id = $1', [id]);
    return result.rows[0] || null;
}
async function updateSheet(id, name, fields) {
    const result = await pool_1.default.query(`UPDATE custom_sheets SET name = $1, fields = $2, updated_at = CURRENT_TIMESTAMP
     WHERE id = $3 RETURNING *`, [name, JSON.stringify(fields), id]);
    return result.rows[0] || null;
}
async function deleteSheet(id) {
    const result = await pool_1.default.query('DELETE FROM custom_sheets WHERE id = $1', [id]);
    return (result.rowCount ?? 0) > 0;
}
async function createRow(sheetId, data) {
    const result = await pool_1.default.query(`INSERT INTO custom_sheet_rows (sheet_id, data) VALUES ($1, $2) RETURNING *`, [sheetId, JSON.stringify(data)]);
    return result.rows[0];
}
async function updateRow(rowId, data) {
    const result = await pool_1.default.query(`UPDATE custom_sheet_rows SET data = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *`, [JSON.stringify(data), rowId]);
    return result.rows[0] || null;
}
async function deleteRow(rowId) {
    const result = await pool_1.default.query('DELETE FROM custom_sheet_rows WHERE id = $1', [rowId]);
    return (result.rowCount ?? 0) > 0;
}
async function getRows(sheetId, pageSize = 20, page = 1, search) {
    const offset = (page - 1) * pageSize;
    let rowsQuery = 'SELECT * FROM custom_sheet_rows WHERE sheet_id = $1';
    let countQuery = 'SELECT COUNT(*) FROM custom_sheet_rows WHERE sheet_id = $1';
    const params = [sheetId];
    if (search) {
        rowsQuery += ` AND data::text ILIKE $2`;
        countQuery += ` AND data::text ILIKE $2`;
        params.push(`%${search}%`);
    }
    rowsQuery += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    const countResult = await pool_1.default.query(countQuery, params);
    const totalCount = parseInt(countResult.rows[0].count, 10);
    const totalPages = Math.ceil(totalCount / pageSize);
    const finalParams = [...params, pageSize, offset];
    const rowsResult = await pool_1.default.query(rowsQuery, finalParams);
    return { rows: rowsResult.rows, totalCount, totalPages };
}
