import type { RequestHandler } from 'express';

/**
 * Security headers أساسية لـ REST API (بديل مبسّط لـ helmet بدون dependency).
 * لا نضبط CSP صارم لأن الـ API يقدّم ملفات وصور عبر CORS للمنصات.
 */
export const securityHeadersMiddleware: RequestHandler = (_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=()',
  );
  // إزالة هيدر Express الافتراضي
  res.removeHeader('X-Powered-By');
  next();
};
