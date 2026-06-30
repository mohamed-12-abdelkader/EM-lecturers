"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.MistralOcrService = void 0;
exports.parsePdfPageRange = parsePdfPageRange;
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const mistral_1 = require("../config/mistral");
const utils_1 = require("../utils");
const PDF_MIMES = new Set(['application/pdf']);
const IMAGE_MIMES = new Set([
    'image/png',
    'image/jpeg',
    'image/jpg',
    'image/webp',
    'image/gif',
    'image/avif',
    'image/bmp',
    'image/tiff',
]);
const EXT_MIME = {
    '.pdf': 'application/pdf',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.avif': 'image/avif',
    '.bmp': 'image/bmp',
    '.tif': 'image/tiff',
    '.tiff': 'image/tiff',
};
/** Build 0-based Mistral page indices from 1-based inclusive user range. */
function parsePdfPageRange(startPage, endPage) {
    const startRaw = startPage != null && startPage !== '' ? Number(startPage) : undefined;
    const endRaw = endPage != null && endPage !== '' ? Number(endPage) : undefined;
    if (startRaw == null && endRaw == null)
        return undefined;
    const start = Math.max(1, Number.isFinite(startRaw) ? Math.trunc(startRaw) : 1);
    const end = Math.max(start, Number.isFinite(endRaw) ? Math.trunc(endRaw) : start);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 1 || end < 1) {
        throw new utils_1.HttpError(400, 'أرقام الصفحات غير صحيحة');
    }
    const maxPagesPerRequest = 50;
    if (end - start + 1 > maxPagesPerRequest) {
        throw new utils_1.HttpError(400, `الحد الأقصى ${maxPagesPerRequest} صفحة في الطلب الواحد`);
    }
    return Array.from({ length: end - start + 1 }, (_, i) => start - 1 + i);
}
function resolveMimeType(file) {
    const fromMulter = (file.mimetype || '').toLowerCase();
    if (fromMulter && fromMulter !== 'application/octet-stream') {
        return fromMulter;
    }
    const ext = path.extname(file.originalname || file.path || '').toLowerCase();
    return EXT_MIME[ext] ?? fromMulter;
}
function isPdfMime(mime) {
    return PDF_MIMES.has(mime) || mime.endsWith('/pdf');
}
function isImageMime(mime) {
    return IMAGE_MIMES.has(mime) || mime.startsWith('image/');
}
function buildDataUri(mime, buffer) {
    return `data:${mime};base64,${buffer.toString('base64')}`;
}
function buildDocumentPayload(mime, dataUri) {
    if (isPdfMime(mime)) {
        return { type: 'document_url', document_url: dataUri };
    }
    return { type: 'image_url', image_url: dataUri };
}
function buildImageAnnotationFormat() {
    return {
        type: 'json_schema',
        json_schema: {
            name: 'question_image_annotation',
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    image_type: {
                        type: 'string',
                        description: 'Type of visual content, e.g. diagram, chart, table, graph, formula, map.',
                    },
                    short_description: {
                        type: 'string',
                        description: 'Short Arabic description of the visual content.',
                    },
                    summary: {
                        type: 'string',
                        description: 'Detailed Arabic summary explaining what the image shows and how it may be used in a question.',
                    },
                    educational_relevance: {
                        type: 'string',
                        description: 'What a student likely needs from this image to answer a question.',
                    },
                    contains_text: {
                        type: 'boolean',
                        description: 'Whether the image contains meaningful readable text.',
                    },
                    extracted_text: {
                        type: ['string', 'null'],
                        description: 'Any important text visible inside the image, or null.',
                    },
                },
                required: [
                    'image_type',
                    'short_description',
                    'summary',
                    'educational_relevance',
                    'contains_text',
                    'extracted_text',
                ],
            },
            strict: true,
        },
    };
}
function normalizeAnnotation(raw) {
    if (!raw)
        return null;
    if (typeof raw === 'string') {
        try {
            return JSON.parse(raw);
        }
        catch {
            return { summary: raw };
        }
    }
    if (typeof raw === 'object')
        return raw;
    return null;
}
function normalizePages(rawPages) {
    return (rawPages ?? []).map((page, i) => ({
        index: page.index ?? i,
        markdown: page.markdown ?? '',
        images: (page.images ?? [])
            .filter((image) => image.id)
            .map((image) => ({
            id: image.id,
            page_index: page.index ?? i,
            top_left_x: image.top_left_x,
            top_left_y: image.top_left_y,
            bottom_right_x: image.bottom_right_x,
            bottom_right_y: image.bottom_right_y,
            image_base64: image.image_base64,
            annotation: normalizeAnnotation(image.annotation ?? image.image_annotation ?? image.bbox_annotation),
        })),
        dimensions: page.dimensions ?? null,
    }));
}
class MistralOcrService {
    static isSupportedMime(mime) {
        const normalized = (mime || '').toLowerCase();
        return isPdfMime(normalized) || isImageMime(normalized);
    }
    static resolveSupportedMime(file) {
        const mime = resolveMimeType(file);
        if (isPdfMime(mime) || isImageMime(mime)) {
            return mime;
        }
        throw new utils_1.HttpError(400, 'نوع الملف غير مدعوم. ارفع PDF أو صورة (png, jpg, jpeg, webp, gif, avif)');
    }
    static async extractTextFromFile(file, options = {}) {
        (0, mistral_1.assertMistralConfigured)();
        const mime = this.resolveSupportedMime(file);
        const filePath = file.path;
        if (!filePath || !fs.existsSync(filePath)) {
            throw new utils_1.HttpError(400, 'ملف مرفوع غير موجود');
        }
        const buffer = fs.readFileSync(filePath);
        if (buffer.length === 0) {
            throw new utils_1.HttpError(400, 'الملف فارغ');
        }
        const { apiKey, apiBaseUrl, ocrModel: defaultOcrModel } = (0, mistral_1.getMistralConfig)();
        const ocrModel = options.ocrModel?.trim() || defaultOcrModel;
        const dataUri = buildDataUri(mime, buffer);
        const document = buildDocumentPayload(mime, dataUri);
        const body = {
            model: ocrModel,
            document,
            include_image_base64: options.includeImageBase64 ?? false,
        };
        if (options.annotateImages) {
            body.bbox_annotation_format = buildImageAnnotationFormat();
        }
        if (options.pages?.length) {
            body.pages = options.pages;
        }
        const response = await fetch(`${apiBaseUrl}/ocr`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
        });
        if (!response.ok) {
            const errBody = await response.text();
            if (response.status === 401) {
                throw new utils_1.HttpError(502, 'Mistral رفض مفتاح API (401 Unauthorized). تأكد أن MISTRAL_API_KEY صحيح وفعّال من https://console.mistral.ai');
            }
            throw new utils_1.HttpError(response.status >= 500 ? 502 : 400, `Mistral OCR failed (${response.status}): ${errBody.slice(0, 500)}`);
        }
        const payload = (await response.json());
        const pages = normalizePages(payload.pages);
        const text = pages
            .map((p) => p.markdown.trim())
            .filter(Boolean)
            .join('\n\n---\n\n');
        return {
            filename: file.originalname || path.basename(filePath),
            mime_type: mime,
            document_type: isPdfMime(mime) ? 'pdf' : 'image',
            model: payload.model ?? ocrModel,
            page_count: pages.length || 1,
            text,
            pages,
            usage_info: payload.usage_info,
        };
    }
    static mergeOcrResults(results, opts = {}) {
        if (results.length === 0) {
            throw new utils_1.HttpError(400, 'لا توجد ملفات للدمج');
        }
        if (results.length === 1)
            return results[0];
        let pageOffset = 0;
        const mergedPages = [];
        for (let fileIndex = 0; fileIndex < results.length; fileIndex++) {
            const result = results[fileIndex];
            for (const page of result.pages) {
                const mergedIndex = pageOffset++;
                mergedPages.push({
                    ...page,
                    index: mergedIndex,
                    images: page.images.map((image) => ({
                        ...image,
                        page_index: mergedIndex,
                        id: `f${fileIndex}-${image.id}`,
                    })),
                });
            }
        }
        const text = mergedPages
            .map((p) => p.markdown.trim())
            .filter(Boolean)
            .join('\n\n---\n\n');
        const first = results[0];
        return {
            filename: results.map((r) => r.filename).join(', '),
            mime_type: first.mime_type,
            document_type: opts.document_type ?? first.document_type,
            model: first.model,
            page_count: mergedPages.length || 1,
            text,
            pages: mergedPages,
            usage_info: {
                pages_processed: mergedPages.length,
                doc_size_bytes: null,
            },
        };
    }
    static async extractTextFromFiles(files, options = {}) {
        if (files.length === 0) {
            throw new utils_1.HttpError(400, 'يجب رفع ملف واحد على الأقل');
        }
        const results = [];
        for (const file of files) {
            results.push(await this.extractTextFromFile(file, options));
        }
        const documentType = results.every((r) => r.document_type === 'image')
            ? 'image'
            : results[0].document_type;
        return this.mergeOcrResults(results, { document_type: documentType });
    }
}
exports.MistralOcrService = MistralOcrService;
