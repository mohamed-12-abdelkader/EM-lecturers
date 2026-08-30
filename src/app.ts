import express from 'express';
import { createServer } from 'http';
import { loggerMiddleware } from './utils';
import { errorHandlerMiddleware } from './middleware/errorHandler';
import { absoluteUrlResponseMiddleware } from './middleware/absoluteUrlResponse';
import { cookieParserMiddleware } from './middleware/cookieParser';
import { securityHeadersMiddleware } from './middleware/securityHeaders';
import cors from 'cors';
import { getCorsOriginDelegate, getServerInfo } from './config/appUrls';
import { router } from './routes';
import { tenantContextMiddleware } from './middleware/tenantContext';
import { teacherLibraryStaticMiddleware } from './modules/myFiles/middleware/teacherLibraryStatic';
import { whatsappWebhookRouter } from './modules/whatsapp/controllers/whatsappWebhook.controller';
// Register WhatsApp chatbot handlers (side-effect)
import './modules/whatsapp/automations/technicalSupport';
import './modules/whatsapp/automations/teacherCreative';
import './modules/whatsapp/automations/teacherDataAnalyst';
import './modules/whatsapp/automations/studentScientific';
import './modules/whatsapp/automations/teacherExamBuilder';

export const app = express();
export const server = createServer(app);

// خلف proxy (ngrok / nginx): مطلوب لقراءة IP الحقيقي و secure cookies
app.set('trust proxy', 1);

// Large OCR / file uploads can take a long time (multi-page PDF batches)
server.timeout = 0;
server.requestTimeout = 0;
server.headersTimeout = 0;

app.use(securityHeadersMiddleware);

// Parse JSON bodies; include text/plain because some clients (e.g. Postman "raw" default) send JSON with Content-Type: text/plain
// Capture rawBody for WhatsApp webhook HMAC verification
// Limit raised for wwebjs inbound media (base64 images up to ~5MB)
app.use(
  express.json({
    limit: '8mb',
    type: ['application/json', 'text/plain'],
    verify: (req, _res, buf) => {
      (req as express.Request & { rawBody?: Buffer }).rawBody = buf;
    },
  }),
);
app.use(express.urlencoded({ extended: true }));
app.use(cookieParserMiddleware);
app.use(cors(getCorsOriginDelegate()));
app.options('*', cors(getCorsOriginDelegate()));
// Expose refreshed token header to the browser
app.use((req, res, next) => {
  const existing = res.getHeader('Access-Control-Expose-Headers');
  const expose = Array.isArray(existing)
    ? existing.join(',')
    : typeof existing === 'string'
      ? existing
      : '';
  const value = expose ? `${expose}, X-Access-Token` : 'X-Access-Token';
  res.setHeader('Access-Control-Expose-Headers', value);
  next();
});
app.use(express.raw({ type: 'application/webhook+json' }));
app.use(loggerMiddleware);
app.use(absoluteUrlResponseMiddleware);

// Public server info (for Expo Go / mobile clients)
app.get('/api/server-info', (_req, res) => {
  res.json(getServerInfo());
});

// WhatsApp webhook — no tenant Host header; mount before tenant middleware
app.use('/api/webhooks/whatsapp', whatsappWebhookRouter);

// Routes
app.use('/api', tenantContextMiddleware);
app.use('/api', router);
app.use('/uploads/teacher-library', teacherLibraryStaticMiddleware);
app.use(
  '/uploads',
  express.static('uploads', {
    // Weak ETags (W/"...") + Accept-Ranges break Chrome's built-in PDF viewer.
    etag: false,
    lastModified: true,
    acceptRanges: true,
    setHeaders(res, filePath) {
      if (filePath.toLowerCase().endsWith('.pdf')) {
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'inline');
        res.setHeader('Cache-Control', 'public, max-age=300');
        res.removeHeader('X-Frame-Options');
      }
    },
  }),
);

app.use(errorHandlerMiddleware);
