import { Router, Request, Response, NextFunction } from 'express';
import { body, param, query as qv, validationResult } from 'express-validator';
import { query, queryOne } from '../db/pool';
import { authenticate, requireRole } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { io } from '../index';
import { logger } from '../lib/logger';

// ─── Nominatim geocoding (OpenStreetMap — free, no API key) ──────────────────
async function geocodeAddress(address: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'MidTransport/1.0 (nemt-dispatch)' },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const results = await res.json() as Array<{ lat: string; lon: string }>;
    if (!results.length) return null;
    return { lat: parseFloat(results[0].lat), lng: parseFloat(results[0].lon) };
  } catch {
    return null; // Geocoding failure is non-fatal — trip still saves
  }
}

const router = Router();
router.use(authenticate);

// ─── GET /api/trips ──────────────────────────────────────────────────────────
router.get('/',
  qv('status').optional().isString(),
  qv('date').optional().isDate(),
  qv('driverId').optional().isInt().toInt(),
  qv('page').optional().isInt({ min: 1 }).toInt(),
  qv('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { status, date, driverId, page = 1, limit = 50 } = req.query as {
        status?: string; date?: string; driverId?: number; page?: number; limit?: number;
      };
      const offset = (page - 1) * limit;

      let sql = `
        SELECT
          t.id, t.status, t.pickup_address, t.pickup_lat, t.pickup_lng,
          t.dropoff_address, t.dropoff_lat, t.dropoff_lng,
          t.scheduled_pickup_at, t.actual_pickup_at, t.actual_dropoff_at,
          t.mobility_type, t.dispatcher_notes, t.distance_miles,
          r.id as rider_id, r.name as rider_name, r.phone as rider_phone,
          d.id as driver_id,
          u.name as driver_name,
          v.name as vehicle_name, v.license_plate
        FROM trips t
        JOIN riders r ON r.id = t.rider_id
        LEFT JOIN drivers d ON d.id = t.driver_id
        LEFT JOIN users u ON u.id = d.user_id
        LEFT JOIN vehicles v ON v.id = t.vehicle_id
        WHERE t.org_id = $1
      `;
      const params: unknown[] = [req.user!.orgId];

      // Drivers only see their own trips
      if (req.user!.role === 'driver') {
        const driver = await queryOne<{ id: number }>(
          'SELECT id FROM drivers WHERE user_id = $1', [req.user!.userId]
        );
        if (driver) {
          params.push(driver.id);
          sql += ` AND t.driver_id = $${params.length}`;
        }
      } else if (driverId) {
        params.push(driverId);
        sql += ` AND t.driver_id = $${params.length}`;
      }

      if (status) {
        params.push(status);
        sql += ` AND t.status = $${params.length}::trip_status`;
      }
      if (date) {
        params.push(date);
        sql += ` AND DATE(t.scheduled_pickup_at AT TIME ZONE 'UTC') = $${params.length}`;
      }

      sql += ` ORDER BY t.scheduled_pickup_at ASC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
      params.push(limit, offset);

      const trips = await query(sql, params);
      res.json({ data: trips });
    } catch (err) { next(err); }
  }
);

// ─── GET /api/trips/:id ──────────────────────────────────────────────────────
router.get('/:id', param('id').isInt(), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const trip = await queryOne(
      `SELECT t.*,
         r.name as rider_name, r.phone as rider_phone, r.mobility_type as rider_mobility,
         u.name as driver_name, d.id as driver_id,
         v.name as vehicle_name, v.license_plate,
         (SELECT json_agg(oe ORDER BY oe.created_at DESC)
          FROM otp_events oe WHERE oe.trip_id = t.id) as otp_events
       FROM trips t
       JOIN riders r ON r.id = t.rider_id
       LEFT JOIN drivers d ON d.id = t.driver_id
       LEFT JOIN users u ON u.id = d.user_id
       LEFT JOIN vehicles v ON v.id = t.vehicle_id
       WHERE t.id = $1 AND t.org_id = $2`,
      [req.params.id, req.user!.orgId]
    );
    if (!trip) return next(new AppError('Trip not found', 404));
    res.json(trip);
  } catch (err) { next(err); }
});

// ─── POST /api/trips ─────────────────────────────────────────────────────────
router.post('/',
  requireRole('admin', 'dispatcher'),
  body('riderId').isInt(),
  body('pickupAddress').trim().notEmpty(),
  body('dropoffAddress').trim().notEmpty(),
  body('scheduledPickupAt').isISO8601(),
  body('mobilityType').optional().isIn(['standard', 'wheelchair', 'stretcher', 'bariatric']),
  body('driverId').optional().isInt(),
  body('vehicleId').optional().isInt(),
  body('dispatcherNotes').optional().trim().isLength({ max: 1000 }),
  async (req: Request, res: Response, next: NextFunction) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return next(new AppError(errors.array()[0].msg, 400));

    try {
      const {
        riderId, pickupAddress, dropoffAddress, scheduledPickupAt, scheduledDropoffAt,
        mobilityType, driverId, vehicleId, dispatcherNotes,
        pickupLat, pickupLng, dropoffLat, dropoffLng,
      } = req.body as Record<string, unknown>;

      // Verify rider belongs to org
      const rider = await queryOne<{ id: number }>(
        'SELECT id FROM riders WHERE id = $1 AND org_id = $2 AND is_active = true',
        [riderId, req.user!.orgId]
      );
      if (!rider) return next(new AppError('Rider not found', 404));

      const resolvedDriverId = driverId || null;
      const initialStatus = resolvedDriverId ? 'dispatched' : 'scheduled';

      // Geocode addresses (best-effort; non-blocking on failure)
      let resolvedPickupLat = pickupLat || null;
      let resolvedPickupLng = pickupLng || null;
      let resolvedDropoffLat = dropoffLat || null;
      let resolvedDropoffLng = dropoffLng || null;

      if (!resolvedPickupLat && pickupAddress) {
        const geo = await geocodeAddress(pickupAddress as string);
        if (geo) { resolvedPickupLat = geo.lat; resolvedPickupLng = geo.lng; }
        else logger.warn('Geocoding failed for pickup address', { pickupAddress });
      }
      if (!resolvedDropoffLat && dropoffAddress) {
        const geo = await geocodeAddress(dropoffAddress as string);
        if (geo) { resolvedDropoffLat = geo.lat; resolvedDropoffLng = geo.lng; }
        else logger.warn('Geocoding failed for dropoff address', { dropoffAddress });
      }

      const trip = await queryOne(
        `INSERT INTO trips (org_id, rider_id, driver_id, vehicle_id, pickup_address, pickup_lat, pickup_lng,
           dropoff_address, dropoff_lat, dropoff_lng, scheduled_pickup_at, scheduled_dropoff_at,
           mobility_type, dispatcher_notes, status, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::mobility_type,$14,$15::trip_status,$16)
         RETURNING *`,
        [req.user!.orgId, riderId, resolvedDriverId, vehicleId || null,
         pickupAddress, resolvedPickupLat, resolvedPickupLng,
         dropoffAddress, resolvedDropoffLat, resolvedDropoffLng,
         scheduledPickupAt, scheduledDropoffAt || null,
         mobilityType || 'standard', dispatcherNotes || null, initialStatus, req.user!.userId]
      );

      // Notify dispatcher map in real time
      io.to(`org:${req.user!.orgId}:dispatchers`).emit('trip:created', trip);

      res.status(201).json(trip);
    } catch (err) { next(err); }
  }
);

// ─── PUT /api/trips/:id ──────────────────────────────────────────────────────
router.put('/:id',
  requireRole('admin', 'dispatcher'),
  param('id').isInt(),
  body('pickupAddress').optional().trim().notEmpty(),
  body('dropoffAddress').optional().trim().notEmpty(),
  body('scheduledPickupAt').optional().isISO8601(),
  body('mobilityType').optional().isIn(['standard', 'wheelchair', 'stretcher', 'bariatric']),
  body('dispatcherNotes').optional().trim().isLength({ max: 1000 }),
  async (req: Request, res: Response, next: NextFunction) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return next(new AppError(errors.array()[0].msg, 400));

    try {
      const { pickupAddress, dropoffAddress, scheduledPickupAt, mobilityType, dispatcherNotes } =
        req.body as Record<string, string | undefined>;

      const updates: string[] = [];
      const values: unknown[] = [];

      const fieldMap: Record<string, string> = {
        pickupAddress: 'pickup_address',
        dropoffAddress: 'dropoff_address',
        scheduledPickupAt: 'scheduled_pickup_at',
        dispatcherNotes: 'dispatcher_notes',
      };

      Object.entries(fieldMap).forEach(([jsKey, sqlCol]) => {
        if (req.body[jsKey] !== undefined) {
          values.push(req.body[jsKey]);
          updates.push(`${sqlCol} = $${values.length}`);
        }
      });

      if (mobilityType !== undefined) {
        values.push(mobilityType);
        updates.push(`mobility_type = $${values.length}::mobility_type`);
      }

      if (updates.length === 0) return next(new AppError('No fields to update', 400));

      values.push(req.params.id, req.user!.orgId);
      const trip = await queryOne(
        `UPDATE trips SET ${updates.join(', ')}, updated_at = NOW()
         WHERE id = $${values.length - 1} AND org_id = $${values.length}
         RETURNING *`,
        values
      );

      if (!trip) return next(new AppError('Trip not found', 404));

      io.to(`org:${req.user!.orgId}:dispatchers`).emit('trip:updated', trip);
      res.json(trip);
    } catch (err) { next(err); }
  }
);

// ─── PATCH /api/trips/:id/status ─────────────────────────────────────────────
router.patch('/:id/status',
  param('id').isInt(),
  body('status').isIn([
    'scheduled', 'dispatched', 'en_route_pickup', 'arrived_pickup',
    'picked_up', 'en_route_dropoff', 'arrived_dropoff', 'completed',
    'cancelled', 'no_show',
  ]),
  async (req: Request, res: Response, next: NextFunction) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return next(new AppError('Invalid status', 400));

    try {
      const { status } = req.body as { status: string };
      const tripId = parseInt(req.params.id, 10);

      // Set actual timestamps based on status
      const timestampUpdates: string[] = [];
      if (status === 'picked_up') timestampUpdates.push('actual_pickup_at = NOW()');
      if (status === 'completed') timestampUpdates.push('actual_dropoff_at = NOW()');

      const setClause = ['status = $1::trip_status', ...timestampUpdates, 'updated_at = NOW()'].join(', ');

      const trip = await queryOne(
        `UPDATE trips SET ${setClause} WHERE id = $2 AND org_id = $3 RETURNING *`,
        [status, tripId, req.user!.orgId]
      );

      if (!trip) return next(new AppError('Trip not found', 404));

      // Broadcast status change to all dispatchers
      io.to(`org:${req.user!.orgId}:dispatchers`).emit('trip:status-changed', {
        tripId,
        status,
        timestamp: new Date().toISOString(),
      });

      res.json(trip);
    } catch (err) { next(err); }
  }
);

// ─── PATCH /api/trips/:id/assign ─────────────────────────────────────────────
router.patch('/:id/assign',
  requireRole('admin', 'dispatcher'),
  param('id').isInt(),
  body('driverId').isInt(),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { driverId } = req.body as { driverId: number };

      const trip = await queryOne(
        `UPDATE trips SET driver_id = $1, status = 'dispatched', updated_at = NOW()
         WHERE id = $2 AND org_id = $3 RETURNING *`,
        [driverId, req.params.id, req.user!.orgId]
      );

      if (!trip) return next(new AppError('Trip not found', 404));

      io.to(`org:${req.user!.orgId}:dispatchers`).emit('trip:assigned', {
        tripId: parseInt(req.params.id, 10),
        driverId,
        timestamp: new Date().toISOString(),
      });

      res.json(trip);
    } catch (err) { next(err); }
  }
);

export default router;
