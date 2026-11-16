import type { RequestHandler } from 'express';

/**
 * Security headers أساسية لـ REST API (بديل مبسّط لـ helmet بدون dependency).
 * لا نضبط CSP صارم لأن الـ API يقدّم ملفات وصور عبر CORS للمنصات.
 */
export const securityHeadersMiddleware: RequestHandler = (req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // PDFs/images under /uploads are opened in viewers/iframes on tenant sites.
  // DENY makes Chrome's PDF plugin hang on Range requests then fail with a network error.
  const isRecorderTemplate = req.path.startsWith('/lk-recording');
  if (
    !req.path.startsWith('/uploads/') &&
    !req.path.startsWith('/cdn/') &&
    !isRecorderTemplate
  ) {
    res.setHeader('X-Frame-Options', 'DENY');
  }
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  // LiveKit egress Chromium needs autoplay for the recorder template.
  res.setHeader(
    'Permissions-Policy',
    isRecorderTemplate
      ? 'camera=*, microphone=*, autoplay=*, geolocation=(), payment=()'
      : 'camera=(), microphone=(), geolocation=(), payment=()',
  );
  // إزالة هيدر Express الافتراضي
  res.removeHeader('X-Powered-By');
  next();
};
