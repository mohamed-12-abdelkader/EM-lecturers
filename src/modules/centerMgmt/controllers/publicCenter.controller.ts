import { Router, Request, Response } from 'express';
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

publicCenterRouter.get(
  '/students/:qrToken',
  asyncWrapper(async (req: Request, res: Response) => {
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
