import { RequestHandler } from 'express';
import { rewriteResponseUrls } from '../config/appUrls';

/**
 * Ensures JSON responses expose HTTPS/ngrok URLs instead of localhost paths.
 */
export const absoluteUrlResponseMiddleware: RequestHandler = (_req, res, next) => {
  const originalJson = res.json.bind(res);
  res.json = (body?: unknown) => originalJson(rewriteResponseUrls(body));
  next();
};
