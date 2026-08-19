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
import { expandMultiPartQuestions, foldSingletonPassages } from '../utils/expandMultiPartQuestions';
import { MistralOcrService, parsePdfPageRange, type MistralOcrResult } from './mistralOcr';
import * as fs from 'node:fs';

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

function sortMcqOptions<T extends { label: string }>(options: T[]): T[] {
  return [...options].sort((a, b) => {
    const ia = LABEL_TO_INDEX[a.label.trim()] ?? LABEL_TO_INDEX[a.label.trim().toLowerCase()] ?? 99;
    const ib = LABEL_TO_INDEX[b.label.trim()] ?? LABEL_TO_INDEX[b.label.trim().toLowerCase()] ?? 99;
    return ia - ib;
  });
}

function normalizeOptionLabel(raw: string): string {
  const ch = raw.trim();
  if (ch === 'ا' || ch === 'إ' || ch === 'آ') return 'أ';
  if (ch === 'ه') return 'هـ';
  return ch;
}

function clampConfidence(value: unknown): number | undefined {
  if (typeof value !== 'number' || Number.isNaN(value)) return undefined;
  return Math.min(1, Math.max(0, value));
}

/** يبقي وسوم التنسيق المهمة (خصوصاً <u> لما تحته خط) ويزيل الباقي. */
function sanitizeQuestionFormatting(raw: string): string {
  let text = (raw ?? '').trim();
  if (!text) return '';

  text = text.replace(/<ins\b[^>]*>/gi, '<u>').replace(/<\/ins>/gi, '</u>');
  text = text.replace(/__([^_\n]{1,120})__/g, '<u>$1</u>');
  text = text.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g, (full, name: string) => {
    const tag = name.toLowerCase();
    if (!['u', 'b', 'i', 'em', 'strong', 'sup', 'sub'].includes(tag)) return '';
    return full.startsWith('</') ? `</${tag}>` : `<${tag}>`;
  });
  return text.trim();
}

function hasUnderlineMarkup(text: string): boolean {
  return /<u[\s>]/i.test(text);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripUnderlineTags(text: string): string {
  return text.replace(/<\/?u>/gi, '');
}

function extractUnderlinedPhrases(text: string): string[] {
  const phrases: string[] = [];
  const re = /<u>(.*?)<\/u>/gis;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const phrase = (match[1] || '').replace(/\s+/g, ' ').trim();
    if (phrase) phrases.push(phrase);
  }
  return phrases;
}

/** يعيد وضع <u> على العبارات المحددة حرفياً بعد إزالة أي تسطير خاطئ. */
function applyExactUnderlines(text: string, phrases: string[]): string {
  const cleanPhrases = phrases.map((p) => stripUnderlineTags(p).replace(/\s+/g, ' ').trim()).filter(Boolean);
  if (cleanPhrases.length === 0) return text;

  let out = stripUnderlineTags(text);
  for (const phrase of cleanPhrases) {
    const re = new RegExp(escapeRegExp(phrase).replace(/\s+/g, '\\s+'), '');
    if (!re.test(out)) continue;
    out = out.replace(re, (matched) => `<u>${matched}</u>`);
  }
  return out;
}

function looksLikePoetry(intro: string, stimulus: string): boolean {
  const blob = `${intro}\n${stimulus}`;
  return /شاعر|بيت|شعر|قصيد|قائل|ناجي|المتنبي|عنترة/u.test(blob);
}

/** سطر فارغ بين أبيات الشعر؛ لا يدمج الأبيات في فقرة واحدة. */
function formatPoetrySpacing(text: string): string {
  let t = text.replace(/\r\n/g, '\n').trim();
  if (!t) return t;
  const lines = t
    .split(/\n+/)
    .map((line) => line.replace(/[ \t]{2,}/g, '    ').trim())
    .filter(Boolean);
  if (lines.length >= 2) return lines.join('\n\n');
  return t;
}

function emptyToNull(value: string | null | undefined): string | null {
  const text = (value ?? '').trim();
  return text || null;
}

type DisplayRole = 'intro' | 'stimulus' | 'prompt';

function buildDisplayBlocks(q: {
  display_blocks?: Array<{ role: DisplayRole; text: string }>;
  intro_text?: string | null;
  stimulus_text?: string | null;
  prompt_text?: string | null;
  question_text?: string;
}): Array<{ role: DisplayRole; text: string }> {
  const fromModel = (q.display_blocks ?? [])
    .map((block) => ({
      role: block.role,
      text: sanitizeQuestionFormatting(block.text),
    }))
    .filter((block) => block.text);

  if (fromModel.length > 0) return fromModel;

  const blocks: Array<{ role: DisplayRole; text: string }> = [];
  const intro = sanitizeQuestionFormatting(q.intro_text ?? '');
  const stimulus = sanitizeQuestionFormatting(q.stimulus_text ?? '');
  const prompt = sanitizeQuestionFormatting(q.prompt_text ?? '');
  if (intro) blocks.push({ role: 'intro', text: intro });
  if (stimulus) blocks.push({ role: 'stimulus', text: stimulus });
  if (prompt) blocks.push({ role: 'prompt', text: prompt });
  if (blocks.length > 0) return blocks;

  const full = sanitizeQuestionFormatting(q.question_text ?? '');
  return full ? [{ role: 'prompt', text: full }] : [];
}

function composeQuestionText(blocks: Array<{ text: string }>): string {
  return blocks
    .map((block) => block.text.trim())
    .filter(Boolean)
    .join('\n\n');
}

function normalizeQuestionLayout(q: MistralExtractedQuestion): {
  intro_text: string | null;
  stimulus_text: string | null;
  prompt_text: string | null;
  display_blocks: Array<{ role: DisplayRole; text: string }>;
  underlined_phrases: string[];
  question_text: string;
} {
  let blocks = buildDisplayBlocks(q);
  const introHint = blocks.find((b) => b.role === 'intro')?.text ?? q.intro_text ?? '';
  const poetry = looksLikePoetry(introHint, blocks.find((b) => b.role === 'stimulus')?.text ?? '');

  blocks = blocks.map((block) => {
    let text = block.text;
    if (block.role === 'stimulus') {
      const lineCount = text.split(/\n+/).filter((line) => line.trim()).length;
      if (lineCount >= 2 || poetry) text = formatPoetrySpacing(text);
    }
    return { ...block, text };
  });

  const phrasesFromModel = (q.underlined_phrases ?? [])
    .map((p) => stripUnderlineTags(p).replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const phrasesFromMarkup = blocks.flatMap((block) => extractUnderlinedPhrases(block.text));
  const underlinedPhrases = phrasesFromModel.length > 0 ? phrasesFromModel : phrasesFromMarkup;

  if (underlinedPhrases.length > 0) {
    const hasStimulus = blocks.some((block) => block.role === 'stimulus');
    blocks = blocks.map((block) => {
      if (block.role === 'prompt' && hasStimulus) {
        return { ...block, text: stripUnderlineTags(block.text) };
      }
      return { ...block, text: applyExactUnderlines(block.text, underlinedPhrases) };
    });
  }

  const intro_text = emptyToNull(blocks.find((b) => b.role === 'intro')?.text);
  const stimulus_text = emptyToNull(blocks.find((b) => b.role === 'stimulus')?.text);
  const prompt_text = emptyToNull(blocks.find((b) => b.role === 'prompt')?.text);
  const question_text = composeQuestionText(blocks) || sanitizeQuestionFormatting(q.question_text ?? '');

  return {
    intro_text,
    stimulus_text,
    prompt_text,
    display_blocks: blocks,
    underlined_phrases: underlinedPhrases,
    question_text,
  };
}

function normalizeQuestion(q: MistralExtractedQuestion): MistralExtractedQuestion {
  const rawOptions = q.options ?? [];
  const fallbackLabels = defaultOptionLabels(rawOptions.length, rawOptions);
  const options = sortMcqOptions(
    rawOptions
      .map((opt, i) => ({
        label: opt.label?.trim() || fallbackLabels[i] || String(i + 1),
        text: sanitizeQuestionFormatting(opt.text ?? ''),
        image_id: opt.image_id?.trim() || undefined,
      }))
      .filter((opt) => opt.label || opt.text || opt.image_id),
  );
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

  const layout = normalizeQuestionLayout(q);

  if (correctAnswerIndex != null && !correctAnswer) {
    const label = options[correctAnswerIndex]?.label ?? null;
    return {
      number: q.number,
      source_number: q.source_number?.trim() || String(q.number),
      question_text: layout.question_text,
      intro_text: layout.intro_text,
      stimulus_text: layout.stimulus_text,
      prompt_text: layout.prompt_text,
      display_blocks: layout.display_blocks,
      underlined_phrases: layout.underlined_phrases,
      passage_id: q.passage_id?.trim() || null,
      options,
      question_images: questionImages,
      correct_answer: label,
      correct_answer_index: correctAnswerIndex,
      correct_answer_inferred: q.correct_answer_inferred ?? false,
      confidence: clampConfidence(q.confidence),
    };
  }

  return {
    number: q.number,
    source_number: q.source_number?.trim() || String(q.number),
    question_text: layout.question_text,
    intro_text: layout.intro_text,
    stimulus_text: layout.stimulus_text,
    prompt_text: layout.prompt_text,
    display_blocks: layout.display_blocks,
    underlined_phrases: layout.underlined_phrases,
    passage_id: q.passage_id?.trim() || null,
    options,
    question_images: questionImages,
    correct_answer: correctAnswer ?? null,
    correct_answer_index: correctAnswerIndex,
    correct_answer_inferred: q.correct_answer_inferred ?? false,
    confidence: clampConfidence(q.confidence),
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
  if (normalized.display_blocks.length > existing.display_blocks.length) {
    existing.display_blocks = normalized.display_blocks;
    existing.intro_text = normalized.intro_text;
    existing.stimulus_text = normalized.stimulus_text;
    existing.prompt_text = normalized.prompt_text;
  }
  if (normalized.underlined_phrases.length > existing.underlined_phrases.length) {
    existing.underlined_phrases = normalized.underlined_phrases;
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

  return questions.map((question) => {
    const refs = [...(question.question_images ?? [])];
    const seen = new Set(refs.map((r) => r.image_id).filter(Boolean));

    // أضف صور الاختيارات المشار إليها بـ options[].image_id حتى تُرفع وتُربط
    for (const opt of question.options ?? []) {
      const imageId = opt.image_id?.trim();
      if (!imageId || seen.has(imageId)) continue;
      const ocrImage = imagesById.get(imageId);
      refs.push({
        image_id: imageId,
        page_index: ocrImage?.page_index ?? null,
        image_type: ocrImage?.image_type || 'choice_option',
        short_description: ocrImage?.short_description,
        summary: ocrImage?.summary,
        educational_relevance: ocrImage?.educational_relevance,
      });
      seen.add(imageId);
    }

    return {
      ...question,
      question_images: refs
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
    };
  });
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

function extractArabicMcqOptionsFromSlice(slice: string): Array<{ label: string; text: string }> {
  const source = slice
    .replace(/[Ⓐⓐ🄐]/g, 'أ) ')
    .replace(/[Ⓑⓑ🄑]/g, 'ب) ')
    .replace(/[Ⓒⓒ🄒]/g, 'ج) ')
    .replace(/[Ⓓⓓ🄓]/g, 'د) ');

  const labelRe = /(?:^|[\s\n])(?:\(|\[)?([أابجدهـ])(?:\)|\]|[)）.\-:])\s*/gu;
  const marks: Array<{ label: string; matchStart: number; textStart: number }> = [];
  let match: RegExpExecArray | null;
  while ((match = labelRe.exec(source)) !== null) {
    marks.push({
      label: normalizeOptionLabel(match[1]),
      matchStart: match.index,
      textStart: match.index + match[0].length,
    });
  }

  const found = new Map<string, string>();
  for (let i = 0; i < marks.length; i++) {
    const end = i + 1 < marks.length ? marks[i + 1].matchStart : source.length;
    let text = source.slice(marks[i].textStart, end);
    text = text.split(/\n\s*\d{1,3}\s*[)）．.\-:]/)[0];
    text = text.replace(/\s+/g, ' ').trim();
    if (!text) continue;
    if (text.length > 400) text = text.slice(0, 400).trim();
    if (!found.has(marks[i].label)) found.set(marks[i].label, text);
  }

  const order = ['أ', 'ب', 'ج', 'د', 'هـ'];
  return order
    .filter((label) => found.has(label))
    .map((label) => ({ label, text: found.get(label)! }));
}

function findQuestionSlice(
  documentText: string,
  question: MistralExtractedQuestion,
  nextQuestion?: MistralExtractedQuestion,
): string | null {
  const sourceNo = (question.source_number || String(question.number)).trim();
  const escaped = sourceNo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const startRe = new RegExp(
    `(?:^|\\n)\\s*(?:#{1,3}\\s*)?(?:\\*\\*)?(?<!\\d)${escaped}(?!\\d)(?:\\*\\*)?\\s*[)）．.\\-:]*`,
    'm',
  );
  const startMatch = documentText.match(startRe);
  let start = startMatch?.index ?? -1;

  if (start < 0) {
    const needle = (question.question_text || '').trim().slice(0, 32);
    if (needle.length >= 10) start = documentText.indexOf(needle);
  }
  if (start < 0) return null;

  let end = Math.min(documentText.length, start + 1800);
  if (nextQuestion) {
    const nextNo = (nextQuestion.source_number || String(nextQuestion.number)).trim();
    const nextEscaped = nextNo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const nextRe = new RegExp(
      `(?:^|\\n)\\s*(?:#{1,3}\\s*)?(?:\\*\\*)?(?<!\\d)${nextEscaped}(?!\\d)(?:\\*\\*)?\\s*[)）．.\\-:]*`,
      'm',
    );
    const rest = documentText.slice(start + 1);
    const nextMatch = rest.match(nextRe);
    if (nextMatch?.index != null) {
      end = start + 1 + nextMatch.index;
    }
  }

  return documentText.slice(start, end);
}

function extractQuestionStemFromSlice(slice: string): string {
  const labelRe = /(?:^|[\s\n])(?:\(|\[)?[أابجدهـ](?:\)|\]|[)）.\-:])/;
  const idx = slice.search(labelRe);
  let stem = (idx >= 0 ? slice.slice(0, idx) : slice).trim();
  stem = stem.replace(/^\s*\d{1,3}\s*[)）．.\-:]*\s*/, '').trim();
  stem = stem.replace(/^تخير البديل الصحيح[^\n]*\n?/u, '').trim();
  if (stem.length > 900) stem = stem.slice(0, 900).trim();
  return stem;
}

/**
 * إذا رجّع النموذج اختيارين فقط أو أسقط نص الاقتباس — أكمل من مقطع OCR.
 */
function repairSparseTextOptions(
  questions: MistralExtractedQuestion[],
  documentText: string,
): MistralExtractedQuestion[] {
  return questions.map((question, index) => {
    if ((question.options || []).some((o) => o.image_id)) return question;

    const slice = findQuestionSlice(documentText, question, questions[index + 1]);
    if (!slice) return question;

    let next = question;
    const textOpts = (question.options || []).filter((o) => (o.text || '').trim());
    if (textOpts.length < 4) {
      const recovered = extractArabicMcqOptionsFromSlice(slice);
      if (recovered.length > textOpts.length && recovered.length >= 3) {
        next = { ...next, options: recovered };
      }
    }

    const recoveredStem = extractQuestionStemFromSlice(slice);
    const current = (next.question_text || '').trim();
    if (hasUnderlineMarkup(current) || (next.underlined_phrases?.length ?? 0) > 0 || (next.display_blocks?.length ?? 0) > 1) {
      return next;
    }
    const currentHead = current.slice(0, 20);
    const recoveredHead = recoveredStem.slice(0, 20);
    if (
      recoveredStem.length >= 24 &&
      recoveredStem.length > current.length + 8 &&
      (current.length < 40 ||
        (currentHead && recoveredStem.includes(currentHead)) ||
        (recoveredHead && current.includes(recoveredHead)))
    ) {
      next = { ...next, question_text: recoveredStem };
    }

    return next;
  });
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
  pageImages: VisionPageImage[] = [],
): Promise<{
  passages: MistralExtractedPassage[];
  questions: MistralExtractedQuestion[];
  notes?: string;
  chatModel: string;
}> {
  const { apiKey, apiBaseUrl, chatModel: defaultChatModel, visionChatModel } = getMistralConfig();
  const hasPageImages = pageImages.length > 0;
  const chatModel =
    chatModelOverride?.trim() || (hasPageImages ? visionChatModel : defaultChatModel) || defaultChatModel;

  const prompt = buildQuestionExtractionPrompt(documentText, filename, {
    inferCorrectAnswer,
    hasPageImages,
  });

  const userContent: unknown = hasPageImages
    ? [
        { type: 'text', text: prompt },
        ...pageImages.slice(0, 6).map((image) => ({
          type: 'image_url' as const,
          image_url: `data:${image.mime};base64,${image.base64}`,
        })),
      ]
    : prompt;

  const runChat = async (model: string, content: unknown) => {
    const response = await fetch(`${apiBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: inferCorrectAnswer ? 0.2 : 0.1,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content:
              'أنت محلل بصري لصفحات الامتحانات والكتب. افهم تخطيط الصفحة وحدود كل سؤال ثم أخرج JSON صالح فقط وفق المخطط. لا تضف markdown أو شرح خارج JSON.',
          },
          { role: 'user', content },
        ],
      }),
    });
    return response;
  };

  let response = await runChat(chatModel, userContent);
  let usedModel = chatModel;

  if (!response.ok && hasPageImages && response.status >= 400 && response.status < 500) {
    const errBody = await response.text();
    logger.warn(
      { status: response.status, body: errBody.slice(0, 300) },
      'vision question extraction failed — retrying text-only OCR',
    );
    usedModel = chatModelOverride?.trim() || defaultChatModel;
    response = await runChat(
      usedModel,
      buildQuestionExtractionPrompt(documentText, filename, {
        inferCorrectAnswer,
        hasPageImages: false,
      }),
    );
  }

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
  const folded = foldSingletonPassages(expanded.passages, expanded.questions);
  const repairedQuestions = repairSparseTextOptions(folded.questions, documentText);
  return {
    passages: folded.passages,
    questions: repairedQuestions,
    notes: validated.notes,
    chatModel: usedModel,
  };
}

type VisionPageImage = { pageIndex: number; mime: string; base64: string };

const MAX_VISION_FILE_BYTES = 5 * 1024 * 1024;

function collectVisionPagesFromFiles(files: Express.Multer.File[]): VisionPageImage[] {
  const out: VisionPageImage[] = [];
  let pageIndex = 0;
  for (const file of files) {
    const mime = MistralOcrService.resolveSupportedMime(file);
    if (mime.includes('pdf')) return [];

    let buffer = file.buffer;
    if (!buffer?.length && file.path && fs.existsSync(file.path)) {
      buffer = fs.readFileSync(file.path);
    }
    if (buffer?.length && buffer.length <= MAX_VISION_FILE_BYTES) {
      out.push({ pageIndex, mime, base64: buffer.toString('base64') });
    }
    pageIndex += 1;
  }
  return out;
}

/** Soft limits so huge PDFs don't blow the chat context window. */
const CHAT_BATCH_MAX_PAGES = 15;
const CHAT_BATCH_MAX_PAGES_WITH_VISION = 6;
const CHAT_BATCH_MAX_CHARS = 90_000;

function chunkOcrPagesForChat(ocr: MistralOcrResult, hasPageImages = false): MistralOcrResult[] {
  const maxPages = hasPageImages ? CHAT_BATCH_MAX_PAGES_WITH_VISION : CHAT_BATCH_MAX_PAGES;
  if (ocr.pages.length <= maxPages) {
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
      (currentPages.length >= maxPages ||
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
  pageImages: VisionPageImage[] = [],
): Promise<{
  passages: MistralExtractedPassage[];
  questions: MistralExtractedQuestion[];
  notes?: string;
  chatModel: string;
}> {
  const batches = chunkOcrPagesForChat(ocr, pageImages.length > 0);
  const imagesForBatch = (batch: MistralOcrResult) => {
    const indexes = new Set(batch.pages.map((page) => page.index));
    return pageImages.filter((image) => indexes.has(image.pageIndex)).slice(0, 6);
  };

  if (batches.length === 1) {
    return parseQuestionsWithChat(
      buildDocumentContext(batches[0]),
      ocr.filename,
      inferCorrectAnswer,
      chatModelOverride,
      imagesForBatch(batches[0]),
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
      imagesForBatch(batch),
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
  const folded = foldSingletonPassages(expanded.passages, expanded.questions);

  return {
    passages: folded.passages,
    questions: folded.questions,
    notes: notesParts.length ? notesParts.join('\n') : undefined,
    chatModel: chatModel || getMistralConfig().chatModel,
  };
}

export class MistralQuestionExtractionService {
  /**
   * Pipeline: OCR → فهم تخطيط الصفحة (صور إن وُجدت + markdown) → أسئلة JSON
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
      pageImages: collectVisionPagesFromFiles(files),
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
      pageImages?: VisionPageImage[];
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
      opts.pageImages ?? [],
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
