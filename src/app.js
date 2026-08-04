import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';

import { env } from './config/env.js';
import { UPLOAD_DIR } from './middleware/upload.js';
import { notFound, errorHandler } from './middleware/error.js';

import authRoutes from './routes/auth.routes.js';
import ticketRoutes from './routes/ticket.routes.js';
import userRoutes from './routes/user.routes.js';
import contactRoutes from './routes/contact.routes.js';
import statsRoutes from './routes/stats.routes.js';
import { serviceRouter, productRouter } from './routes/catalog.routes.js';

const app = express();

app.set('trust proxy', 1);

app.use(
  helmet({
    // Uploaded images are served from this origin but rendered by the
    // Next.js app on another one.
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);

const allowedOrigins = new Set([env.clientUrl, 'http://localhost:3000', 'http://127.0.0.1:3000']);
// Next.js hops to another port when 3000 is taken, so any localhost origin is
// accepted in development. Production stays locked to CLIENT_URL.
const isLocalhost = (origin) => /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (allowedOrigins.has(origin)) return callback(null, true);
      if (!env.isProd && isLocalhost(origin)) return callback(null, true);
      callback(new Error(`Origin ${origin} is not allowed by CORS`));
    },
    credentials: true,
  })
);

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(cookieParser());
app.use(compression());

if (!env.isProd) app.use(morgan('dev'));

app.use(
  '/api',
  rateLimit({
    windowMs: 60 * 1000,
    limit: 300,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { success: false, message: 'Too many requests. Please slow down.' },
  })
);

app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d' }));

/**
 * The public catalogue changes rarely, so let browsers reuse it for a minute
 * and serve a stale copy while revalidating. Anything behind auth stays
 * uncached.
 */
const publicCache = (req, res, next) => {
  if (req.method === 'GET') {
    res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
  }
  next();
};

app.get('/api/health', (_req, res) => {
  res.json({
    success: true,
    service: 'renderways-api',
    env: env.nodeEnv,
    time: new Date().toISOString(),
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/tickets', ticketRoutes);
app.use('/api/users', userRoutes);
app.use('/api/services', publicCache, serviceRouter);
app.use('/api/products', publicCache, productRouter);
app.use('/api/contact', contactRoutes);
app.use('/api/stats', statsRoutes);

app.use(notFound);
app.use(errorHandler);

export default app;
