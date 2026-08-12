import * as fs from 'node:fs';
import * as path from 'node:path';
import { assertMistralConfigured, getMistralConfig } from '../config/mistral';
import { HttpError } from '../utils';

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

const EXT_MIME: Record<string, string> = {
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

export type MistralOcrImageAnnotation = {
  image_type?: string;
  short_description?: string;
  summary?: string;
  educational_relevance?: string;
  contains_text?: boolean;
  extracted_text?: string | null;
};

export type MistralOcrImage = {
  id: string;
  page_index: number;
  top_left_x?: number;
  top_left_y?: number;
  bottom_right_x?: number;
  bottom_right_y?: number;
  image_base64?: string;
  annotation?: MistralOcrImageAnnotation | null;
};

export type MistralOcrPage = {
  index: number;
  markdown: string;
  images: MistralOcrImage[];
  dimensions?: {
    dpi?: number;
    height?: number;
    width?: number;
  } | null;
};

export type MistralOcrResult = {
  filename: string;
  mime_type: string;
  document_type: 'pdf' | 'image';
  model: string;
  page_count: number;
  text: string;
  pages: MistralOcrPage[];
  usage_info?: {
    pages_processed?: number;
    doc_size_bytes?: number | null;
  };
};

type MistralOcrApiResponse = {
  model?: string;
  pages?: Array<{
    index?: number;
    markdown?: string;
    images?: Array<{
      id?: string;
      top_left_x?: number;
      top_left_y?: number;
      bottom_right_x?: number;
      bottom_right_y?: number;
      image_base64?: string;
      annotation?: unknown;
      image_annotation?: unknown;
      bbox_annotation?: unknown;
    }>;
    dimensions?: MistralOcrPage['dimensions'];
  }>;
  usage_info?: MistralOcrResult['usage_info'];
};

type MistralOcrOptions = {
  includeImageBase64?: boolean;
  annotateImages?: boolean;
  ocrModel?: string;
  /** Mistral OCR page indices (0-based). */
  pages?: number[];
};

/** Build 0-based Mistral page indices from 1-based inclusive user range. */
export function parsePdfPageRange(
  startPage?: unknown,
  endPage?: unknown,
): number[] | undefined {
  const startRaw = startPage != null && startPage !== '' ? Number(startPage) : undefined;
  const endRaw = endPage != null && endPage !== '' ? Number(endPage) : undefined;

  if (startRaw == null && endRaw == null) return undefined;

  const start = Math.max(1, Number.isFinite(startRaw) ? Math.trunc(startRaw!) : 1);
  const end = Math.max(
    start,
    Number.isFinite(endRaw) ? Math.trunc(endRaw!) : start,
  );

  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 1 || end < 1) {
    throw new HttpError(400, 'أرقام الصفحات غير صحيحة');
  }

  // Allow any size range — large ranges are auto-batched in extractTextFromFile
  return Array.from({ length: end - start + 1 }, (_, i) => start - 1 + i);
}

function chunkPages(pages: number[], chunkSize: number): number[][] {
  const chunks: number[][] = [];
  for (let i = 0; i < pages.length; i += chunkSize) {
    chunks.push(pages.slice(i, i + chunkSize));
  }
  return chunks;
}

async function getPdfPageCount(buffer: Buffer): Promise<number> {
  try {
    const { PDFDocument } = await import('pdf-lib');
    const doc = await PDFDocument.load(buffer, { ignoreEncryption: true });
    const n = doc.getPageCount();
    return n > 0 ? n : 1;
  } catch {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pdfParse = require('pdf-parse') as (
        data: Buffer,
      ) => Promise<{ numpages?: number }>;
      const parsed = await pdfParse(buffer);
      const n = Number(parsed?.numpages ?? 0);
      return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 1;
    } catch {
      return 1;
    }
  }
}

/** Slice a PDF buffer to the given 0-based page indices (for large-file OCR batches). */
async function slicePdfBuffer(buffer: Buffer, pageIndices0: number[]): Promise<Buffer> {
  const { PDFDocument } = await import('pdf-lib');
  const src = await PDFDocument.load(buffer, { ignoreEncryption: true });
  const total = src.getPageCount();
  const valid = pageIndices0.filter((i) => i >= 0 && i < total);
  if (valid.length === 0) {
    throw new HttpError(400, 'نطاق الصفحات خارج حدود الملف');
  }
  const out = await PDFDocument.create();
  const copied = await out.copyPages(src, valid);
  for (const page of copied) out.addPage(page);
  return Buffer.from(await out.save());
}

function resolveMimeType(file: Express.Multer.File): string {
  const fromMulter = (file.mimetype || '').toLowerCase();
  if (fromMulter && fromMulter !== 'application/octet-stream') {
    return fromMulter;
  }
  const ext = path.extname(file.originalname || file.path || '').toLowerCase();
  return EXT_MIME[ext] ?? fromMulter;
}

function isPdfMime(mime: string): boolean {
  return PDF_MIMES.has(mime) || mime.endsWith('/pdf');
}

function isImageMime(mime: string): boolean {
  return IMAGE_MIMES.has(mime) || mime.startsWith('image/');
}

function buildDataUri(mime: string, buffer: Buffer): string {
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

function buildDocumentPayload(mime: string, dataUri: string): Record<string, string> {
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
            description:
              'Type of visual: question_figure (stem diagram/graph in the question), choice_option (answer choice A/B/C/D image), diagram, chart, graph, table, formula, map, other. Use choice_option for option thumbnails; use question_figure/chart/graph for the main figure referenced by the question text.',
          },
          short_description: {
            type: 'string',
            description: 'Short Arabic description of the visual content.',
          },
          summary: {
            type: 'string',
            description:
              'Detailed Arabic summary explaining what the image shows and how it may be used in a question.',
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

function normalizeAnnotation(raw: unknown): MistralOcrImageAnnotation | null {
  if (!raw) return null;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as MistralOcrImageAnnotation;
    } catch {
      return { summary: raw };
    }
  }
  if (typeof raw === 'object') return raw as MistralOcrImageAnnotation;
  return null;
}

function normalizePages(rawPages: MistralOcrApiResponse['pages']): MistralOcrPage[] {
  return (rawPages ?? []).map((page, i) => ({
    index: page.index ?? i,
    markdown: page.markdown ?? '',
    images: (page.images ?? [])
      .filter((image) => image.id)
      .map((image) => ({
        id: image.id as string,
        page_index: page.index ?? i,
        top_left_x: image.top_left_x,
        top_left_y: image.top_left_y,
        bottom_right_x: image.bottom_right_x,
        bottom_right_y: image.bottom_right_y,
        image_base64: image.image_base64,
        annotation: normalizeAnnotation(
          image.annotation ?? image.image_annotation ?? image.bbox_annotation,
        ),
      })),
    dimensions: page.dimensions ?? null,
  }));
}

function isFullDocumentSingleBatch(
  targetPages: number[],
  batch: number[],
  maxPages: number,
): boolean {
  return (
    batch.length === targetPages.length &&
    targetPages.length <= maxPages &&
    targetPages.every((p, i) => p === i)
  );
}

export class MistralOcrService {
  static isSupportedMime(mime: string): boolean {
    const normalized = (mime || '').toLowerCase();
    return isPdfMime(normalized) || isImageMime(normalized);
  }

  static resolveSupportedMime(file: Express.Multer.File): string {
    const mime = resolveMimeType(file);
    if (isPdfMime(mime) || isImageMime(mime)) {
      return mime;
    }
    throw new HttpError(
      400,
      'نوع الملف غير مدعوم. ارفع PDF أو صورة (png, jpg, jpeg, webp, gif, avif)',
    );
  }

  private static async callMistralOcr(
    mime: string,
    buffer: Buffer,
    options: MistralOcrOptions,
    ocrModel: string,
  ): Promise<{
    pages: MistralOcrPage[];
    model: string;
    usage_info: MistralOcrApiResponse['usage_info'];
  }> {
    const { apiKey, apiBaseUrl } = getMistralConfig();
    const dataUri = buildDataUri(mime, buffer);
    const document = buildDocumentPayload(mime, dataUri);
    const body: Record<string, unknown> = {
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
        throw new HttpError(
          502,
          'Mistral رفض مفتاح API (401 Unauthorized). تأكد أن MISTRAL_API_KEY صحيح وفعّال من https://console.mistral.ai',
        );
      }
      throw new HttpError(
        response.status >= 500 ? 502 : 400,
        `Mistral OCR failed (${response.status}): ${errBody.slice(0, 500)}`,
      );
    }

    const payload = (await response.json()) as MistralOcrApiResponse;
    return {
      pages: normalizePages(payload.pages),
      model: payload.model ?? ocrModel,
      usage_info: payload.usage_info,
    };
  }

  static async extractTextFromFile(
    file: Express.Multer.File,
    options: MistralOcrOptions = {},
  ): Promise<MistralOcrResult> {
    assertMistralConfigured();

    const mime = this.resolveSupportedMime(file);
    const filePath = file.path;
    if (!filePath || !fs.existsSync(filePath)) {
      throw new HttpError(400, 'ملف مرفوع غير موجود');
    }

    const buffer = fs.readFileSync(filePath);
    if (buffer.length === 0) {
      throw new HttpError(400, 'الملف فارغ');
    }

    const { ocrModel: defaultOcrModel, maxPagesPerOcrRequest } = getMistralConfig();
    const ocrModel = options.ocrModel?.trim() || defaultOcrModel;
    const filename = file.originalname || path.basename(filePath);

    if (!isPdfMime(mime)) {
      const result = await this.callMistralOcr(mime, buffer, options, ocrModel);
      const text = result.pages
        .map((p) => p.markdown.trim())
        .filter(Boolean)
        .join('\n\n---\n\n');
      return {
        filename,
        mime_type: mime,
        document_type: 'image',
        model: result.model,
        page_count: result.pages.length || 1,
        text,
        pages: result.pages,
        usage_info: result.usage_info,
      };
    }

    let targetPages = options.pages;
    if (!targetPages?.length) {
      const pageCount = await getPdfPageCount(buffer);
      targetPages = Array.from({ length: pageCount }, (_, i) => i);
    }

    const batches = chunkPages(targetPages, maxPagesPerOcrRequest);
    const mergedPages: MistralOcrPage[] = [];
    let lastModel = ocrModel;
    let lastUsage: MistralOcrApiResponse['usage_info'];

    for (const batch of batches) {
      const sliceBuffer = isFullDocumentSingleBatch(targetPages, batch, maxPagesPerOcrRequest)
        ? buffer
        : await slicePdfBuffer(buffer, batch);

      const result = await this.callMistralOcr(
        mime,
        sliceBuffer,
        { ...options, pages: undefined },
        ocrModel,
      );
      lastModel = result.model;
      lastUsage = result.usage_info;

      for (let i = 0; i < result.pages.length; i++) {
        const absoluteIndex = batch[Math.min(i, batch.length - 1)] ?? batch[0];
        const page = result.pages[i];
        mergedPages.push({
          ...page,
          index: absoluteIndex,
          images: page.images.map((image) => ({
            ...image,
            page_index: absoluteIndex,
            id: image.id.includes(`p${absoluteIndex}-`)
              ? image.id
              : `p${absoluteIndex}-${image.id}`,
          })),
        });
      }
    }

    mergedPages.sort((a, b) => a.index - b.index);
    const text = mergedPages
      .map((p) => p.markdown.trim())
      .filter(Boolean)
      .join('\n\n---\n\n');

    return {
      filename,
      mime_type: mime,
      document_type: 'pdf',
      model: lastModel,
      page_count: mergedPages.length || 1,
      text,
      pages: mergedPages,
      usage_info:
        lastUsage ?? {
          pages_processed: mergedPages.length,
          doc_size_bytes: buffer.length,
        },
    };
  }

  static mergeOcrResults(
    results: MistralOcrResult[],
    opts: { document_type?: 'pdf' | 'image' } = {},
  ): MistralOcrResult {
    if (results.length === 0) {
      throw new HttpError(400, 'لا توجد ملفات للدمج');
    }
    if (results.length === 1) return results[0];

    let pageOffset = 0;
    const mergedPages: MistralOcrPage[] = [];

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

  static async extractTextFromFiles(
    files: Express.Multer.File[],
    options: MistralOcrOptions = {},
  ): Promise<MistralOcrResult> {
    if (files.length === 0) {
      throw new HttpError(400, 'يجب رفع ملف واحد على الأقل');
    }

    const results: MistralOcrResult[] = [];
    for (const file of files) {
      results.push(await this.extractTextFromFile(file, options));
    }

    const documentType = results.every((r) => r.document_type === 'image')
      ? 'image'
      : results[0].document_type;

    return this.mergeOcrResults(results, { document_type: documentType });
  }
}
