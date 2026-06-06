import { Request, Response, Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/authentication';
import { checkAnyPermission } from '../middleware/permissions';
import * as CustomSheetsService from '../services/customSheets';
import pool from '../db/pool';

const FieldSchema = z.object({
  name: z.string().min(1),
  type: z.string().min(1),
  required: z.boolean().default(false),
}).passthrough();

const CreateSheetSchema = z.object({
  name: z.string().min(1),
  fields: z.array(FieldSchema).min(1),
});

const UpdateSheetSchema = CreateSheetSchema;

function validateRowData(data: any, fields: CustomSheetsService.SheetField[]) {
  const errors: string[] = [];
  for (const field of fields) {
    const value = data[field.name];
    if (field.required && (value === undefined || value === null || value === '')) {
      errors.push(`الحقل "${field.name}" مطلوب.`);
      continue;
    }
    
    if (value !== undefined && value !== null && value !== '') {
      if (field.type === 'Number' && isNaN(Number(value))) {
        errors.push(`الحقل "${field.name}" يجب أن يكون رقماً.`);
      }
      if (field.type === 'Phone' && !/^\+?\d+$/.test(String(value))) {
        errors.push(`الحقل "${field.name}" غير صالح كرقم هاتف.`);
      }
    }
  }
  return errors;
}

type ChangeAction = 'update_sheet' | 'delete_sheet' | 'update_row' | 'delete_row';

async function createChangeRequest(params: {
  sheetId: string;
  rowId?: string;
  action: ChangeAction;
  payload?: Record<string, any>;
  requestedBy: number;
}) {
  const result = await pool.query(
    `INSERT INTO custom_sheet_change_requests (sheet_id, row_id, action, payload, requested_by)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [
      params.sheetId,
      params.rowId || null,
      params.action,
      JSON.stringify(params.payload || {}),
      params.requestedBy,
    ],
  );
  return result.rows[0];
}

async function createSheet(req: Request, res: Response) {
  try {
    const user = (req as any).user;
    const validated = CreateSheetSchema.parse(req.body);
    const sheet = await CustomSheetsService.createSheet(validated.name, validated.fields, user?.id);
    
    res.status(201).json({
      success: true,
      message: 'تم إنشاء الشيت بنجاح',
      data: sheet,
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, message: 'بيانات غير صحيحة', errors: error.errors });
    }
    res.status(500).json({ success: false, message: 'خطأ في إنشاء الشيت', error: error.message });
  }
}

async function getSheets(req: Request, res: Response) {
  try {
    const sheets = await CustomSheetsService.getSheets();
    res.status(200).json({ success: true, data: sheets });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'خطأ في جلب الشيتات', error: error.message });
  }
}

async function getSheetById(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const sheet = await CustomSheetsService.getSheetById(id);
    if (!sheet) {
      return res.status(404).json({ success: false, message: 'الشيت غير موجود' });
    }
    res.status(200).json({ success: true, data: sheet });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'خطأ في جلب الشيت', error: error.message });
  }
}

async function updateSheet(req: Request, res: Response) {
  try {
    const user = (req as any).user;
    const { id } = req.params;
    const validated = UpdateSheetSchema.parse(req.body);
    if (user?.role === 'employee') {
      const request = await createChangeRequest({
        sheetId: id,
        action: 'update_sheet',
        payload: { name: validated.name, fields: validated.fields },
        requestedBy: user.id,
      });
      return res.status(202).json({
        success: true,
        message: 'تم إرسال طلب تعديل الشيت للأدمن للموافقة',
        data: request,
      });
    }
    const sheet = await CustomSheetsService.updateSheet(id, validated.name, validated.fields);
    if (!sheet) {
      return res.status(404).json({ success: false, message: 'الشيت غير موجود' });
    }
    res.status(200).json({ success: true, message: 'تم التعديل بنجاح', data: sheet });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, message: 'بيانات غير صحيحة', errors: error.errors });
    }
    res.status(500).json({ success: false, message: 'خطأ في تعديل الشيت', error: error.message });
  }
}

async function deleteSheet(req: Request, res: Response) {
  try {
    const user = (req as any).user;
    const { id } = req.params;
    if (user?.role === 'employee') {
      const request = await createChangeRequest({
        sheetId: id,
        action: 'delete_sheet',
        requestedBy: user.id,
      });
      return res.status(202).json({
        success: true,
        message: 'تم إرسال طلب حذف الشيت للأدمن للموافقة',
        data: request,
      });
    }
    const success = await CustomSheetsService.deleteSheet(id);
    if (!success) {
      return res.status(404).json({ success: false, message: 'الشيت غير موجود' });
    }
    res.status(200).json({ success: true, message: 'تم حذف الشيت' });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'خطأ في الحذف', error: error.message });
  }
}

async function createRow(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const data = req.body;
    
    const sheet = await CustomSheetsService.getSheetById(id);
    if (!sheet) {
      return res.status(404).json({ success: false, message: 'الشيت غير موجود' });
    }
    
    const errors = validateRowData(data, sheet.fields);
    if (errors.length > 0) {
      return res.status(400).json({ success: false, message: 'بيانات غير صحيحة', errors });
    }
    
    const row = await CustomSheetsService.createRow(id, data);
    res.status(201).json({ success: true, message: 'تمت إضافة السجل', data: row });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'خطأ في إضافة السجل', error: error.message });
  }
}

async function updateRow(req: Request, res: Response) {
  try {
    const user = (req as any).user;
    const { id, rowId } = req.params;
    const data = req.body;
    
    const sheet = await CustomSheetsService.getSheetById(id);
    if (!sheet) {
      return res.status(404).json({ success: false, message: 'الشيت غير موجود' });
    }
    
    const errors = validateRowData(data, sheet.fields);
    if (errors.length > 0) {
      return res.status(400).json({ success: false, message: 'بيانات غير صحيحة', errors });
    }

    if (user?.role === 'employee') {
      const request = await createChangeRequest({
        sheetId: id,
        rowId,
        action: 'update_row',
        payload: { data },
        requestedBy: user.id,
      });
      return res.status(202).json({
        success: true,
        message: 'تم إرسال طلب تعديل السجل للأدمن للموافقة',
        data: request,
      });
    }

    const row = await CustomSheetsService.updateRow(rowId, data);
    if (!row) {
      return res.status(404).json({ success: false, message: 'السجل غير موجود' });
    }
    res.status(200).json({ success: true, message: 'تم تعديل السجل', data: row });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'خطأ في التعديل', error: error.message });
  }
}

async function deleteRow(req: Request, res: Response) {
  try {
    const user = (req as any).user;
    const { id, rowId } = req.params;
    if (user?.role === 'employee') {
      const request = await createChangeRequest({
        sheetId: id,
        rowId,
        action: 'delete_row',
        requestedBy: user.id,
      });
      return res.status(202).json({
        success: true,
        message: 'تم إرسال طلب حذف السجل للأدمن للموافقة',
        data: request,
      });
    }
    const success = await CustomSheetsService.deleteRow(rowId);
    if (!success) {
      return res.status(404).json({ success: false, message: 'السجل غير موجود' });
    }
    res.status(200).json({ success: true, message: 'تم الحذف' });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'خطأ في الحذف', error: error.message });
  }
}

async function getRows(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const search = req.query.search as string | undefined;
    
    const result = await CustomSheetsService.getRows(id, limit, page, search);
    res.status(200).json({
      success: true,
      data: result.rows,
      pagination: {
        page,
        limit,
        totalCount: result.totalCount,
        totalPages: result.totalPages,
      }
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'خطأ في جلب البيانات', error: error.message });
  }
}

// Admin: عرض طلبات تعديل/حذف الشيتات
async function getChangeRequests(req: Request, res: Response) {
  try {
    const status = String(req.query.status || 'pending');
    const result = await pool.query(
      `SELECT r.*, u.name AS requested_by_name, s.name AS sheet_name, rs.data AS row_current_data
       FROM custom_sheet_change_requests r
       LEFT JOIN users u ON u.id = r.requested_by
       LEFT JOIN custom_sheets s ON s.id = r.sheet_id
       LEFT JOIN custom_sheet_rows rs ON rs.id = r.row_id
       WHERE ($1 = 'all' OR r.status = $1)
       ORDER BY r.created_at DESC`,
      [status],
    );
    const data = result.rows.map((row: any) => {
      const payload = row.payload || {};
      const action: ChangeAction = row.action;

      let change_preview: Record<string, any> = {};
      if (action === 'update_sheet') {
        change_preview = {
          from: {
            sheet_name: row.sheet_name || null,
          },
          to: {
            sheet_name: payload?.name ?? null,
            fields: payload?.fields ?? null,
          },
        };
      } else if (action === 'delete_sheet') {
        change_preview = {
          target: {
            sheet_name: row.sheet_name || null,
          },
          action: 'delete_sheet',
        };
      } else if (action === 'update_row') {
        change_preview = {
          from: {
            row_data: row.row_current_data ?? null,
          },
          to: {
            row_data: payload?.data ?? null,
          },
        };
      } else if (action === 'delete_row') {
        change_preview = {
          target: {
            row_data: row.row_current_data ?? null,
          },
          action: 'delete_row',
        };
      }

      return {
        ...row,
        change_preview,
      };
    });
    res.status(200).json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'خطأ في جلب طلبات التعديل', error: error.message });
  }
}

// Admin: الموافقة على طلب وتطبيقه فعلياً
async function approveChangeRequest(req: Request, res: Response) {
  const client = await pool.connect();
  try {
    const user = (req as any).user;
    const { requestId } = req.params;
    const { admin_note } = req.body || {};

    await client.query('BEGIN');
    const reqRes = await client.query(
      `SELECT * FROM custom_sheet_change_requests WHERE id = $1 FOR UPDATE`,
      [requestId],
    );
    const request = reqRes.rows[0];
    if (!request) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'طلب التعديل غير موجود' });
    }
    if (request.status !== 'pending') {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: 'هذا الطلب تم مراجعته بالفعل' });
    }

    let applied: any = null;
    if (request.action === 'update_sheet') {
      const q = await client.query(
        `UPDATE custom_sheets SET name = $1, fields = $2, updated_at = CURRENT_TIMESTAMP
         WHERE id = $3 RETURNING *`,
        [request.payload?.name, JSON.stringify(request.payload?.fields || []), request.sheet_id],
      );
      applied = q.rows[0];
      if (!applied) throw new Error('الشيت غير موجود');
    } else if (request.action === 'delete_sheet') {
      const q = await client.query(`DELETE FROM custom_sheets WHERE id = $1 RETURNING id`, [request.sheet_id]);
      applied = q.rows[0];
      if (!applied) throw new Error('الشيت غير موجود');
    } else if (request.action === 'update_row') {
      const q = await client.query(
        `UPDATE custom_sheet_rows SET data = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *`,
        [JSON.stringify(request.payload?.data || {}), request.row_id],
      );
      applied = q.rows[0];
      if (!applied) throw new Error('السجل غير موجود');
    } else if (request.action === 'delete_row') {
      const q = await client.query(`DELETE FROM custom_sheet_rows WHERE id = $1 RETURNING id`, [request.row_id]);
      applied = q.rows[0];
      if (!applied) throw new Error('السجل غير موجود');
    }

    const updateReq = await client.query(
      `UPDATE custom_sheet_change_requests
       SET status = 'approved',
           reviewed_by = $1,
           reviewed_at = CURRENT_TIMESTAMP,
           admin_note = $2,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $3
       RETURNING *`,
      [user.id, admin_note || null, requestId],
    );
    await client.query('COMMIT');
    return res.status(200).json({
      success: true,
      message: 'تمت الموافقة وتنفيذ الطلب بنجاح',
      data: {
        request: updateReq.rows[0],
        applied,
      },
    });
  } catch (error: any) {
    await client.query('ROLLBACK');
    return res.status(500).json({ success: false, message: 'خطأ في الموافقة على الطلب', error: error.message });
  } finally {
    client.release();
  }
}

// Admin: رفض طلب
async function rejectChangeRequest(req: Request, res: Response) {
  try {
    const user = (req as any).user;
    const { requestId } = req.params;
    const { admin_note } = req.body || {};
    const result = await pool.query(
      `UPDATE custom_sheet_change_requests
       SET status = 'rejected',
           reviewed_by = $1,
           reviewed_at = CURRENT_TIMESTAMP,
           admin_note = $2,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $3 AND status = 'pending'
       RETURNING *`,
      [user.id, admin_note || null, requestId],
    );
    if (!result.rowCount) {
      return res.status(404).json({ success: false, message: 'الطلب غير موجود أو تمت مراجعته بالفعل' });
    }
    return res.status(200).json({ success: true, message: 'تم رفض الطلب', data: result.rows[0] });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: 'خطأ في رفض الطلب', error: error.message });
  }
}

const router = Router();
router.use(authMiddleware(['admin', 'employee']));
router.use(
  checkAnyPermission([
    'custom_sheets_management',
    'can_manage_custom_sheets',
    'manage_custom_sheets',
    'custom_sheets',
    'sheet_management',
    'can_manage_sheets',
    'question_bank_management',
  ]),
);

router.post('/', createSheet);
router.get('/', getSheets);
router.get('/requests/all', authMiddleware(['admin']), getChangeRequests);
router.patch('/requests/:requestId/approve', authMiddleware(['admin']), approveChangeRequest);
router.patch('/requests/:requestId/reject', authMiddleware(['admin']), rejectChangeRequest);
router.get('/:id', getSheetById);
router.put('/:id', updateSheet);
router.delete('/:id', deleteSheet);

router.post('/:id/rows', createRow);
router.get('/:id/rows', getRows);
router.put('/:id/rows/:rowId', updateRow);
router.delete('/:id/rows/:rowId', deleteRow);

export { router };
