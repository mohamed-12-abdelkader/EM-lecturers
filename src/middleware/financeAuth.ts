import { Request, Response, NextFunction } from 'express';
import { employeeHasAnyPermission } from './permissions';

export const FINANCE_PERMISSIONS = [
  'can_manage_accounting',
  'manage_accounting',
  'accounting_management',
  'financial_management',
];

export async function adminOrFinanceManager(req: Request, res: Response, next: NextFunction) {
  const user = (req as any).user;
  if (!user) {
    return res.status(401).json({ success: false, message: 'غير مصرح' });
  }
  if (user.role === 'admin') return next();
  if (user.role === 'employee') {
    const hasPermission = await employeeHasAnyPermission(user.id, FINANCE_PERMISSIONS);
    if (hasPermission) return next();
  }
  return res.status(403).json({ success: false, message: 'لا تملك صلاحية إدارة الحسابات' });
}
