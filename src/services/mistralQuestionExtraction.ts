import { assertMistralConfigured, getMistralConfig } from '../config/mistral';
import { buildQuestionExtractionPrompt } from '../prompts/mistralQuestionExtraction.prompt';
import {
  MistralQuestionExtractionSchema,
  type MistralExtractedPassage,
  type MistralExtractedQuestion,
  type MistralQuestionImage,
  type MistralQuestionExtractionOptions,
  type MistralQuestionExtractionResult,
} from '../types/mistralQuestionExtraction';
import { HttpError, logger, uploadBufferToCloudinary } from '../utils';
import { expandMultiPartQuestions } from '../utils/expandMultiPartQuestions';
import { MistralOcrService, parsePdfPageRange, type MistralOcrResult } from './mistralOcr';

const ARABIC_OPTION_LABELS = ['أ', 'ب', 'ج', 'د', 'هـ', 'و', 'ز', 'ح', 'ط', 'ي'];
const ENGLISH_OPTION_LABELS = ['a', 'b', 'c', 'd', 'e'];

function defaultOptionLabels(count: number, existing: Array<{ label?: string }>): string[] {
  const raw = existing.map((o) => (o.label ?? '').trim().toLowerCase()).filter(Boolean);
  const englishHits = raw.filter((l) => /^[a-e]$/.test(l)).length;
  const arabicHits = raw.filter((l) => /^[أابجده]$/.test(l)).length;
  const pool =
    englishHits > arabicHits ? ENGLISH_OPTION_LABELS : ARABIC_OPTION_LABELS;
  return Array.from({ length: count }, (_, i) => pool[i] ?? String(i + 1));
}

type InternalQuestionImage = MistralQuestionImage & {
  image_base64?: string;
};

const LABEL_TO_INDEX: Record<string, number> = {
  أ: 0,
  ا: 0,
  a: 0,
  A: 0,
  '1': 0,
  ب: 1,
  b: 1,
  B: 1,
  '2': 1,
  ج: 2,
  c: 2,
  C: 2,
  '3': 2,
  د: 3,
  d: 3,
  D: 3,
  '4': 3,
  هـ: 4,
  ه: 4,
  e: 4,
  E: 4,
  '5': 4,
  و: 5,
  f: 5,
  F: 5,
  '6': 5,
  ز: 6,
  g: 6,
  G: 6,
  '7': 6,
  ح: 7,
  h: 7,
  H: 7,
  '8': 7,
  ط: 8,
  i: 8,
  I: 8,
  '9': 8,
  ي: 9,
  j: 9,
  J: 9,
  '10': 9,
};

function resolveCorrectIndex(
  label: string | null | undefined,
  options: Array<{ label: string }>,
): number | null {
  if (!label?.trim()) return null;

  const normalized = label.trim();
  const byLabel = options.findIndex(
    (o) =>
      o.label.trim() === normalized || o.label.trim().toLowerCase() === normalized.toLowerCase(),
  );
  if (byLabel >= 0) return byLabel;

  const mapped = LABEL_TO_INDEX[normalized];
  if (mapped != null && mapped < options.length) return mapped;
  return null;
}

function normalizeQuestion(q: MistralExtractedQuestion): MistralExtractedQuestion {
  const rawOptions = q.options ?? [];
  const fallbackLabels = defaultOptionLabels(rawOptions.length, rawOptions);
  const options = rawOptions
    .map((opt, i) => ({
      label: opt.label?.trim() || fallbackLabels[i] || String(i + 1),
      text: (opt.text ?? '').trim(),
    }))
    .filter((opt) => opt.label || opt.text);
  const questionImages = (q.question_images ?? [])
    .map((image) => ({
      image_id: image.image_id?.trim(),
      page_index: image.page_index ?? null,
      image_url: image.image_url,
      image_type: image.image_type?.trim(),
      short_description: image.short_description?.trim(),
      summary: image.summary?.trim(),
      educational_relevance: image.educational_relevance?.trim(),
    }))
    .filter((image) => image.image_id) as MistralQuestionImage[];

  let correctAnswerIndex =
    q.correct_answer_index != null && q.correct_answer_index >= 0 ? q.correct_answer_index : null;

  if (correctAnswerIndex != null && correctAnswerIndex >= options.length) {
    correctAnswerIndex = null;
  }

  const correctAnswer =
    q.correct_answer?.trim() ||
    (correctAnswerIndex != null ? (options[correctAnswerIndex]?.label ?? null) : null);

  if (correctAnswerIndex == null && correctAnswer) {
    correctAnswerIndex = resolveCorrectIndex(correctAnswer, options);
  }

  if (correctAnswerIndex != null && !correctAnswer) {
    const label = options[correctAnswerIndex]?.label ?? null;
    return {
      number: q.number,
      source_number: q.source_number?.trim() || String(q.number),
      question_text: (q.question_text ?? '').trim(),
      passage_id: q.passage_id?.trim() || null,
      options,
      question_images: questionImages,
      correct_answer: label,
      correct_answer_index: correctAnswerIndex,
      correct_answer_inferred: q.correct_answer_inferred ?? false,
    };
  }

  return {
    number: q.number,
    source_number: q.source_number?.trim() || String(q.number),
    question_text: (q.question_text ?? '').trim(),
    passage_id: q.passage_id?.trim() || null,
    options,
    question_images: questionImages,
    correct_answer: correctAnswer ?? null,
    correct_answer_index: correctAnswerIndex,
    correct_answer_inferred: q.correct_answer_inferred ?? false,
  };
}

function normalizePassages(passages: MistralExtractedPassage[]): MistralExtractedPassage[] {
  const byId = new Map<string, MistralExtractedPassage>();
  for (const passage of passages) {
    const passageId = passage.passage_id?.trim();
    const content = passage.content?.trim();
    if (!passageId || !content) continue;

    const existing = byId.get(passageId);
    if (!existing || content.length > existing.content.length) {
      byId.set(passageId, {
        passage_id: passageId,
        title: passage.title?.trim() || null,
        content,
      });
    }
  }
  return [...byId.values()];
}

function isSameExtractedQuestion(
  a: MistralExtractedQuestion,
  b: MistralExtractedQuestion,
): boolean {
  const aText = a.question_text.trim();
  const bText = b.question_text.trim();
  if (!aText || !bText) return false;
  return aText === bText || aText.includes(bText) || bText.includes(aText);
}

function mergeExtractedQuestion(
  existing: MistralExtractedQuestion,
  normalized: MistralExtractedQuestion,
) {
  if (normalized.question_text.length > existing.question_text.length) {
    existing.question_text = normalized.question_text;
  }
  if (normalized.source_number && !existing.source_number) {
    existing.source_number = normalized.source_number;
  }
  if (normalized.passage_id && !existing.passage_id) {
    existing.passage_id = normalized.passage_id;
  }
  if (normalized.options.length > existing.options.length) {
    existing.options = normalized.options;
  }
  if (normalized.correct_answer && !existing.correct_answer) {
    existing.correct_answer = normalized.correct_answer;
    existing.correct_answer_index = normalized.correct_answer_index;
    existing.correct_answer_inferred = normalized.correct_answer_inferred;
  }
  const existingImageIds = new Set(existing.question_images.map((image) => image.image_id));
  for (const image of normalized.question_images) {
    if (!existingImageIds.has(image.image_id)) {
      existing.question_images.push(image);
    }
  }
}

function dedupeByNumber(questions: MistralExtractedQuestion[]): MistralExtractedQuestion[] {
  const out: MistralExtractedQuestion[] = [];
  const bySourceNumber = new Map<string, number>();

  for (const q of questions) {
    const normalized = normalizeQuestion(q);
    const key = normalized.source_number || String(normalized.number);
    const existingIndex = bySourceNumber.get(key);

    if (existingIndex == null) {
      bySourceNumber.set(key, out.length);
      out.push(normalized);
      continue;
    }

    const existing = out[existingIndex];
    if (isSameExtractedQuestion(existing, normalized)) {
      mergeExtractedQuestion(existing, normalized);
    } else {
      bySourceNumber.set(`${key}#${out.length}`, out.length);
      out.push(normalized);
    }
  }

  return out.map((question, index) => ({ ...question, number: index + 1 }));
}

function fillMissingPassageIds(
  questions: MistralExtractedQuestion[],
  passages: MistralExtractedPassage[],
): MistralExtractedQuestion[] {
  if (passages.length === 0) return questions;

  if (passages.length === 1) {
    const passageId = passages[0].passage_id;
    return questions.map((question) => ({
      ...question,
      passage_id: question.passage_id ?? passageId,
    }));
  }

  return questions.map((question, index) => {
    if (question.passage_id) return question;

    const previousPassageId = questions
      .slice(0, index)
      .reverse()
      .find((q) => q.passage_id)?.passage_id;
    const nextPassageId = questions.slice(index + 1).find((q) => q.passage_id)?.passage_id;

    if (previousPassageId && previousPassageId === nextPassageId) {
      return { ...question, passage_id: previousPassageId };
    }

    return { ...question, passage_id: previousPassageId ?? nextPassageId ?? null };
  });
}

function extractOcrImages(ocr: MistralOcrResult): InternalQuestionImage[] {
  return ocr.pages.flatMap((page) =>
    page.images.map((image) => ({
      image_id: image.id,
      page_index: image.page_index,
      image_type: image.annotation?.image_type,
      short_description: image.annotation?.short_description,
      summary: image.annotation?.summary,
      educational_relevance: image.annotation?.educational_relevance,
      image_base64: image.image_base64,
    })),
  );
}

function buildDocumentContext(ocr: MistralOcrResult): string {
  return ocr.pages
    .map((page) => {
      const imageContext = page.images
        .map((image) => {
          const annotation = image.annotation;
          return [
            `- image_id: ${image.id}`,
            `page_index: ${image.page_index}`,
            annotation?.image_type ? `type: ${annotation.image_type}` : null,
            annotation?.short_description ? `description: ${annotation.short_description}` : null,
            annotation?.summary ? `summary: ${annotation.summary}` : null,
            annotation?.educational_relevance
              ? `educational_relevance: ${annotation.educational_relevance}`
              : null,
            annotation?.extracted_text ? `image_text: ${annotation.extracted_text}` : null,
          ]
            .filter(Boolean)
            .join('; ');
        })
        .join('\n');

      return [
        `PAGE ${page.index}`,
        page.markdown,
        imageContext ? `IMAGE_CONTEXT:\n${imageContext}` : null,
      ]
        .filter(Boolean)
        .join('\n\n');
    })
    .join('\n\n---\n\n');
}

function attachOcrImages(
  questions: MistralExtractedQuestion[],
  ocrImages: InternalQuestionImage[],
): MistralExtractedQuestion[] {
  const imagesById = new Map(ocrImages.map((image) => [image.image_id, image]));

  return questions.map((question) => ({
    ...question,
    question_images: question.question_images
      .map((ref) => {
        const image = imagesById.get(ref.image_id);
        if (!image) return ref;
        return {
          ...image,
          ...ref,
          image_base64: image.image_base64,
          image_url: ref.image_url || image.image_url,
          image_type: ref.image_type || image.image_type,
          short_description: ref.short_description || image.short_description,
          summary: ref.summary || image.summary,
          educational_relevance: ref.educational_relevance || image.educational_relevance,
        };
      })
      .filter((image) => image.image_id),
  }));
}

function parseDataUri(dataUri: string): { buffer: Buffer; mime: string; ext: string } {
  const match = dataUri.match(/^data:([^;]+);base64,(.+)$/);
  const mime = match?.[1] ?? 'image/jpeg';
  const base64 = match?.[2] ?? dataUri;
  const extFromMime = mime.split('/')[1]?.replace('jpeg', 'jpg') || 'jpg';
  return {
    buffer: Buffer.from(base64, 'base64'),
    mime,
    ext: extFromMime,
  };
}

async function uploadQuestionImagesToCloudinary(
  questions: MistralExtractedQuestion[],
): Promise<{ questions: MistralExtractedQuestion[]; warnings: string[] }> {
  const warnings: string[] = [];
  const uploadCache = new Map<string, Promise<string>>();

  const uploadImage = (image: InternalQuestionImage) => {
    if (image.image_url) return Promise.resolve(image.image_url);
    if (!image.image_base64) return Promise.resolve('');

    const cacheKey = image.image_id;
    const cached = uploadCache.get(cacheKey);
    if (cached) return cached;

    const uploadPromise = (async () => {
      const { buffer, ext } = parseDataUri(image.image_base64 as string);
      const safeId = image.image_id.replace(/[^a-zA-Z0-9.-]/g, '_');
      const result = await uploadBufferToCloudinary(
        buffer,
        `${Date.now()}-${safeId}.${ext}`,
        { resource_type: 'image' },
      );
      return result.secure_url as string;
    })();

    uploadCache.set(cacheKey, uploadPromise);
    return uploadPromise;
  };

  const out = await Promise.all(
    questions.map(async (question) => {
      const uploadedImages: MistralQuestionImage[] = [];
      for (const image of question.question_images as InternalQuestionImage[]) {
        try {
          const imageUrl = await uploadImage(image);
          uploadedImages.push({
            image_id: image.image_id,
            page_index: image.page_index,
            image_type: image.image_type,
            short_description: image.short_description,
            summary: image.summary,
            educational_relevance: image.educational_relevance,
            image_url: imageUrl || image.image_url,
          });
        } catch (error: any) {
          const message = error?.message || 'unknown upload error';
          warnings.push(`تعذر رفع الصورة ${image.image_id}: ${message}`);
          logger.warn(`OCR question image upload failed (${image.image_id}):`, message);
          uploadedImages.push({
            image_id: image.image_id,
            page_index: image.page_index,
            image_type: image.image_type,
            short_description: image.short_description,
            summary: image.summary,
            educational_relevance: image.educational_relevance,
            image_url: image.image_url,
          });
        }
      }

      return {
        ...question,
        question_images: uploadedImages,
      };
    }),
  );

  return { questions: out, warnings };
}

function collectQuestionImages(questions: MistralExtractedQuestion[]): MistralQuestionImage[] {
  const byId = new Map<string, MistralQuestionImage>();
  for (const question of questions) {
    for (const image of question.question_images) {
      if (!byId.has(image.image_id)) {
        byId.set(image.image_id, image);
      }
    }
  }
  return [...byId.values()];
}

async function parseQuestionsWithChat(
  documentText: string,
  filename: string,
  inferCorrectAnswer: boolean,
  chatModelOverride?: string,
): Promise<{
  passages: MistralExtractedPassage[];
  questions: MistralExtractedQuestion[];
  notes?: string;
  chatModel: string;
}> {
  const { apiKey, apiBaseUrl, chatModel: defaultChatModel } = getMistralConfig();
  const chatModel = chatModelOverride?.trim() || defaultChatModel;

  const response = await fetch(`${apiBaseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: chatModel,
      temperature: inferCorrectAnswer ? 0.2 : 0.1,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'أنت محلل امتحانات. أخرج JSON صالح فقط وفق المخطط المطلوب. لا تضف markdown أو شرح.',
        },
        {
          role: 'user',
          content: buildQuestionExtractionPrompt(documentText, filename, {
            inferCorrectAnswer,
          }),
        },
      ],
    }),
  });

  if (!response.ok) {
    const errBody = await response.text();
    if (response.status === 401) {
      throw new HttpError(
        502,
        'Mistral رفض مفتاح API (401). تحقق من MISTRAL_API_KEY في https://console.mistral.ai',
      );
    }
    throw new HttpError(
      response.status >= 500 ? 502 : 400,
      `Mistral Chat failed (${response.status}): ${errBody.slice(0, 500)}`,
    );
  }

  const json = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = json.choices?.[0]?.message?.content;
  if (!content) {
    throw new HttpError(502, 'Mistral Chat returned empty response');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new HttpError(502, 'Mistral Chat returned invalid JSON');
  }

  const validatedResult = MistralQuestionExtractionSchema.safeParse(parsed);
  if (!validatedResult.success) {
    const issueSummary = validatedResult.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .slice(0, 5)
      .join('; ');
    throw new HttpError(502, `Mistral Chat returned invalid question structure: ${issueSummary}`);
  }

  const validated = validatedResult.data;
  const expanded = expandMultiPartQuestions(
    normalizePassages(validated.passages),
    dedupeByNumber(validated.questions),
  );
  return {
    passages: expanded.passages,
    questions: expanded.questions,
    notes: validated.notes,
    chatModel,
  };
}

/** Soft limits so huge PDFs don't blow the chat context window. */
const CHAT_BATCH_MAX_PAGES = 15;
const CHAT_BATCH_MAX_CHARS = 90_000;

function chunkOcrPagesForChat(ocr: MistralOcrResult): MistralOcrResult[] {
  if (ocr.pages.length <= CHAT_BATCH_MAX_PAGES) {
    const chars = buildDocumentContext(ocr).length;
    if (chars <= CHAT_BATCH_MAX_CHARS) return [ocr];
  }

  const batches: MistralOcrResult[] = [];
  let currentPages: MistralOcrResult['pages'] = [];
  let currentChars = 0;

  const flush = () => {
    if (currentPages.length === 0) return;
    const pages = currentPages;
    const text = pages
      .map((p) => p.markdown.trim())
      .filter(Boolean)
      .join('\n\n---\n\n');
    batches.push({
      ...ocr,
      pages,
      text,
      page_count: pages.length,
    });
    currentPages = [];
    currentChars = 0;
  };

  for (const page of ocr.pages) {
    const pageChars = (page.markdown?.length ?? 0) + 64;
    if (
      currentPages.length > 0 &&
      (currentPages.length >= CHAT_BATCH_MAX_PAGES ||
        currentChars + pageChars > CHAT_BATCH_MAX_CHARS)
    ) {
      flush();
    }
    currentPages.push(page);
    currentChars += pageChars;
  }
  flush();

  return batches.length > 0 ? batches : [ocr];
}

function prefixPassageIds(
  passages: MistralExtractedPassage[],
  questions: MistralExtractedQuestion[],
  prefix: string,
): { passages: MistralExtractedPassage[]; questions: MistralExtractedQuestion[] } {
  if (!prefix) return { passages, questions };
  return {
    passages: passages.map((p) => ({
      ...p,
      passage_id: `${prefix}${p.passage_id}`,
    })),
    questions: questions.map((q) => ({
      ...q,
      passage_id: q.passage_id ? `${prefix}${q.passage_id}` : q.passage_id,
    })),
  };
}

async function parseQuestionsWithChatBatched(
  ocr: MistralOcrResult,
  inferCorrectAnswer: boolean,
  chatModelOverride?: string,
): Promise<{
  passages: MistralExtractedPassage[];
  questions: MistralExtractedQuestion[];
  notes?: string;
  chatModel: string;
}> {
  const batches = chunkOcrPagesForChat(ocr);
  if (batches.length === 1) {
    return parseQuestionsWithChat(
      buildDocumentContext(batches[0]),
      ocr.filename,
      inferCorrectAnswer,
      chatModelOverride,
    );
  }

  const allPassages: MistralExtractedPassage[] = [];
  const allQuestions: MistralExtractedQuestion[] = [];
  const notesParts: string[] = [];
  let chatModel = '';

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const context = buildDocumentContext(batch);
    if (!context.trim()) continue;

    const result = await parseQuestionsWithChat(
      context,
      `${ocr.filename} [pages-batch ${i + 1}/${batches.length}]`,
      inferCorrectAnswer,
      chatModelOverride,
    );
    chatModel = result.chatModel;
    const remapped = prefixPassageIds(result.passages, result.questions, `b${i + 1}_`);
    allPassages.push(...remapped.passages);
    allQuestions.push(...remapped.questions);
    if (result.notes?.trim()) notesParts.push(result.notes.trim());
  }

  if (allQuestions.length === 0 && allPassages.length === 0) {
    throw new HttpError(400, 'لم يُستخرج أي أسئلة من الملف');
  }

  const expanded = expandMultiPartQuestions(
    normalizePassages(allPassages),
    dedupeByNumber(allQuestions),
  );

  return {
    passages: expanded.passages,
    questions: expanded.questions,
    notes: notesParts.length ? notesParts.join('\n') : undefined,
    chatModel: chatModel || getMistralConfig().chatModel,
  };
}

export class MistralQuestionExtractionService {
  /**
   * Pipeline: Mistral OCR (PDF/صورة → markdown) → Mistral Chat (markdown → أسئلة JSON)
   */
  static async extractQuestionsFromFile(
    file: Express.Multer.File,
    options: MistralQuestionExtractionOptions = {},
  ): Promise<MistralQuestionExtractionResult> {
    return this.extractQuestionsFromFiles([file], options);
  }

  static async extractQuestionsFromFiles(
    files: Express.Multer.File[],
    options: MistralQuestionExtractionOptions = {},
  ): Promise<MistralQuestionExtractionResult> {
    assertMistralConfigured();

    if (files.length === 0) {
      throw new HttpError(400, 'يجب رفع ملف واحد على الأقل');
    }

    const inferCorrectAnswer = options.inferCorrectAnswer ?? false;
    const includeQuestionImages = options.includeQuestionImages ?? true;
    const requestedChatModel = options.chatModel?.trim();
    const ocrModel = options.ocrModel?.trim();

    const pdfFiles = files.filter((f) => {
      const mime = MistralOcrService.resolveSupportedMime(f);
      return mime.includes('pdf');
    });
    const imageFiles = files.filter((f) => {
      const mime = MistralOcrService.resolveSupportedMime(f);
      return !mime.includes('pdf');
    });

    if (pdfFiles.length && imageFiles.length) {
      throw new HttpError(400, 'لا يمكن رفع PDF وصور معاً في طلب واحد');
    }
    if (pdfFiles.length > 1) {
      throw new HttpError(400, 'ارفع ملف PDF واحد فقط');
    }

    const pages =
      pdfFiles.length > 0
        ? parsePdfPageRange(options.startPage, options.endPage)
        : undefined;

    if (pages && imageFiles.length > 0) {
      throw new HttpError(400, 'نطاق الصفحات متاح لملفات PDF فقط');
    }

    const ocrOptions = {
      annotateImages: includeQuestionImages,
      includeImageBase64: includeQuestionImages,
      ocrModel,
      pages,
    };

    const ocr =
      files.length === 1
        ? await MistralOcrService.extractTextFromFile(files[0], ocrOptions)
        : await MistralOcrService.extractTextFromFiles(files, ocrOptions);

    return this.extractQuestionsFromOcr(ocr, {
      inferCorrectAnswer,
      includeQuestionImages,
      requestedChatModel,
      sourceFiles: files.map((f) => ({
        filename: f.originalname || f.filename,
        mime_type: MistralOcrService.resolveSupportedMime(f),
      })),
      pageRange:
        pages && pages.length > 0
          ? {
              start_page: pages[0] + 1,
              end_page: pages[pages.length - 1] + 1,
              pages_processed: pages.length,
            }
          : undefined,
    });
  }

  private static async extractQuestionsFromOcr(
    ocr: MistralOcrResult,
    opts: {
      inferCorrectAnswer: boolean;
      includeQuestionImages: boolean;
      requestedChatModel?: string;
      sourceFiles?: Array<{ filename: string; mime_type: string }>;
      pageRange?: MistralQuestionExtractionResult['page_range'];
    },
  ): Promise<MistralQuestionExtractionResult> {
    const documentContext = buildDocumentContext(ocr);
    if (!documentContext.trim()) {
      throw new HttpError(400, 'لم يُستخرج أي نص من الملف — تأكد أن الصورة/PDF واضحة');
    }

    const extractedImages = extractOcrImages(ocr);
    const { passages, questions, notes, chatModel } = await parseQuestionsWithChatBatched(
      ocr,
      opts.inferCorrectAnswer,
      opts.requestedChatModel,
    );
    const questionsWithPassages = fillMissingPassageIds(questions, passages);
    const attachedQuestions = opts.includeQuestionImages
      ? attachOcrImages(questionsWithPassages, extractedImages)
      : questionsWithPassages.map((q) => ({ ...q, question_images: [] }));

    let questionsWithImages = attachedQuestions;
    let imageUploadWarnings: string[] = [];
    if (opts.includeQuestionImages) {
      const uploadResult = await uploadQuestionImagesToCloudinary(attachedQuestions);
      questionsWithImages = uploadResult.questions;
      imageUploadWarnings = uploadResult.warnings;
    }

    return {
      filename: ocr.filename,
      mime_type: ocr.mime_type,
      document_type: ocr.document_type,
      page_count: ocr.page_count,
      question_count: questions.length,
      ocr_model: ocr.model,
      chat_model: chatModel,
      infer_correct_answer: opts.inferCorrectAnswer,
      passages,
      extracted_images: opts.includeQuestionImages ? collectQuestionImages(questionsWithImages) : [],
      questions: questionsWithImages,
      notes,
      ...(opts.sourceFiles && opts.sourceFiles.length > 1 && { source_files: opts.sourceFiles }),
      ...(opts.pageRange && { page_range: opts.pageRange }),
      ...(imageUploadWarnings.length > 0 && { image_upload_warnings: imageUploadWarnings }),
    };
  }
}
