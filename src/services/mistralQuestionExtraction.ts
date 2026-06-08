import fs from 'node:fs';
import path from 'node:path';
import { config } from '../utils';
import { uploadToBunnyStorage } from './bunny';
import { buildMistralQuestionExtractionPrompt } from '../prompts/mistralQuestionExtraction.prompt';
import { MistralOcrService } from './mistralOcr';
import {
  MistralQuestionExtractionSchema,
  type MistralExtractedPassage,
  type MistralExtractedQuestion,
  type MistralOcrResult,
  type MistralQuestionExtractionResult,
  type MistralQuestionImage,
} from '../types/mistralQuestionExtraction';

export type MistralQuestionExtractionOptions = {
  inferCorrectAnswer?: boolean;
  includeQuestionImages?: boolean;
};

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

function normalizeProviderPayload(payload: any): any {
  const questions = Array.isArray(payload?.questions)
    ? payload.questions.map((question: any, index: number) => ({
        ...question,
        number: Number(question?.number) > 0 ? Number(question.number) : index + 1,
        question_text: question?.question_text == null ? '' : String(question.question_text),
        options: Array.isArray(question?.options)
          ? question.options.map((option: any) => ({
              ...option,
              label: option?.label == null ? undefined : String(option.label),
              text: option?.text == null ? '' : String(option.text),
            }))
          : [],
        question_images: Array.isArray(question?.question_images) ? question.question_images : [],
      }))
    : [];

  return {
    ...payload,
    passages: Array.isArray(payload?.passages) ? payload.passages : [],
    questions,
  };
}

function fillMissingPassageIds(
  questions: MistralExtractedQuestion[],
  passages: MistralExtractedPassage[],
): MistralExtractedQuestion[] {
  if (passages.length !== 1) return questions;
  const passageId = passages[0].passage_id;
  return questions.map((question) => ({
    ...question,
    passage_id: question.passage_id ?? passageId,
  }));
}

function extractOcrImages(ocr: MistralOcrResult): MistralQuestionImage[] {
  return ocr.pages.flatMap((page) =>
    page.images.map((image) => ({
      image_id: image.id,
      page_index: image.page_index,
      image_type: image.annotation?.image_type,
      short_description: image.annotation?.short_description,
      summary: image.annotation?.summary,
      extracted_text: image.annotation?.extracted_text,
      image_base64: image.image_base64,
    })),
  );
}

function attachOcrImages(
  questions: MistralExtractedQuestion[],
  extractedImages: MistralQuestionImage[],
): MistralExtractedQuestion[] {
  const byId = new Map(extractedImages.map((image) => [image.image_id, image]));
  return questions.map((question) => ({
    ...question,
    question_images: (question.question_images || []).map((image) => ({
      ...byId.get(image.image_id),
      ...image,
    })),
  }));
}

function parseDataUri(dataUri: string): { buffer: Buffer; mime: string; ext: string } {
  const match = dataUri.match(/^data:([^;]+);base64,(.+)$/);
  const mime = match?.[1] || 'image/png';
  const raw = match?.[2] || dataUri;
  const ext =
    mime === 'image/jpeg' || mime === 'image/jpg'
      ? 'jpg'
      : mime === 'image/webp'
        ? 'webp'
        : mime === 'image/gif'
          ? 'gif'
          : 'png';
  return { buffer: Buffer.from(raw, 'base64'), mime, ext };
}

async function uploadQuestionImagesToBunny(
  questions: MistralExtractedQuestion[],
): Promise<MistralExtractedQuestion[]> {
  const uploadCache = new Map<string, Promise<string>>();
  const uploadDir = path.resolve(process.cwd(), 'uploads', 'mistral-ocr-question-images');
  fs.mkdirSync(uploadDir, { recursive: true });

  const uploadImage = (image: MistralQuestionImage): Promise<string> => {
    if (image.image_url) return Promise.resolve(image.image_url);
    if (!image.image_base64) return Promise.resolve('');

    const cached = uploadCache.get(image.image_id);
    if (cached) return cached;

    const uploadPromise = (async () => {
      const { buffer, mime, ext } = parseDataUri(image.image_base64 as string);
      const safeId = image.image_id.replace(/[^a-zA-Z0-9.-]/g, '_');
      const filePath = path.join(uploadDir, `${Date.now()}-${safeId}.${ext}`);
      fs.writeFileSync(filePath, buffer);
      return uploadToBunnyStorage({
        path: filePath,
        ext,
        mime,
        originalname: `${safeId}.${ext}`,
      });
    })();

    uploadCache.set(image.image_id, uploadPromise);
    return uploadPromise;
  };

  const out: MistralExtractedQuestion[] = [];
  for (const question of questions) {
    const questionImages = [];
    for (const image of question.question_images || []) {
      const imageUrl = await uploadImage(image);
      questionImages.push({
        ...image,
        ...(imageUrl && { image_url: imageUrl }),
        image_base64: undefined,
      });
    }
    out.push({ ...question, question_images: questionImages });
  }
  return out;
}

async function parseQuestionsWithChat(input: {
  documentContext: string;
  filename: string;
  inferCorrectAnswer: boolean;
}) {
  const response = await fetch(`${config.MISTRAL_API_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.MISTRAL_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.MISTRAL_CHAT_MODEL,
      messages: [
        {
          role: 'user',
          content: buildMistralQuestionExtractionPrompt(input),
        },
      ],
      temperature: 0.1,
      response_format: { type: 'json_object' },
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Mistral question extraction failed: ${response.status} ${await response.text()}`,
    );
  }

  const payload = (await response.json()) as any;
  const content = payload.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error('Mistral returned empty question extraction content');

  const jsonMatch = content.match(/\{[\s\S]*\}/);
  const parsed = normalizeProviderPayload(JSON.parse(jsonMatch ? jsonMatch[0] : content));
  const data = MistralQuestionExtractionSchema.parse(parsed);

  return {
    ...data,
    chatModel: String(payload.model ?? config.MISTRAL_CHAT_MODEL),
  };
}

export class MistralQuestionExtractionService {
  /**
   * Pipeline: Mistral OCR (PDF/image -> markdown) -> Mistral Chat (markdown -> structured questions JSON).
   */
  static async extractQuestionsFromFile(
    file: Express.Multer.File,
    options: MistralQuestionExtractionOptions = {},
  ): Promise<MistralQuestionExtractionResult> {
    const inferCorrectAnswer = options.inferCorrectAnswer ?? false;
    const includeQuestionImages = options.includeQuestionImages ?? true;

    const ocr = await MistralOcrService.extractTextFromFile(file, {
      annotateImages: includeQuestionImages,
      includeImageBase64: includeQuestionImages,
    });
    const documentContext = buildDocumentContext(ocr);
    const extractedImages = extractOcrImages(ocr);
    const { passages, questions, notes, chatModel } = await parseQuestionsWithChat({
      documentContext,
      filename: ocr.filename,
      inferCorrectAnswer,
    });

    const normalizedPassages = normalizePassages(passages);
    const questionsWithPassages = fillMissingPassageIds(questions, normalizedPassages);
    const attachedQuestions = includeQuestionImages
      ? attachOcrImages(questionsWithPassages, extractedImages)
      : questionsWithPassages.map((question) => ({ ...question, question_images: [] }));
    const questionsWithImages = includeQuestionImages
      ? await uploadQuestionImagesToBunny(attachedQuestions)
      : attachedQuestions;

    return {
      filename: ocr.filename,
      mime_type: ocr.mime_type,
      document_type: ocr.document_type,
      page_count: ocr.page_count,
      question_count: questionsWithImages.length,
      ocr_model: ocr.model,
      chat_model: chatModel,
      infer_correct_answer: inferCorrectAnswer,
      passages: normalizedPassages,
      extracted_images: extractedImages.map((image) => ({ ...image, image_base64: undefined })),
      questions: questionsWithImages,
      notes,
    };
  }
}
