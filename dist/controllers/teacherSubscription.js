"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.router = void 0;
const express_1 = require("express");
const authentication_1 = require("../middleware/authentication");
const utils_1 = require("../utils");
const teacherPlatformSubscriptions_1 = require("../services/teacherPlatformSubscriptions");
const teacherSubscriptionInvoices_1 = require("../services/teacherSubscriptionInvoices");
const teacherPlanPolicy_1 = require("../services/teacherPlanPolicy");
exports.router = (0, express_1.Router)();
exports.router.use((0, authentication_1.authMiddleware)(['teacher']));
/** صلاحيات الباقة الحالية — للواجهة (إظهار/إخفاء الخدمات) */
exports.router.get('/plan-access', (0, utils_1.asyncWrapper)(async (req, res) => {
    const data = await (0, teacherPlanPolicy_1.getTeacherPlanAccess)(req.user.id);
    res.json({ success: true, data });
}));
/** Expiry alert for teacher dashboard — hidden automatically after renewal */
exports.router.get('/expiry-alert', (0, utils_1.asyncWrapper)(async (req, res) => {
    const days = req.query.days ? Number(req.query.days) : undefined;
    const graceDays = req.query.grace_days ? Number(req.query.grace_days) : undefined;
    const data = await teacherPlatformSubscriptions_1.TeacherPlatformSubscriptionsService.getTeacherExpiryAlert(req.user.id, days, graceDays);
    res.json({ success: true, data });
}));
/** فواتير اشتراكات المدرس */
exports.router.get('/invoices', (0, utils_1.asyncWrapper)(async (req, res) => {
    const data = await teacherSubscriptionInvoices_1.TeacherSubscriptionInvoicesService.listForTeacher(req.user.id, {
        invoice_type: req.query.invoice_type,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
        offset: req.query.offset ? Number(req.query.offset) : undefined,
    });
    res.json({ success: true, data });
}));
exports.router.get('/invoices/:id', (0, utils_1.asyncWrapper)(async (req, res) => {
    const invoice = await teacherSubscriptionInvoices_1.TeacherSubscriptionInvoicesService.requireForTeacher(Number(req.params.id), req.user.id);
    res.json({ success: true, data: invoice });
}));
