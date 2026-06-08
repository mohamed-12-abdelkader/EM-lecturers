import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../utils';
import { buildImageAnnotationFormat } from '../prompts/mistralQuestionExtraction.prompt';
import type {
  MistralOcrImage,
  MistralOcrPage,
  MistralOcrResult,
} from '../types/mistralQuestionExtraction';

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

function assertMistralConfigured(): void {
  if (!config.MISTRAL_API_KEY) {
    throw new Error('MISTRAL_API_KEY is required');
  }
}

function normalizeMime(file: Express.Multer.File): string {
  const mime = (file.mimetype || '').toLowerCase();
  if (mime) return mime;
  const ext = path.extname(file.originalname || file.path).toLowerCase();
  if (ext === '.pdf') return 'application/pdf';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  return 'application/octet-stream';
}

function isPdfMime(mime: string): boolean {
  return PDF_MIMES.has(mime);
}

function isSupportedMime(mime: string): boolean {
  return PDF_MIMES.has(mime) || IMAGE_MIMES.has(mime);
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

function parseAnnotation(annotation: unknown): MistralOcrImage['annotation'] {
  if (!annotation) return undefined;
  if (typeof annotation === 'string') {
    try {
      return JSON.parse(annotation) as MistralOcrImage['annotation'];
    } catch {
      return { short_description: annotation };
    }
  }
  if (typeof annotation === 'object') return annotation as MistralOcrImage['annotation'];
  return undefined;
}

function normalizePages(payload: any): MistralOcrPage[] {
  const rawPages = Array.isArray(payload?.pages) ? payload.pages : [];
  return rawPages.map((page: any, pageIndex: number) => {
    const index = Number(page.index ?? page.page_index ?? pageIndex);
    const rawImages = Array.isArray(page.images) ? page.images : [];
    const images: MistralOcrImage[] = rawImages.map((image: any, imageIndex: number) => ({
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

export class MistralOcrService {
  static isSupportedMime(mime: string): boolean {
    return isSupportedMime(mime);
  }

  static async extractTextFromFile(
    file: Express.Multer.File,
    options: { annotateImages?: boolean; includeImageBase64?: boolean } = {},
  ): Promise<MistralOcrResult> {
    assertMistralConfigured();

    const mime = normalizeMime(file);
    if (!isSupportedMime(mime)) {
      throw new Error('Only PDF and image files are supported');
    }

    const buffer = await fs.readFile(file.path);
    const dataUri = buildDataUri(mime, buffer);
    const document = buildDocumentPayload(mime, dataUri);

    const body: Record<string, unknown> = {
      model: config.MISTRAL_OCR_MODEL,
      document,
      include_image_base64: options.includeImageBase64 ?? false,
    };

    if (options.annotateImages) {
      body.bbox_annotation_format = buildImageAnnotationFormat();
    }

    const response = await fetch(`${config.MISTRAL_API_BASE_URL}/ocr`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.MISTRAL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Mistral OCR failed: ${response.status} ${await response.text()}`);
    }

    const payload = (await response.json()) as any;
    const pages = normalizePages(payload);
    const text = pages
      .map((page) => page.markdown)
      .filter(Boolean)
      .join('\n\n');

    return {
      filename: file.originalname || path.basename(file.path),
      mime_type: mime,
      document_type: isPdfMime(mime) ? 'pdf' : 'image',
      model: String(payload.model ?? config.MISTRAL_OCR_MODEL),
      page_count: pages.length || 1,
      text,
      pages,
      usage_info: payload.usage_info,
    };
  }
}
