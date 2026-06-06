import express, { Request } from 'express';
import { createServer } from 'http';
import { config, loggerMiddleware } from './utils';
import { errorHandlerMiddleware } from './middleware/errorHandler';
import cors, { CorsOptionsDelegate } from 'cors';
import { router } from './routes';
import { tenantContextMiddleware } from './middleware/tenantContext';

const allowedOrigins = config.CORS_ORIGIN.split(',').map((origin) => origin.trim());

const corsOptionsDelegate: CorsOptionsDelegate<Request> = (req, callback) =>
  callback(null, {
    origin: allowedOrigins.includes(req.header('Origin') || ''),
    credentials: true,
  });

export const app = express();
export const server = createServer(app);

// Parse JSON bodies; include text/plain because some clients (e.g. Postman "raw" default) send JSON with Content-Type: text/plain
app.use(express.json({ type: ['application/json', 'text/plain'] }));
app.use(express.urlencoded({ extended: true }));
app.use(cors(corsOptionsDelegate));
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

// Routes
app.use('/api', tenantContextMiddleware);
app.use('/api', router);
app.use('/uploads', express.static('uploads'));

app.use(errorHandlerMiddleware);
