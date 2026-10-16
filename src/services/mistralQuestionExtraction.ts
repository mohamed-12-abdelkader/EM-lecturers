import { assertMistralConfigured, DEFAULT_MISTRAL_CHAT_MODEL, getMistralConfig } from '../config/mistral';
import { buildQuestionExtractionPrompt, resolveExtractionMode } from '../prompts/mistralQuestionExtraction.prompt';
import {
  MistralQuestionExtractionSchema,
  type MistralExtractedPassage,
  type MistralExtractedQuestion,
  type MistralQuestionImage,
  type MistralQuestionExtractionOptions,
  type MistralQuestionExtractionResult,
} from '../types/mistralQuestionExtraction';
import { config, HttpError, logger, uploadBufferToCloudinary } from '../utils';
import { isDeepSeekChatModel, resolveChatModel } from '../config/questionExtractionModels';
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
  poetry: boolean;
  verses: Array<{ firstHemistich: string; secondHemistich: string }>;
} {
  let blocks = buildDisplayBlocks(q);
  const introHint = blocks.find((b) => b.role === 'intro')?.text ?? q.intro_text ?? '';
  const versesFromModel = (q.verses ?? [])
    .map((v) => ({
      firstHemistich: String(v.firstHemistich ?? '').trim(),
      secondHemistich: String(v.secondHemistich ?? '').trim(),
    }))
    .filter((v) => v.firstHemistich && v.secondHemistich);
  const poetry =
    q.poetry === true ||
    versesFromModel.length > 0 ||
    looksLikePoetry(introHint, blocks.find((b) => b.role === 'stimulus')?.text ?? '');

  // إن وُجدت verses بلا stimulus كافٍ — ابنِ stimulus من الأبيات
  if (versesFromModel.length > 0) {
    const fromVerses = versesFromModel
      .map((v) => `${v.firstHemistich}    ${v.secondHemistich}`)
      .join('\n\n');
    const stimulusIdx = blocks.findIndex((b) => b.role === 'stimulus');
    if (stimulusIdx >= 0) {
      const current = blocks[stimulusIdx].text.trim();
      if (!current || current.length < fromVerses.length * 0.5) {
        blocks[stimulusIdx] = { role: 'stimulus', text: fromVerses };
      }
    } else {
      const promptIdx = blocks.findIndex((b) => b.role === 'prompt');
      const insertAt = promptIdx >= 0 ? promptIdx : blocks.length;
      blocks.splice(insertAt, 0, { role: 'stimulus', text: fromVerses });
    }
  }

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
    poetry,
    verses: versesFromModel,
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
      poetry: layout.poetry,
      verses: layout.verses,
      score:
        q.score == null || Number.isNaN(Number(q.score)) ? null : Number(q.score),
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
    poetry: layout.poetry,
    verses: layout.verses,
    score: q.score == null || Number.isNaN(Number(q.score)) ? null : Number(q.score),
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

const ARABIC_INDIC_DIGITS: Record<string, string> = {
  '٠': '0',
  '١': '1',
  '٢': '2',
  '٣': '3',
  '٤': '4',
  '٥': '5',
  '٦': '6',
  '٧': '7',
  '٨': '8',
  '٩': '9',
};

function toWesternDigits(value: string): string {
  return String(value || '').replace(/[٠-٩]/g, (ch) => ARABIC_INDIC_DIGITS[ch] || ch);
}

type OcrNumberedBlock = {
  num: number;
  text: string;
  matchStart: number;
  textStart: number;
};

/** يفكك نص OCR إلى كتل مرقّمة (١) / 1) / ٢) …) */
function parseOcrNumberedBlocks(documentText: string): OcrNumberedBlock[] {
  const source = documentText || '';
  const re =
    /(?:^|\n)\s*(?:#{1,3}\s*)?(?:\*\*)?([0-9٠-٩]{1,3})(?:\*\*)?\s*[)）．.\-:]\s*/g;
  const marks: Array<{ num: number; matchStart: number; textStart: number }> = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) !== null) {
    const num = Number(toWesternDigits(match[1]));
    if (!Number.isInteger(num) || num <= 0) continue;
    marks.push({
      num,
      matchStart: match.index,
      textStart: match.index + match[0].length,
    });
  }

  return marks.map((mark, i) => {
    const end = i + 1 < marks.length ? marks[i + 1].matchStart : source.length;
    let text = source.slice(mark.textStart, end);
    text = text.replace(/\nIMAGE_CONTEXT:[\s\S]*$/i, '').trim();
    return { num: mark.num, text, matchStart: mark.matchStart, textStart: mark.textStart };
  });
}

function stripMarkdownImages(text: string): string {
  return text.replace(/!\[[^\]]*]\([^)]+\)/g, ' ').replace(/\s+/g, ' ').trim();
}

function extractMarkdownImageIds(text: string): string[] {
  const ids: string[] = [];
  const re = /!\[[^\]]*]\(([^)]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const raw = (match[1] || '').trim();
    if (!raw) continue;
    const id = raw.split('/').pop() || raw;
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

/** نص يبدو كسؤال مسحوب بالخطأ داخل options (مش اختيار). */
function looksLikeLeakedQuestionStem(text: string): boolean {
  const t = stripMarkdownImages(text || '').trim();
  if (!t) return false;
  if (/[؟?]\s*$/.test(t) && t.length > 35) return true;
  if (t.length > 85 && /[؟?]/.test(t)) return true;
  if (
    /^(?:أي|ما(?!\s+المادة\b)|ماذا|من خلال|ادرس|ادرسى|اختر|حد[دّ]|فيما|في\s+الشكل|الشكل\s+المقابل)/u.test(
      t,
    ) &&
    t.length > 45
  ) {
    return true;
  }
  if (/تتواجد في جدر|الأكثر تأثراً|تحول دون فقد|المادة التي تُرَسَب/u.test(t) && t.length > 40) {
    return true;
  }
  return false;
}

/**
 * عندما OCR يرقّم السؤال والاختيارات بأرقام متسلسلة (١ سؤال، ٢–٥ اختيارات):
 * استخرج حتى 4 اختيارات نصية متتالية بعد رقم السؤال — بدون سحب سؤال لاحق.
 */
function extractOptionsFromFalseNumberedSlice(
  slice: string,
  stemSourceNumber?: string | number | null,
): Array<{ label: string; text: string }> {
  const blocks = parseOcrNumberedBlocks(slice);
  if (blocks.length < 2) return [];

  let stemIdx = 0;
  const stemNum = Number(toWesternDigits(String(stemSourceNumber ?? '')));
  if (Number.isInteger(stemNum) && stemNum > 0) {
    const found = blocks.findIndex((b) => b.num === stemNum);
    if (found >= 0) stemIdx = found;
  }

  const labels = ['أ', 'ب', 'ج', 'د'] as const;
  const options: Array<{ label: string; text: string }> = [];
  for (let i = stemIdx + 1; i < blocks.length && options.length < 4; i++) {
    const expected = blocks[stemIdx].num + options.length + 1;
    if (blocks[i].num !== expected) break;
    const text = stripMarkdownImages(blocks[i].text);
    if (!text) break;
    // أي سطر يشبه سؤالًا — توقّف فورًا (لا تأخذه كاختيار)
    if (looksLikeLeakedQuestionStem(text)) break;
    options.push({ label: labels[options.length], text: text.slice(0, 400) });
  }
  return options;
}

/** تنظيف options: احذف أسئلة مسحوبة، ثبّت أ–د (4 كحد للأرابيك MCQ)، أزل التكرار. */
function sanitizeMcqOptions(
  question: MistralExtractedQuestion,
  allQuestions: MistralExtractedQuestion[],
): MistralExtractedQuestion {
  const otherStems = allQuestions
    .filter((q) => q.number !== question.number)
    .flatMap((q) => [q.prompt_text || '', q.question_text || ''])
    .map((s) => stripMarkdownImages(s).trim())
    .filter((s) => s.length > 24);

  const raw = [...(question.options || [])];
  const cleaned: typeof raw = [];
  const seenText = new Set<string>();

  for (const opt of sortMcqOptions(raw)) {
    const label = normalizeOptionLabel(opt.label);
    if (label === 'هـ' || label === 'و') continue; // امتحانات العربي هنا غالبًا أ–د فقط

    if (opt.image_id) {
      cleaned.push({ ...opt, label: label || opt.label });
      continue;
    }

    const text = (opt.text || '').trim();
    if (!text) continue;
    if (looksLikeLeakedQuestionStem(text)) continue;
    if (otherStems.some((stem) => text === stem || (text.length > 30 && stem.includes(text)) || (stem.length > 30 && text.includes(stem.slice(0, 48))))) {
      continue;
    }
    const key = text.replace(/\s+/g, ' ');
    if (seenText.has(key)) continue;
    seenText.add(key);
    cleaned.push({ ...opt, label: label || opt.label, text });
  }

  const labels = ['أ', 'ب', 'ج', 'د'] as const;
  const capped = cleaned.slice(0, 4).map((opt, i) => ({
    ...opt,
    label: labels[i] || normalizeOptionLabel(opt.label) || labels[i],
  }));

  return { ...question, options: capped };
}

function hydrateOptionImageUrls(questions: MistralExtractedQuestion[]): MistralExtractedQuestion[] {
  return questions.map((q) => {
    const urlById = new Map<string, string>();
    for (const im of q.question_images || []) {
      if (im.image_id && im.image_url) urlById.set(im.image_id, im.image_url);
    }
    return {
      ...q,
      options: (q.options || []).map((opt) => {
        if (!opt.image_id) return opt;
        const image_url = opt.image_url || urlById.get(opt.image_id);
        return image_url ? { ...opt, image_url } : opt;
      }),
    };
  });
}

function questionReferencesFigure(question: MistralExtractedQuestion): boolean {
  const text = `${question.question_text || ''} ${question.prompt_text || ''} ${question.intro_text || ''}`;
  return /الشكل|المقابل|الموضح|الرسوم|مخطط/u.test(text);
}

/** انقل question_figure من سؤال لا يذكر شكلًا إلى أقرب سؤال يذكر الشكل المقابل. */
function relocateMisplacedFigures(questions: MistralExtractedQuestion[]): MistralExtractedQuestion[] {
  const next = questions.map((q) => ({
    ...q,
    question_images: [...(q.question_images || [])],
    options: [...(q.options || [])],
  }));

  for (let qi = 0; qi < next.length; qi++) {
    const q = next[qi];
    if (questionReferencesFigure(q)) continue;
    const figures = (q.question_images || []).filter((im) => {
      if ((q.options || []).some((o) => o.image_id === im.image_id)) return false;
      const type = (im.image_type || '').toLowerCase();
      return (
        type === 'question_figure' ||
        /فين|venn|مخطط/i.test(`${im.short_description || ''} ${im.summary || ''}`)
      );
    });
    if (!figures.length) continue;

    const targetIdx = next.findIndex(
      (cand, idx) =>
        idx !== qi &&
        questionReferencesFigure(cand) &&
        !(cand.question_images || []).some((im) => figures.some((f) => f.image_id === im.image_id)),
    );
    if (targetIdx < 0) continue;

    const moveIds = new Set(figures.map((f) => f.image_id));
    next[qi] = {
      ...next[qi],
      question_images: (next[qi].question_images || []).filter((im) => !moveIds.has(im.image_id)),
    };
    next[targetIdx] = {
      ...next[targetIdx],
      question_images: [...(next[targetIdx].question_images || []), ...figures],
    };
  }

  return next;
}

function cleanQuestionTextFromOptionLeak(
  questionText: string,
  options: Array<{ text?: string | null }>,
): string {
  let text = (questionText || '').trim();
  if (!text) return text;
  text = text.replace(/\nIMAGE_CONTEXT:[\s\S]*$/i, '').trim();
  text = text.replace(/(?:\n|^)\s*!\[[^\]]*]\([^)]+\)\s*/g, '\n').trim();

  for (const opt of options) {
    const optText = (opt.text || '').trim();
    if (optText.length < 3) continue;
    const escaped = optText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    text = text.replace(new RegExp(`(?:\\n|^)\\s*[0-9٠-٩]{1,3}\\s*[)）．.\\-:]\\s*${escaped}\\s*`, 'g'), '\n');
    text = text.replace(new RegExp(`(?:\\n|^)\\s*${escaped}\\s*(?=\\n|$)`, 'g'), '\n');
  }

  // أزل أسطر الاختيارات المرقّمة بعد سطر السؤال الأول
  const lines = text.split(/\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length > 1) {
    const kept = [lines[0].replace(/^\s*[0-9٠-٩]{1,3}\s*[)）．.\-:]\s*/, '').trim() || lines[0]];
    for (let i = 1; i < lines.length; i++) {
      if (/^[0-9٠-٩]{1,3}\s*[)）．.\-:]/.test(lines[i])) continue;
      if (/^[أابجدهـABCDE]\s*[)）．.\-:]/.test(lines[i])) continue;
      kept.push(lines[i]);
    }
    text = kept.join('\n\n');
  }

  return text.replace(/\n{3,}/g, '\n\n').trim();
}

function extractArabicMcqOptionsFromSlice(slice: string): Array<{ label: string; text: string }> {
  const source = slice
    .replace(/[Ⓐⓐ🄐]/g, 'أ) ')
    .replace(/[Ⓑⓑ🄑]/g, 'ب) ')
    .replace(/[Ⓒⓒ🄒]/g, 'ج) ')
    .replace(/[Ⓓⓓ🄓]/g, 'د) ');

  // يدعم: (أ) / أ) / أ. / أ: وأيضًا صفّين في شبكة 2×2 على سطر واحد أو سطرين
  const labelRe =
    /(?:^|[\s\n\r\t\|]| {2,})(?:\(|\[)?([أابجدهـABCDE])(?:\)|\]|[)）.\-:])\s*/gu;
  const marks: Array<{ label: string; matchStart: number; textStart: number }> = [];
  let match: RegExpExecArray | null;
  while ((match = labelRe.exec(source)) !== null) {
    const raw = match[1];
    const label =
      LATIN_TO_AR_OPTION[raw] ||
      LATIN_TO_AR_OPTION[raw.toLowerCase()] ||
      normalizeOptionLabel(raw);
    marks.push({
      label,
      matchStart: match.index,
      textStart: match.index + match[0].length,
    });
  }

  const found = new Map<string, string>();
  for (let i = 0; i < marks.length; i++) {
    const end = i + 1 < marks.length ? marks[i + 1].matchStart : source.length;
    let text = source.slice(marks[i].textStart, end);
    // لا تقطع عند سطر جديد داخل شبكة 2×2 — اقطع فقط عند رقم سؤال لاحق
    text = text.split(/\n\s*\d{1,3}\s*[)）．.\-:]\s/)[0];
    text = text.replace(/!\[[^\]]*]\([^)]+\)/g, ' ').replace(/\s+/g, ' ').trim();
    // اختيار صوري بدون نص OCR — اعتبره موجودًا بنص فارغ ليُربط لاحقًا بالصورة
    if (!text) {
      if (!found.has(marks[i].label)) found.set(marks[i].label, '');
      continue;
    }
    if (text.length > 400) text = text.slice(0, 400).trim();
    const prev = found.get(marks[i].label);
    if (!prev || text.length > prev.length) found.set(marks[i].label, text);
  }

  const order = ['أ', 'ب', 'ج', 'د'];
  return order
    .filter((label) => found.has(label))
    .map((label) => ({ label, text: found.get(label)! }))
    .filter((o) => !looksLikeLeakedQuestionStem(o.text));
}

function toArabicIndicDigits(value: string | number): string {
  const map = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
  return String(value).replace(/\d/g, (d) => map[Number(d)] || d);
}

function findNumberedBlockStart(documentText: string, sourceNo: string): number {
  const western = toWesternDigits(sourceNo).trim();
  const arabic = toArabicIndicDigits(western);
  const variants = [...new Set([sourceNo.trim(), western, arabic].filter(Boolean))];
  for (const variant of variants) {
    const escaped = variant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const startRe = new RegExp(
      `(?:^|\\n)\\s*(?:#{1,3}\\s*)?(?:\\*\\*)?(?<![0-9٠-٩])${escaped}(?![0-9٠-٩])(?:\\*\\*)?\\s*[)）．.\\-:]*`,
      'm',
    );
    const startMatch = documentText.match(startRe);
    if (startMatch?.index != null) return startMatch.index;
  }
  return -1;
}

function findQuestionSlice(
  documentText: string,
  question: MistralExtractedQuestion,
  nextQuestion?: MistralExtractedQuestion,
): string | null {
  const sourceNo = (question.source_number || String(question.number)).trim();
  let start = findNumberedBlockStart(documentText, sourceNo);

  if (start < 0) {
    const needle = stripMarkdownImages((question.prompt_text || question.question_text || '').trim()).slice(
      0,
      40,
    );
    if (needle.length >= 10) start = documentText.indexOf(needle);
  }
  if (start < 0) return null;

  let end = Math.min(documentText.length, start + 2200);
  if (nextQuestion) {
    const nextNo = (nextQuestion.source_number || String(nextQuestion.number)).trim();
    const nextStart = findNumberedBlockStart(documentText.slice(start + 1), nextNo);
    if (nextStart >= 0) {
      end = start + 1 + nextStart;
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

function mergeTextOptions(
  current: Array<{ label: string; text?: string | null }>,
  recovered: Array<{ label: string; text: string }>,
): Array<{ label: string; text: string }> {
  const byLabel = new Map<string, { label: string; text: string }>();
  for (const opt of current) {
    const label = normalizeOptionLabel(opt.label);
    const text = (opt.text || '').trim();
    if (label && text) byLabel.set(label, { label, text });
  }
  for (const opt of recovered) {
    const label = normalizeOptionLabel(opt.label);
    const text = (opt.text || '').trim();
    if (!label || !text) continue;
    const existing = byLabel.get(label);
    // تجنّب تكرار نفس النص على أ وب بالخطأ من OCR
    const duplicate = [...byLabel.values()].some(
      (o) => o.label !== label && o.text === text && text.length > 12,
    );
    if (duplicate && existing) continue;
    if (!existing || text.length > existing.text.length) {
      byLabel.set(label, { label, text });
    }
  }
  return sortMcqOptions([...byLabel.values()]);
}

/**
 * إذا رجّع النموذج اختيارين فقط (مثل صف علوي من شبكة 2×2) أو أسقط نصًا — أكمل/ادمج من مقطع OCR.
 * يدعم أيضًا خطأ OCR الشائع: ترقيم الاختيارات ٢)٣)٤)٥) بدل أ)ب)ج)د).
 */
function repairSparseTextOptions(
  questions: MistralExtractedQuestion[],
  documentText: string,
): MistralExtractedQuestion[] {
  return questions.map((question, index) => {
    if ((question.options || []).some((o) => o.image_id)) return question;

    const slice =
      findQuestionSlice(documentText, question, questions[index + 1]) ||
      question.question_text ||
      '';
    if (!slice) return question;

    let next = question;
    const textOpts = (question.options || []).filter((o) => (o.text || '').trim());
    const uniqueTexts = new Set(textOpts.map((o) => (o.text || '').trim()));
    const needsRepair = textOpts.length < 4 || uniqueTexts.size < Math.min(3, textOpts.length);

    if (needsRepair) {
      const keepClean = (opts: Array<{ label: string; text: string }>) =>
        opts.filter((o) => (o.text || '').trim() && !looksLikeLeakedQuestionStem(o.text));

      const fromLetters = keepClean(extractArabicMcqOptionsFromSlice(slice));
      const fromNumbers = keepClean(
        extractOptionsFromFalseNumberedSlice(slice, question.source_number || question.number),
      );
      // لا تستخدم كامل المستند هنا — يلتقط أسئلة لاحقة كاختيارات بالخطأ

      const currentClean = (question.options || []).filter(
        (o) => (o.text || '').trim() && !looksLikeLeakedQuestionStem(o.text || ''),
      );
      let merged = mergeTextOptions(currentClean, fromLetters);
      merged = mergeTextOptions(merged, fromNumbers);
      merged = keepClean(merged).slice(0, 4);

      if (merged.length > currentClean.length && merged.length >= 3) {
        next = { ...next, options: merged };
      } else if (currentClean.length >= 2 && currentClean.length < (question.options || []).length) {
        // النموذج رجّع اختيارات ملوّثة — أبقِ النظيفة فقط
        next = { ...next, options: currentClean.slice(0, 4) };
      }
    }

    const cleanedText = cleanQuestionTextFromOptionLeak(
      next.question_text || '',
      next.options || [],
    );
    if (cleanedText && cleanedText !== (next.question_text || '').trim()) {
      next = {
        ...next,
        question_text: cleanedText,
        prompt_text: next.prompt_text || cleanedText,
      };
    }

    const recoveredStem = extractQuestionStemFromSlice(slice);
    const current = (next.question_text || '').trim();
    if (
      hasUnderlineMarkup(current) ||
      (next.underlined_phrases?.length ?? 0) > 0 ||
      (next.display_blocks?.length ?? 0) > 1
    ) {
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
      next = {
        ...next,
        question_text: cleanQuestionTextFromOptionLeak(recoveredStem, next.options || []),
      };
    }

    return next;
  });
}

function isChoiceOptionImage(image: {
  image_type?: string | null;
  short_description?: string | null;
  summary?: string | null;
}): boolean {
  const type = (image.image_type || '').toLowerCase();
  if (type === 'choice_option' || type.includes('choice')) return true;
  const blob = `${image.short_description || ''} ${image.summary || ''}`.toLowerCase();
  return /choice_option|answer choice|option thumbnail|اختيار|بديل\s*[أبجدهa-d]/i.test(blob);
}

function isLikelyImageChoicesQuestion(question: MistralExtractedQuestion): boolean {
  const opts = question.options || [];
  if (opts.some((o) => o.image_id)) return true;
  const textOpts = opts.filter((o) => (o.text || '').trim());
  // لا اختيارات نصية — جرّب ربط صور choice_option إن وُجدت في المقطع
  if (textOpts.length === 0) return true;
  // نص اختيار ضعيف جدًا مع بقاء أقل من 3 — غالبًا صف اختيارات مصوّرة
  if (textOpts.length < 3) {
    const avgLen =
      textOpts.reduce((sum, o) => sum + (o.text || '').trim().length, 0) / textOpts.length;
    if (avgLen <= 8) return true;
  }
  const stem = `${question.question_text || ''} ${question.prompt_text || ''}`;
  if (
    textOpts.length < 3 &&
    /(?:الأشكال|الرسومات|الشكل\s+الموضح|أي\s+الأشكال|الخيارات\s+التالية\s+تمثل)/u.test(stem)
  ) {
    return true;
  }
  return false;
}

function resolveOcrImageById(
  ocrImages: InternalQuestionImage[],
  imageId: string,
): InternalQuestionImage | undefined {
  const needle = imageId.trim();
  if (!needle) return undefined;
  return (
    ocrImages.find((img) => img.image_id === needle) ||
    ocrImages.find((img) => img.image_id.replace(/\.(jpeg|jpg|png|webp)$/i, '') === needle.replace(/\.(jpeg|jpg|png|webp)$/i, '')) ||
    ocrImages.find((img) => needle.includes(img.image_id) || img.image_id.includes(needle))
  );
}

/**
 * يربط صور OCR / مراجع markdown باختيارات أ–د عندما تكون الاختيارات رسومات.
 */
function repairImageChoiceOptions(
  questions: MistralExtractedQuestion[],
  ocrImages: InternalQuestionImage[],
  documentText: string,
): MistralExtractedQuestion[] {
  const usedImageIds = new Set<string>();
  for (const q of questions) {
    for (const o of q.options || []) {
      if (o.image_id) usedImageIds.add(o.image_id);
    }
  }

  const labels = ['أ', 'ب', 'ج', 'د'] as const;

  return questions.map((question, index) => {
    const textOpts = (question.options || []).filter((o) => (o.text || '').trim());
    const existingImageOpts = (question.options || []).filter((o) => o.image_id);

    if (existingImageOpts.length >= 4) {
      return question;
    }
    // اختيارات نصية مكتملة (3+) بدون صور — اتركها
    if (textOpts.length >= 3 && existingImageOpts.length === 0) {
      return question;
    }

    const slice =
      findQuestionSlice(documentText, question, questions[index + 1]) ||
      question.question_text ||
      '';
    const markdownIds = extractMarkdownImageIds(`${slice}\n${question.question_text || ''}`);
    const sliceImages = ocrImages.filter((img) => {
      if (!img.image_id || usedImageIds.has(img.image_id)) return false;
      if (slice && slice.includes(img.image_id)) return true;
      return markdownIds.some(
        (id) =>
          id === img.image_id ||
          id.replace(/\.(jpeg|jpg|png|webp)$/i, '') ===
            img.image_id.replace(/\.(jpeg|jpg|png|webp)$/i, ''),
      );
    });

    // صور مذكورة في markdown حتى لو ناقصة من ocrImages (نضيف مرجعًا؛ الرفع لاحقًا إن وُجد base64)
    const markdownOnly = markdownIds
      .filter((id) => !usedImageIds.has(id))
      .filter((id) => !sliceImages.some((img) => img.image_id === id || id.includes(img.image_id)))
      .map(
        (id) =>
          resolveOcrImageById(ocrImages, id) ||
          ({
            image_id: id,
            page_index: null,
            image_type: 'choice_option',
          } as InternalQuestionImage),
      );

    let candidates = [...sliceImages, ...markdownOnly].filter(
      (img, i, arr) => arr.findIndex((x) => x.image_id === img.image_id) === i,
    );

    const choiceTyped = candidates.filter(isChoiceOptionImage);
    if (choiceTyped.length >= 2) {
      candidates = choiceTyped;
    } else {
      const stemIds = new Set(
        (question.question_images || [])
          .filter((im) => (im.image_type || '').toLowerCase() === 'question_figure')
          .map((im) => im.image_id),
      );
      candidates = candidates.filter((img) => !stemIds.has(img.image_id));
    }

    // سؤال نصي ناقص + عدة صور في المقطع = اختيارات مصوّرة (أو سؤال تالٍ اندمج)
    const shouldBindImages =
      isLikelyImageChoicesQuestion(question) ||
      (textOpts.length < 3 && candidates.length >= 2) ||
      (textOpts.length <= 2 && markdownIds.length >= 2);

    if (!shouldBindImages || candidates.length < 2) {
      return question;
    }

    const already = new Map(
      existingImageOpts.map((o) => [normalizeOptionLabel(o.label), o.image_id!]),
    );
    const remaining = candidates.filter((img) => ![...already.values()].includes(img.image_id));
    if (already.size + remaining.length < 2) {
      return question;
    }

    const assigned: Array<{ label: string; text: string; image_id: string }> = [];
    for (const label of labels) {
      const existingId = already.get(label);
      if (existingId) {
        assigned.push({ label, text: '', image_id: existingId });
        continue;
      }
      const nextImg = remaining.shift();
      if (!nextImg) break;
      assigned.push({ label, text: '', image_id: nextImg.image_id });
      usedImageIds.add(nextImg.image_id);
    }

    if (assigned.length < 2) return question;
    for (const opt of assigned) usedImageIds.add(opt.image_id);

    const optionImageRefs = assigned.map((opt) => {
      const ocrImage = resolveOcrImageById(ocrImages, opt.image_id);
      return {
        image_id: opt.image_id,
        page_index: ocrImage?.page_index ?? null,
        image_type: ocrImage?.image_type || 'choice_option',
        short_description: ocrImage?.short_description,
        summary: ocrImage?.summary,
        educational_relevance: ocrImage?.educational_relevance,
        image_base64: ocrImage?.image_base64,
        image_url: ocrImage?.image_url,
      };
    });

    const keptStemImages = (question.question_images || []).filter(
      (im) => !assigned.some((o) => o.image_id === im.image_id),
    );

    // إن كانت هناك اختيارات نصية جيدة (3+) لا تستبدلها بالصور
    if (textOpts.length >= 3) {
      return {
        ...question,
        question_images: [...keptStemImages, ...optionImageRefs],
      };
    }

    return {
      ...question,
      options: assigned,
      question_images: [...keptStemImages, ...optionImageRefs],
      question_text: cleanQuestionTextFromOptionLeak(question.question_text || '', assigned),
    };
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

const LATIN_TO_AR_OPTION: Record<string, string> = {
  a: 'أ',
  b: 'ب',
  c: 'ج',
  d: 'د',
  e: 'هـ',
  A: 'أ',
  B: 'ب',
  C: 'ج',
  D: 'د',
  E: 'هـ',
};

/**
 * يحوّل مخطط قطعة القراءة البديل إلى مخطط النظام الداخلي.
 * يقبل أيضًا: type/reading_passage + passage_text + question_number + options[].id
 */
function normalizeExtractionPayload(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const data = raw as Record<string, unknown>;

  // مخطط reading_passage المبسّط (قبل الشكل العام)
  const isReadingAlt =
    data.type === 'reading_passage' ||
    typeof data.passage_text === 'string' ||
    typeof data.passageText === 'string';

  if (isReadingAlt && !Array.isArray(data.passages)) {
    const passageText = String(data.passage_text ?? data.passageText ?? '').trim();
    const passageTitleRaw = data.passage_title ?? data.passageTitle ?? null;
    const passageTitle =
      typeof passageTitleRaw === 'string' && passageTitleRaw.trim()
        ? passageTitleRaw.trim()
        : null;
    const passageId = 'p1';
    const passages = passageText
      ? [{ passage_id: passageId, title: passageTitle, content: passageText }]
      : [];

    const rawQuestions = Array.isArray(data.questions) ? data.questions : [];
    const questions = rawQuestions.map((q, index) =>
      normalizeLooseQuestion(q, index, passages.length ? passageId : null),
    );

    return {
      subject: data.subject,
      extraction_mode: data.extraction_mode,
      content_type: 'reading_passage',
      passages,
      questions,
      notes: typeof data.notes === 'string' ? data.notes : undefined,
    };
  }

  if (Array.isArray(data.questions)) {
    const questions = (data.questions as unknown[]).map((q, index) =>
      normalizeLooseQuestion(q, index, null),
    );
    return {
      ...data,
      content_type:
        data.content_type ??
        data.document_type ??
        (Array.isArray(data.passages) && (data.passages as unknown[]).length > 0
          ? 'reading_passage'
          : 'general'),
      passages: Array.isArray(data.passages) ? data.passages : [],
      questions,
      notes: typeof data.notes === 'string' ? data.notes : undefined,
    };
  }

  return data;
}

/**
 * Mistral/DeepSeek أحياناً ترجع question_images كمصفوفة strings (image_id)
 * بدل objects — نحوّلها للشكل المتوقع قبل Zod.
 */
function normalizeLooseQuestionImages(raw: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(raw)) return [];
  const out: Array<Record<string, unknown>> = [];
  for (const item of raw) {
    if (typeof item === 'string') {
      const image_id = item.trim();
      if (image_id) out.push({ image_id });
      continue;
    }
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const image_id = String(o.image_id ?? o.id ?? o.imageId ?? '').trim();
    if (!image_id) continue;
    const pageRaw = o.page_index ?? o.pageIndex;
    const page_index =
      pageRaw == null || pageRaw === ''
        ? null
        : Number.isFinite(Number(pageRaw))
          ? Number(pageRaw)
          : null;
    out.push({
      ...o,
      image_id,
      page_index,
      ...(typeof o.image_url === 'string'
        ? { image_url: o.image_url }
        : typeof o.imageUrl === 'string'
          ? { image_url: o.imageUrl }
          : {}),
      ...(typeof o.image_type === 'string'
        ? { image_type: o.image_type }
        : typeof o.imageType === 'string'
          ? { image_type: o.imageType }
          : {}),
    });
  }
  return out;
}

function normalizeLooseQuestion(
  raw: unknown,
  index: number,
  defaultPassageId: string | null,
): Record<string, unknown> {
  if (!raw || typeof raw !== 'object') {
    return {
      number: index + 1,
      question_text: '',
      options: [],
      passage_id: defaultPassageId,
    };
  }
  const q = raw as Record<string, unknown>;
  const number =
    Number(q.number ?? q.question_number ?? q.questionNumber ?? index + 1) || index + 1;
  const questionText = String(
    q.question_text ?? q.questionText ?? q.prompt_text ?? q.promptText ?? '',
  ).trim();
  const scoreRaw = q.score ?? q.marks ?? q.mark;
  const score =
    scoreRaw == null || scoreRaw === ''
      ? null
      : Number.isFinite(Number(scoreRaw))
        ? Number(scoreRaw)
        : null;

  const rawOptions = Array.isArray(q.options) ? q.options : [];
  const options = rawOptions.map((opt, i) => {
    if (!opt || typeof opt !== 'object') {
      return { label: String(i + 1), text: String(opt ?? '') };
    }
    const o = opt as Record<string, unknown>;
    const rawLabel = String(o.label ?? o.id ?? '').trim();
    const label =
      LATIN_TO_AR_OPTION[rawLabel] ||
      LATIN_TO_AR_OPTION[rawLabel.toLowerCase()] ||
      rawLabel ||
      ARABIC_OPTION_LABELS[i] ||
      String(i + 1);
    return {
      label,
      text: String(o.text ?? '').trim(),
      ...(typeof o.image_id === 'string' ? { image_id: o.image_id } : {}),
    };
  });

    const promptCandidate = q.prompt_text ?? q.promptText ?? questionText;
    return {
    ...q,
    number,
    source_number: String(q.source_number ?? q.question_number ?? q.questionNumber ?? number),
    question_text: questionText,
    prompt_text: String(promptCandidate ?? '').trim() || null,
    passage_id: q.passage_id ?? q.passageId ?? defaultPassageId,
    score,
    options,
    question_images: normalizeLooseQuestionImages(q.question_images ?? q.questionImages),
    poetry: q.poetry ?? false,
    verses: Array.isArray(q.verses) ? q.verses : [],
  };
}

async function parseQuestionsWithChat(
  documentText: string,
  filename: string,
  inferCorrectAnswer: boolean,
  chatModelOverride?: string,
  pageImages: VisionPageImage[] = [],
  subject?: string | null,
): Promise<{
  passages: MistralExtractedPassage[];
  questions: MistralExtractedQuestion[];
  notes?: string;
  chatModel: string;
}> {
  const { apiKey, apiBaseUrl } = getMistralConfig();
  let chatModel = resolveChatModel(chatModelOverride);
  // DeepSeek نصّي فقط — لصفحات الصور (2×2 / اختيارات رسومية) نستخدم Mistral Vision تلقائيًا
  if (pageImages.length > 0 && isDeepSeekChatModel(chatModel)) {
    logger.warn(
      { requested: chatModel, fallback: DEFAULT_MISTRAL_CHAT_MODEL, pages: pageImages.length },
      'question extraction: DeepSeek is text-only; using Mistral vision for page images',
    );
    chatModel = DEFAULT_MISTRAL_CHAT_MODEL;
  }
  const useDeepSeek = isDeepSeekChatModel(chatModel);
  const hasPageImages = pageImages.length > 0 && !useDeepSeek;
  const mode = resolveExtractionMode(subject);

  if (useDeepSeek && !config.DEEPSEEK_API_KEY?.trim()) {
    throw new HttpError(503, 'DEEPSEEK_API_KEY غير مُعد في البيئة');
  }

  const prompt = buildQuestionExtractionPrompt(documentText, filename, {
    inferCorrectAnswer,
    hasPageImages,
    subject,
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

  const systemContent =
    mode === 'ARABIC_HIGH_ACCURACY_MODE'
      ? 'أنت AI متخصص في تحليل واقتطاع أسئلة الامتحانات من الصور. للغة العربية: دقة قصوى في التشكيل والهمزات وبيوت الشعر. اكتشف قطعة القراءة إن وُجدت وضعها في passages[] مرة واحدة مع passage_id. أخرج JSON صالح فقط بلا markdown.'
      : 'أنت AI متخصص في تحليل واقتطاع أسئلة الامتحانات من الصور وتحويلها إلى JSON. اكتشف قطعة القراءة إن وُجدت وضعها في passages[] مرة واحدة مع passage_id. افهم حدود كل سؤال ثم أخرج JSON صالح فقط بلا markdown.';

  const runChat = async (model: string, content: unknown) => {
    const deepseek = isDeepSeekChatModel(model);
    const endpoint = deepseek
      ? `${config.DEEPSEEK_API_URL}/v1/chat/completions`
      : `${apiBaseUrl}/chat/completions`;
    const bearer = deepseek ? config.DEEPSEEK_API_KEY : apiKey;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${bearer}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: inferCorrectAnswer ? 0.2 : mode === 'ARABIC_HIGH_ACCURACY_MODE' ? 0.05 : 0.1,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: systemContent,
          },
          { role: 'user', content },
        ],
      }),
    });
    return response;
  };

  let response = await runChat(chatModel, userContent);
  let usedModel = chatModel;
  const textOnlyPrompt = buildQuestionExtractionPrompt(documentText, filename, {
    inferCorrectAnswer,
    hasPageImages: false,
    subject,
  });

  if (!response.ok && hasPageImages && response.status >= 400 && response.status < 500) {
    const errBody = await response.text();
    logger.warn(
      { status: response.status, body: errBody.slice(0, 300) },
      'vision question extraction failed — retrying text-only OCR',
    );
    usedModel = resolveChatModel(chatModelOverride);
    response = await runChat(usedModel, textOnlyPrompt);
  }

  if (
    !response.ok &&
    response.status === 403 &&
    !isDeepSeekChatModel(usedModel) &&
    usedModel !== DEFAULT_MISTRAL_CHAT_MODEL
  ) {
    const errBody = await response.text();
    logger.warn(
      { status: response.status, model: usedModel, body: errBody.slice(0, 300) },
      'chat model not allowed on this Mistral tier — retrying with medium',
    );
    usedModel = DEFAULT_MISTRAL_CHAT_MODEL;
    response = await runChat(usedModel, hasPageImages ? userContent : textOnlyPrompt);
  }

  if (!response.ok) {
    const errBody = await response.text();
    const provider = isDeepSeekChatModel(usedModel) ? 'DeepSeek' : 'Mistral';
    if (response.status === 401) {
      throw new HttpError(
        502,
        isDeepSeekChatModel(usedModel)
          ? 'DeepSeek رفض مفتاح API (401). تحقق من DEEPSEEK_API_KEY'
          : 'Mistral رفض مفتاح API (401). تحقق من MISTRAL_API_KEY في https://console.mistral.ai',
      );
    }
    throw new HttpError(
      response.status >= 500 ? 502 : 400,
      `${provider} Chat failed (${response.status}): ${errBody.slice(0, 500)}`,
    );
  }

  const json = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = json.choices?.[0]?.message?.content;
  if (!content) {
    throw new HttpError(
      502,
      `${isDeepSeekChatModel(usedModel) ? 'DeepSeek' : 'Mistral'} Chat returned empty response`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new HttpError(502, 'Mistral Chat returned invalid JSON');
  }

  parsed = normalizeExtractionPayload(parsed);

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
  let sanitizedQuestions = repairedQuestions.map((q, _i, arr) => sanitizeMcqOptions(q, arr));
  // بعد حذف الاختيارات الملوّثة: أعد المحاولة لاستكمال أ–د من الـ slice فقط
  sanitizedQuestions = repairSparseTextOptions(sanitizedQuestions, documentText).map((q, _i, arr) =>
    sanitizeMcqOptions(q, arr),
  );
  return {
    passages: folded.passages,
    questions: sanitizedQuestions,
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
  subject?: string | null,
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
      subject,
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
      subject,
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
    chatModel: chatModel || resolveChatModel(),
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
    const subject = options.subject?.trim() || null;

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
      subject,
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
      subject?: string | null;
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
      opts.subject,
    );
    const questionsWithPassages = fillMissingPassageIds(questions, passages);
    const attachedQuestions = opts.includeQuestionImages
      ? repairImageChoiceOptions(
          attachOcrImages(questionsWithPassages, extractedImages),
          extractedImages,
          documentContext,
        )
      : questionsWithPassages.map((q) => ({ ...q, question_images: [] }));

    let questionsWithImages = relocateMisplacedFigures(
      attachedQuestions.map((q, _i, arr) => sanitizeMcqOptions(q, arr)),
    );
    let imageUploadWarnings: string[] = [];
    if (opts.includeQuestionImages) {
      const uploadResult = await uploadQuestionImagesToCloudinary(questionsWithImages);
      questionsWithImages = hydrateOptionImageUrls(uploadResult.questions);
      imageUploadWarnings = uploadResult.warnings;
    }

    return {
      filename: ocr.filename,
      mime_type: ocr.mime_type,
      document_type: ocr.document_type,
      page_count: ocr.page_count,
      question_count: questionsWithImages.length,
      ocr_model: ocr.model,
      chat_model: chatModel,
      infer_correct_answer: opts.inferCorrectAnswer,
      subject: opts.subject?.trim() || undefined,
      extraction_mode: resolveExtractionMode(opts.subject),
      content_type: passages.length > 0 ? 'reading_passage' : 'general',
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
