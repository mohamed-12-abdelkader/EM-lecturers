import express, { type RequestHandler } from 'express';
import path from 'path';
import { getImageCdnMaxAgeSeconds } from '../config/imageCdn';
import { ALLOWED_IMAGE_EXT, getUploadsRoot } from '../services/localImageStorage';

const IMAGE_PATH_RE = /\.(jpe?g|png|gif|webp)$/i;

/**
 * Public image CDN via express.static.
 * Serves only image files from the uploads root; rejects PDFs and other types.
 * Mount at `/cdn` so `/cdn/courses/x.jpg` maps to `uploads/courses/x.jpg`.
 */
export function createImageCdnStaticMiddleware(): RequestHandler {
  const maxAge = getImageCdnMaxAgeSeconds();
  const staticMw = express.static(getUploadsRoot(), {
    etag: true,
    lastModified: true,
    index: false,
    redirect: false,
    fallthrough: false,
    maxAge: maxAge * 1000,
    setHeaders(res, filePath) {
      const ext = path.extname(filePath).toLowerCase();
      if (!ALLOWED_IMAGE_EXT.has(ext)) {
        res.statusCode = 404;
        return;
      }
      res.setHeader('Cache-Control', `public, max-age=${maxAge}, immutable`);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      res.setHeader('Access-Control-Allow-Origin', '*');
      // Allow <img> / CSS from any tenant origin
      res.removeHeader('X-Frame-Options');
    },
  });

  return (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD');
      return res.status(405).json({ success: false, message: 'Method not allowed' });
    }

    const rel = (req.path || '').split('?')[0];
    if (!rel || rel === '/' || rel.includes('..') || rel.includes('\\')) {
      return res.status(404).json({ success: false, message: 'Not found' });
    }

    const ext = path.extname(rel).toLowerCase();
    if (!ALLOWED_IMAGE_EXT.has(ext) || !IMAGE_PATH_RE.test(rel)) {
      return res.status(404).json({ success: false, message: 'Only image files are available on the CDN' });
    }

    return staticMw(req, res, (err) => {
      if (err) return next(err);
      return res.status(404).json({ success: false, message: 'Not found' });
    });
  };
}
