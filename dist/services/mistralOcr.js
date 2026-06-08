"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MistralOcrService = void 0;
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const utils_1 = require("../utils");
const mistralQuestionExtraction_prompt_1 = require("../prompts/mistralQuestionExtraction.prompt");
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
function assertMistralConfigured() {
    if (!utils_1.config.MISTRAL_API_KEY) {
        throw new Error('MISTRAL_API_KEY is required');
    }
}
function normalizeMime(file) {
    const mime = (file.mimetype || '').toLowerCase();
    if (mime)
        return mime;
    const ext = node_path_1.default.extname(file.originalname || file.path).toLowerCase();
    if (ext === '.pdf')
        return 'application/pdf';
    if (ext === '.png')
        return 'image/png';
    if (ext === '.jpg' || ext === '.jpeg')
        return 'image/jpeg';
    if (ext === '.webp')
        return 'image/webp';
    return 'application/octet-stream';
}
function isPdfMime(mime) {
    return PDF_MIMES.has(mime);
}
function isSupportedMime(mime) {
    return PDF_MIMES.has(mime) || IMAGE_MIMES.has(mime);
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
function parseAnnotation(annotation) {
    if (!annotation)
        return undefined;
    if (typeof annotation === 'string') {
        try {
            return JSON.parse(annotation);
        }
        catch {
            return { short_description: annotation };
        }
    }
    if (typeof annotation === 'object')
        return annotation;
    return undefined;
}
function normalizePages(payload) {
    const rawPages = Array.isArray(payload?.pages) ? payload.pages : [];
    return rawPages.map((page, pageIndex) => {
        const index = Number(page.index ?? page.page_index ?? pageIndex);
        const rawImages = Array.isArray(page.images) ? page.images : [];
        const images = rawImages.map((image, imageIndex) => ({
            id: String(image.id ?? image.image_id ?? `page-${index}-image-${imageIndex}`),
            page_index: index,
            image_base64: image.image_base64 ?? image.base64 ?? undefined,
            annotation: parseAnnotation(image.image_annotation ?? image.annotation),
        }));
        return {
            index,
            markdown: String(page.markdown ?? page.text ?? ''),
            images,
        };
    });
}
class MistralOcrService {
    static isSupportedMime(mime) {
        return isSupportedMime(mime);
    }
    static async extractTextFromFile(file, options = {}) {
        assertMistralConfigured();
        const mime = normalizeMime(file);
        if (!isSupportedMime(mime)) {
            throw new Error('Only PDF and image files are supported');
        }
        const buffer = await promises_1.default.readFile(file.path);
        const dataUri = buildDataUri(mime, buffer);
        const document = buildDocumentPayload(mime, dataUri);
        const body = {
            model: utils_1.config.MISTRAL_OCR_MODEL,
            document,
            include_image_base64: options.includeImageBase64 ?? false,
        };
        if (options.annotateImages) {
            body.bbox_annotation_format = (0, mistralQuestionExtraction_prompt_1.buildImageAnnotationFormat)();
        }
        const response = await fetch(`${utils_1.config.MISTRAL_API_BASE_URL}/ocr`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${utils_1.config.MISTRAL_API_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
        });
        if (!response.ok) {
            throw new Error(`Mistral OCR failed: ${response.status} ${await response.text()}`);
        }
        const payload = (await response.json());
        const pages = normalizePages(payload);
        const text = pages
            .map((page) => page.markdown)
            .filter(Boolean)
            .join('\n\n');
        return {
            filename: file.originalname || node_path_1.default.basename(file.path),
            mime_type: mime,
            document_type: isPdfMime(mime) ? 'pdf' : 'image',
            model: String(payload.model ?? utils_1.config.MISTRAL_OCR_MODEL),
            page_count: pages.length || 1,
            text,
            pages,
            usage_info: payload.usage_info,
        };
    }
}
exports.MistralOcrService = MistralOcrService;
