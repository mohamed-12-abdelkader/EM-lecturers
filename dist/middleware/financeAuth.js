"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FINANCE_PERMISSIONS = void 0;
exports.adminOrFinanceManager = adminOrFinanceManager;
const permissions_1 = require("./permissions");
exports.FINANCE_PERMISSIONS = [
    'can_manage_accounting',
    'manage_accounting',
    'accounting_management',
    'financial_management',
];
async function adminOrFinanceManager(req, res, next) {
    const user = req.user;
    if (!user) {
        return res.status(401).json({ success: false, message: 'غير مصرح' });
    }
    if (user.role === 'admin')
        return next();
    if (user.role === 'employee') {
        const hasPermission = await (0, permissions_1.employeeHasAnyPermission)(user.id, exports.FINANCE_PERMISSIONS);
        if (hasPermission)
            return next();
    }
    return res.status(403).json({ success: false, message: 'لا تملك صلاحية إدارة الحسابات' });
}
