import pool from '../db/pool';

export interface SheetField {
  name: string;
  type: string;
  required: boolean;
  [key: string]: any;
}

export interface CustomSheet {
  id: string;
  name: string;
  fields: SheetField[];
  created_at: Date;
  updated_at: Date;
  created_by?: number;
}

export interface CustomSheetRow {
  id: string;
  sheet_id: string;
  data: Record<string, any>;
  created_at: Date;
  updated_at: Date;
}

export async function createSheet(
  name: string,
  fields: SheetField[],
  createdBy?: number,
): Promise<CustomSheet> {
  const result = await pool.query(
    `INSERT INTO custom_sheets (name, fields, created_by)
     VALUES ($1, $2, $3) RETURNING *`,
    [name, JSON.stringify(fields), createdBy]
  );
  return result.rows[0];
}

export async function getSheets(): Promise<CustomSheet[]> {
  const result = await pool.query('SELECT * FROM custom_sheets ORDER BY created_at DESC');
  return result.rows;
}

export async function getSheetById(id: string): Promise<CustomSheet | null> {
  const result = await pool.query('SELECT * FROM custom_sheets WHERE id = $1', [id]);
  return result.rows[0] || null;
}

export async function updateSheet(
  id: string,
  name: string,
  fields: SheetField[],
): Promise<CustomSheet | null> {
  const result = await pool.query(
    `UPDATE custom_sheets SET name = $1, fields = $2, updated_at = CURRENT_TIMESTAMP
     WHERE id = $3 RETURNING *`,
    [name, JSON.stringify(fields), id]
  );
  return result.rows[0] || null;
}

export async function deleteSheet(id: string): Promise<boolean> {
  const result = await pool.query('DELETE FROM custom_sheets WHERE id = $1', [id]);
  return (result.rowCount ?? 0) > 0;
}

export async function createRow(sheetId: string, data: Record<string, any>): Promise<CustomSheetRow> {
  const result = await pool.query(
    `INSERT INTO custom_sheet_rows (sheet_id, data) VALUES ($1, $2) RETURNING *`,
    [sheetId, JSON.stringify(data)]
  );
  return result.rows[0];
}

export async function updateRow(rowId: string, data: Record<string, any>): Promise<CustomSheetRow | null> {
  const result = await pool.query(
    `UPDATE custom_sheet_rows SET data = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *`,
    [JSON.stringify(data), rowId]
  );
  return result.rows[0] || null;
}

export async function deleteRow(rowId: string): Promise<boolean> {
  const result = await pool.query('DELETE FROM custom_sheet_rows WHERE id = $1', [rowId]);
  return (result.rowCount ?? 0) > 0;
}

export async function getRows(
  sheetId: string,
  pageSize: number = 20,
  page: number = 1,
  search?: string
): Promise<{ rows: CustomSheetRow[]; totalCount: number; totalPages: number }> {
  const offset = (page - 1) * pageSize;
  
  let rowsQuery = 'SELECT * FROM custom_sheet_rows WHERE sheet_id = $1';
  let countQuery = 'SELECT COUNT(*) FROM custom_sheet_rows WHERE sheet_id = $1';
  const params: any[] = [sheetId];

  if (search) {
    rowsQuery += ` AND data::text ILIKE $2`;
    countQuery += ` AND data::text ILIKE $2`;
    params.push(`%${search}%`);
  }

  rowsQuery += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  
  const countResult = await pool.query(countQuery, params);
  const totalCount = parseInt(countResult.rows[0].count, 10);
  const totalPages = Math.ceil(totalCount / pageSize);
  
  const finalParams = [...params, pageSize, offset];
  const rowsResult = await pool.query(rowsQuery, finalParams);
  
  return { rows: rowsResult.rows, totalCount, totalPages };
}
