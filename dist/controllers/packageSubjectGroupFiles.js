"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.router = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const authentication_1 = require("../middleware/authentication");
const utils_1 = require("../utils");
const packageSubjectGroups_1 = require("../services/packageSubjectGroups");
const packageSubjectGroupFiles_1 = require("../services/packageSubjectGroupFiles");
exports.router = (0, express_1.Router)();
const CreateFileSchema = zod_1.z.object({
    title: zod_1.z.string().min(1),
    file_url: zod_1.z.string().url(),
    order_index: zod_1.z.number().int().min(0).optional(),
});
const UpdateFileSchema = zod_1.z.object({
    title: zod_1.z.string().min(1).optional(),
    file_url: zod_1.z.string().url().optional(),
    order_index: zod_1.z.number().int().min(0).optional(),
});
async function checkGroupPermission(groupId, userId, userRole) {
    if (userRole === 'admin')
        return true;
    if (userRole !== 'teacher')
        return false;
    return await packageSubjectGroups_1.PackageSubjectGroupsService.teacherOwnsGroup(groupId, userId);
}
// POST /api/subjects/:subjectId/groups/:groupId/group-files
exports.router.post('/subjects/:subjectId(\\d+)/groups/:groupId(\\d+)/group-files', (0, authentication_1.authMiddleware)(['admin', 'teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const subjectId = parseInt(req.params.subjectId);
    const groupId = parseInt(req.params.groupId);
    if (isNaN(subjectId) || isNaN(groupId))
        return res.status(400).json({ error: 'Invalid IDs' });
    const group = await packageSubjectGroups_1.PackageSubjectGroupsService.getGroupById(groupId);
    if (!group || group.package_subject_item_id !== subjectId) {
        return res.status(404).json({ error: 'المجموعة غير موجودة' });
    }
    const user = req.user;
    const ok = await checkGroupPermission(groupId, user.id, user.role);
    if (!ok)
        return res.status(403).json({ error: 'Forbidden' });
    const parsed = CreateFileSchema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: 'Validation failed', errors: parsed.error.errors });
    const file = await packageSubjectGroupFiles_1.PackageSubjectGroupFilesService.createFile(groupId, parsed.data);
    return res.status(201).json({ success: true, file });
}));
// GET /api/subjects/:subjectId/groups/:groupId/group-files
exports.router.get('/subjects/:subjectId(\\d+)/groups/:groupId(\\d+)/group-files', (0, authentication_1.authMiddleware)(['admin', 'teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const subjectId = parseInt(req.params.subjectId);
    const groupId = parseInt(req.params.groupId);
    if (isNaN(subjectId) || isNaN(groupId))
        return res.status(400).json({ error: 'Invalid IDs' });
    const group = await packageSubjectGroups_1.PackageSubjectGroupsService.getGroupById(groupId);
    if (!group || group.package_subject_item_id !== subjectId) {
        return res.status(404).json({ error: 'المجموعة غير موجودة' });
    }
    const user = req.user;
    const ok = await checkGroupPermission(groupId, user.id, user.role);
    if (!ok)
        return res.status(403).json({ error: 'Forbidden' });
    const files = await packageSubjectGroupFiles_1.PackageSubjectGroupFilesService.getFilesByGroup(groupId);
    return res.json({ success: true, group_id: groupId, files, total: files.length });
}));
// PUT /api/group-files/:fileId
exports.router.put('/group-files/:fileId', (0, authentication_1.authMiddleware)(['admin', 'teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const fileId = parseInt(req.params.fileId);
    if (isNaN(fileId))
        return res.status(400).json({ error: 'Invalid file ID' });
    const existing = await packageSubjectGroupFiles_1.PackageSubjectGroupFilesService.getFileById(fileId);
    if (!existing)
        return res.status(404).json({ error: 'الملف غير موجود' });
    const group = await packageSubjectGroups_1.PackageSubjectGroupsService.getGroupById(existing.group_id);
    if (!group)
        return res.status(404).json({ error: 'المجموعة غير موجودة' });
    const user = req.user;
    const ok = await checkGroupPermission(existing.group_id, user.id, user.role);
    if (!ok)
        return res.status(403).json({ error: 'Forbidden' });
    const parsed = UpdateFileSchema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: 'Validation failed', errors: parsed.error.errors });
    const updated = await packageSubjectGroupFiles_1.PackageSubjectGroupFilesService.updateFile(fileId, parsed.data);
    return res.json({ success: true, file: updated });
}));
// DELETE /api/group-files/:fileId
exports.router.delete('/group-files/:fileId', (0, authentication_1.authMiddleware)(['admin', 'teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const fileId = parseInt(req.params.fileId);
    if (isNaN(fileId))
        return res.status(400).json({ error: 'Invalid file ID' });
    const existing = await packageSubjectGroupFiles_1.PackageSubjectGroupFilesService.getFileById(fileId);
    if (!existing)
        return res.status(404).json({ error: 'الملف غير موجود' });
    const group = await packageSubjectGroups_1.PackageSubjectGroupsService.getGroupById(existing.group_id);
    if (!group)
        return res.status(404).json({ error: 'المجموعة غير موجودة' });
    const user = req.user;
    const ok = await checkGroupPermission(existing.group_id, user.id, user.role);
    if (!ok)
        return res.status(403).json({ error: 'Forbidden' });
    await packageSubjectGroupFiles_1.PackageSubjectGroupFilesService.deleteFile(fileId);
    return res.json({ success: true, message: 'تم حذف الملف بنجاح' });
}));
