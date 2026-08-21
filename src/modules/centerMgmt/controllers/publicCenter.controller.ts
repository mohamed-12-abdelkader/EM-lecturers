import { Router, Request, Response } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { asyncWrapper } from '../../../utils';
import { extractQrToken } from '../utils/studentQr';
import { PublicStudentCardService } from '../services/publicStudentCard.service';
import {
  renderPublicStudentCardHtml,
  renderPublicStudentNotFoundHtml,
} from '../views/publicStudentCardHtml';

export const publicCenterRouter = Router();

function wantsJson(req: Request): boolean {
  if (req.query.format === 'json') return true;
  const accept = String(req.headers.accept || '');
  return accept.includes('application/json') && !accept.includes('text/html');
}

function noStore(res: Response) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
}

const publicStudentCardLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const fwd = req.headers['x-forwarded-for'];
    const raw =
      typeof fwd === 'string' && fwd.trim()
        ? fwd.split(',')[0].trim()
        : req.ip || req.socket?.remoteAddress || '127.0.0.1';
    return ipKeyGenerator(raw);
  },
  validate: { xForwardedForHeader: false, trustProxy: false },
  handler: (req, res) => {
    noStore(res);
    if (wantsJson(req)) {
      return res.status(429).json({ success: false, message: 'تم تجاوز حد الطلبات. حاول مرة أخرى لاحقاً.' });
    }
    res
      .status(429)
      .type('html')
      .send(
        `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>حاول لاحقاً</title></head><body style="font-family:Tahoma,Arial,sans-serif;text-align:center;padding:48px"><h1>تم تجاوز حد الطلبات</h1><p>حاول فتح البطاقة مرة أخرى بعد قليل.</p></body></html>`,
      );
  },
});

publicCenterRouter.get(
  '/students/:qrToken',
  publicStudentCardLimiter,
  asyncWrapper(async (req: Request, res: Response) => {
    noStore(res);
    const token = extractQrToken(req.params.qrToken);
    if (!token) {
      if (wantsJson(req)) {
        return res.status(400).json({ success: false, message: 'كود QR غير صالح' });
      }
      res.status(400).type('html').send(renderPublicStudentNotFoundHtml());
      return;
    }

    try {
      const data = await PublicStudentCardService.getByQrToken(token);
      if (wantsJson(req)) {
        return res.json({ success: true, data });
      }
      res.type('html').send(renderPublicStudentCardHtml(data));
    } catch {
      if (wantsJson(req)) {
        return res.status(404).json({ success: false, message: 'بطاقة الطالب غير موجودة' });
      }
      res.status(404).type('html').send(renderPublicStudentNotFoundHtml());
    }
  }),
);
