import { config, logger } from '../../../../utils';
import type { InboundMedia } from '../types';

const IMAGE_MIME_PREFIX = 'image/';

/**
 * Describe inbound WhatsApp screenshot/image via Mistral vision (pixtral).
 */
export async function describeInboundImage(
  media: InboundMedia | null | undefined,
): Promise<string | null> {
  if (!media?.data || !media.mimetype) return null;
  if (!media.mimetype.startsWith(IMAGE_MIME_PREFIX)) {
    return `المرفق مش صورة (النوع: ${media.mimetype}). اطلب من الطالب يبعت سكرين شوت كصورة.`;
  }
  if (!config.MISTRAL_API_KEY) {
    logger.warn('MISTRAL_API_KEY missing; cannot describe WhatsApp image');
    return 'وصلت صورة بس تحليل الصور مش شغال دلوقتي. اطلب من الطالب يوصف الخطأ كتابة.';
  }

  const dataUrl = `data:${media.mimetype};base64,${media.data}`;
  const prompt = `أنت أحمد، مساعد الدعم الفني لمنصة تعليمية مصرية.
وصف السكرين/الصورة دي باختصار بالعامية المصرية (مش فصحى):
- أنهي صفحة ظاهرة (دخول، تسجيل، خطأ، حاجة تانية)
- نص رسالة الخطأ لو موجودة
- أي فيلدز ظاهرة (تليفون/موبايل، باسورد، رسائل خطأ)
- أي تفاصيل تساعد نحل مشكلة تقنية
خليك دقيق ومختصر (أقل من 200 كلمة). متخمّنش حاجة مش ظاهرة.`;

  try {
    const response = await fetch(`${config.MISTRAL_API_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.MISTRAL_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'pixtral-12b-2409',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: dataUrl },
            ],
          },
        ],
        temperature: 0.2,
        max_tokens: 500,
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      logger.warn(
        { status: response.status, errText: errText.slice(0, 300) },
        'Mistral vision failed for support bot',
      );
      return 'وصلت صورة بس مقدرتش أحلّلها. اطلب من الطالب يوصف الخطأ كتابة أو يبعت الصورة تاني.';
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = data.choices?.[0]?.message?.content?.trim();
    return text || null;
  } catch (err) {
    logger.warn({ err }, 'Mistral vision request error');
    return 'وصلت صورة بس تحليلها وقع بسبب خطأ تقني.';
  }
}
