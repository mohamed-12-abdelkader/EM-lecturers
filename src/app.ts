import express from 'express';
import { createServer } from 'http';
import { config, loggerMiddleware } from './utils';
import { errorHandlerMiddleware } from './middleware/errorHandler';
import { absoluteUrlResponseMiddleware } from './middleware/absoluteUrlResponse';
import cors from 'cors';
import { getCorsOriginDelegate, getServerInfo } from './config/appUrls';
import { router } from './routes';
import { tenantContextMiddleware } from './middleware/tenantContext';

export const app = express();
export const server = createServer(app);

// Parse JSON bodies; include text/plain because some clients (e.g. Postman "raw" default) send JSON with Content-Type: text/plain
app.use(express.json({ type: ['application/json', 'text/plain'] }));
app.use(express.urlencoded({ extended: true }));
app.use(cors(getCorsOriginDelegate()));
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

// Routes
app.use('/api', tenantContextMiddleware);
app.use('/api', router);
app.use('/uploads', express.static('uploads'));

app.use(errorHandlerMiddleware);
