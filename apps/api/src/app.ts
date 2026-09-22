import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

import { db } from './db/pool';
import { redis } from './db/redis';
import { auditMiddleware } from './middleware/audit';
import { errorHandler } from './middleware/errorHandler';

// Route imports
import authRoutes from './routes/auth';
import riderRoutes from './routes/riders';
import driverRoutes from './routes/drivers';
import tripRoutes from './routes/trips';
import importRoutes from './routes/import';
import importTripRoutes from './routes/importTrips';
import trackingRoutes from './routes/tracking';
import otpRoutes from './routes/otp';
import reportRoutes from './routes/reports';
import geocodeRoutes from './routes/geocode';

const app = express();

const corsOrigin = process.env.APP_BASE_URL || 'http://localhost:3000';

// ─── Express Middleware ──────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: corsOrigin,
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});
app.use('/api/', limiter);

// Stricter rate limit for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many auth attempts, please try again later.' },
});
app.use('/api/auth/', authLimiter);

// Audit logging middleware (logs authenticated requests)
app.use(auditMiddleware);

// ─── Routes ─────────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/riders', riderRoutes);
app.use('/api/drivers', driverRoutes);
app.use('/api/trips', tripRoutes);
app.use('/api/import', importRoutes);
app.use('/api/import/trips', importTripRoutes);
app.use('/api/tracking', trackingRoutes);
app.use('/api/otp', otpRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/geocode', geocodeRoutes);

// Health check
app.get('/api/health', async (_req, res) => {
  try {
    await db.query('SELECT 1');
    await redis.ping();
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(503).json({ status: 'error', message: 'Service unavailable' });
  }
});

// ─── Error Handler (must be last) ───────────────────────────────────────────
app.use(errorHandler);

export { app };
