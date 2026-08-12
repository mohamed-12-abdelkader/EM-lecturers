import type { RequestHandler } from 'express';

/**
 * Lightweight Cookie parser (بديل لـ cookie-parser بدون dependency إضافية).
 * يملأ req.cookies من هيدر Cookie فقط — بدون signed cookies.
 */
export const cookieParserMiddleware: RequestHandler = (req, _res, next) => {
  const jar: Record<string, string> = {};
  const header = req.headers.cookie;
  if (typeof header === 'string' && header.length) {
    for (const part of header.split(';')) {
      const eq = part.indexOf('=');
      if (eq <= 0) continue;
      const key = part.slice(0, eq).trim();
      if (!key) continue;
      let value = part.slice(eq + 1).trim();
      try {
        value = decodeURIComponent(value);
      } catch {
        /* keep raw */
      }
      jar[key] = value;
    }
  }
  (req as typeof req & { cookies: Record<string, string> }).cookies = jar;
  next();
};
