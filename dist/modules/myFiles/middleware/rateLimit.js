"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.teacherFilesMaxSizeBytes = exports.teacherFilesBulkUploadRateLimit = exports.teacherFilesDownloadRateLimit = exports.teacherFilesUploadRateLimit = void 0;
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const config_1 = require("../config");
exports.teacherFilesUploadRateLimit = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        success: false,
        message: 'تم تجاوز حد رفع الملفات. حاول مرة أخرى لاحقاً.',
    },
});
exports.teacherFilesDownloadRateLimit = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000,
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        success: false,
        message: 'تم تجاوز حد التحميل. حاول مرة أخرى لاحقاً.',
    },
});
exports.teacherFilesBulkUploadRateLimit = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        success: false,
        message: 'تم تجاوز حد الرفع الجماعي. حاول مرة أخرى لاحقاً.',
    },
});
/** Guard against oversized uploads at middleware level (multer also enforces). */
exports.teacherFilesMaxSizeBytes = config_1.myFilesConfig.maxFileSizeBytes;
