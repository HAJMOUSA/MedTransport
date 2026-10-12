import { Router, Request, Response, NextFunction } from 'express';
import { body, param, validationResult } from 'express-validator';
import multer from 'multer';
import path from 'path';
import { authenticate } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { verifyOtp, recordFallback } from '../services/otp';
import { query, queryOne } from '../db/pool';
import { getIo } from '../lib/io';

const router = Router();
router.use(authenticate);

// File upload for fallback photos
const upload = multer({
  dest: '/app/uploads/otp-photos/',
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
  fileFilter: (_req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.webp'];
    if (!allowed.includes(path.extname(file.originalname).toLowerCase())) {
      return cb(new Error('Only image files allowed'));
    }
    cb(null, true);
  },
});

// ─── POST /api/otp/:tripId/verify ────────────────────────────────────────────
router.post('/:tripId/verify',
  param('tripId').isInt(),
  body('code').trim().isLength({ min: 6, max: 6 }).isNumeric(),
  body('eventType').isIn(['pickup', 'dropoff']),
  body('lat').optional().isFloat({ min: -90, max: 90 }),
  body('lng').optional().isFloat({ min: -180, max: 180 }),
  async (req: Request, res: Response, next: NextFunction) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return next(new AppError('Invalid OTP format', 400));

    try {
      const tripId = parseInt(req.params.tripId, 10);
      const { code, eventType, lat, lng } = req.body as {
        code: string; eventType: 'pickup' | 'dropoff';
        lat?: number; lng?: number;
      };

      // Verify trip belongs to this org
      const trip = await queryOne<{ id: number; org_id: number }>(
        'SELECT id, org_id FROM trips WHERE id = $1 AND org_id = $2',
        [tripId, req.user!.orgId]
      );
      if (!trip) return next(new AppError('Trip not found', 404));

      const result = await verifyOtp(tripId, eventType, code, lat ?? null, lng ?? null);

      if (!result.success) {
        return res.status(400).json({ success: false, error: result.error });
      }

      // Pickup advances to picked_up. Dropoff does NOT complete here — the trip
      // is completed only after signature capture (PATCH /status enforces the gate).
      let newStatus: string;
      if (eventType === 'pickup') {
        newStatus = 'picked_up';
        await query(
          `UPDATE trips SET status = $1, actual_pickup_at = NOW(), updated_at = NOW() WHERE id = $2 AND org_id = $3`,
          [newStatus, tripId, req.user!.orgId]
        );
      } else {
        newStatus = 'arrived_dropoff';
        // Status stays arrived_dropoff; only record that dropoff OTP was verified.
        await query(
          `UPDATE trips SET updated_at = NOW() WHERE id = $1 AND org_id = $2`,
          [tripId, req.user!.orgId]
        );
      }

      // Notify dispatchers
      getIo().to(`org:${req.user!.orgId}:dispatchers`).emit('trip:otp-verified', {
        tripId,
        eventType,
        status: newStatus,
        timestamp: new Date().toISOString(),
      });

      res.json({ success: true, newStatus });
    } catch (err) { next(err); }
  }
);

// ─── POST /api/otp/:tripId/fallback ──────────────────────────────────────────
// When rider has no phone — driver takes a photo instead
router.post('/:tripId/fallback',
  param('tripId').isInt(),
  upload.single('photo'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tripId = parseInt(req.params.tripId, 10);
      const { eventType, lat, lng, riderPhone } = req.body as {
        eventType: 'pickup' | 'dropoff'; lat?: string; lng?: string; riderPhone?: string;
      };

      if (!req.file) return next(new AppError('Photo is required for fallback verification', 400));
      if (!eventType) return next(new AppError('eventType is required', 400));

      // Get driver ID
      const driver = await queryOne<{ id: number }>(
        'SELECT id FROM drivers WHERE user_id = $1', [req.user!.userId]
      );
      if (!driver) return next(new AppError('Driver profile not found', 404));

      const otpEventId = await recordFallback(
        tripId, driver.id, eventType as 'pickup' | 'dropoff',
        riderPhone ?? '', req.file.filename,
        lat ? parseFloat(lat) : null,
        lng ? parseFloat(lng) : null,
      );

      // Pickup advances; dropoff stays arrived_dropoff (completion happens after signature).
      let newStatus: string;
      if (eventType === 'pickup') {
        newStatus = 'picked_up';
        await query(
          `UPDATE trips SET status = $1, actual_pickup_at = NOW(), updated_at = NOW()
           WHERE id = $2 AND org_id = $3`,
          [newStatus, tripId, req.user!.orgId]
        );
      } else {
        newStatus = 'arrived_dropoff';
        await query(
          `UPDATE trips SET updated_at = NOW() WHERE id = $1 AND org_id = $2`,
          [tripId, req.user!.orgId]
        );
      }

      getIo().to(`org:${req.user!.orgId}:dispatchers`).emit('trip:otp-verified', {
        tripId,
        eventType,
        status: newStatus,
        fallback: true,
        timestamp: new Date().toISOString(),
      });

      res.json({ success: true, otpEventId, newStatus });
    } catch (err) { next(err); }
  }
);

// ─── GET /api/otp/:tripId/events ─────────────────────────────────────────────
router.get('/:tripId/events', param('tripId').isInt(),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const events = await query(
        `SELECT oe.id, oe.event_type, oe.status, oe.verified_at,
                oe.trigger_lat, oe.trigger_lng, oe.created_at, oe.expires_at,
                oe.photo_filename
         FROM otp_events oe
         JOIN trips t ON t.id = oe.trip_id
         WHERE oe.trip_id = $1 AND t.org_id = $2
         ORDER BY oe.created_at ASC`,
        [req.params.tripId, req.user!.orgId]
      );
      res.json(events);
    } catch (err) { next(err); }
  }
);

export default router;
