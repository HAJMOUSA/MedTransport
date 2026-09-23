import { Router, Request, Response, NextFunction } from 'express';
import { body, param, query as qv, validationResult } from 'express-validator';
import type { CanonicalTrip } from '@midtransport/shared';
import { query, queryOne } from '../db/pool';
import { authenticate, requireRole } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { getIo } from '../lib/io';
import { logger } from '../lib/logger';
import { geocodeAddress } from '../lib/geocode';
import { validateRows } from '../services/importEngine/validate';
import { requiredKeys } from '../services/importEngine/canonical';

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

// ─── GET /api/trips/lookups ──────────────────────────────────────────────────
// NOTE: must be registered before router.get('/:id') or 'lookups' is captured as :id.
router.get('/lookups', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const los = await query(
      'SELECT code, label FROM levels_of_service WHERE org_id = $1 AND is_active = true ORDER BY code',
      [req.user!.orgId]);
    res.json({ levelOfService: los, tripTypes: [
      { value: 'one_way', label: 'One way' },
      { value: 'round_trip', label: 'Round trip' },
      { value: 'multi_stop', label: 'Multi-stop' },
    ]});
  } catch (err) { next(err); }
});

// ─── POST /api/trips/validate-canonical ──────────────────────────────────────
// Shares the import engine's validation with manual entry (AC #7).
// Registered before router.get('/:id') for consistency (POST would not collide, but keep together).
router.post('/validate-canonical',
  requireRole('admin', 'dispatcher'),
  body('trip').isObject(),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { trip } = req.body as { trip: CanonicalTrip };
      const losRows = await query<{ code: string }>(
        'SELECT code FROM levels_of_service WHERE org_id = $1 AND is_active = true', [req.user!.orgId]);
      const { results } = validateRows(
        { trips: [trip], rowNumbers: [1], issues: [], notices: [] },
        requiredKeys(['external_trip_id']), // manual entry: external ref optional
        { levelOfServiceCodes: losRows.map(r => r.code), existingExternalIds: new Set() }
      );
      // duplicate warning: same rider name + same service date
      let duplicateWarning: { tripId: number; scheduledPickupAt: string } | null = null;
      if (trip.passengerFirstName && trip.passengerLastName && trip.pickupAt) {
        const dup = await queryOne<{ id: number; scheduled_pickup_at: string }>(
          `SELECT t.id, t.scheduled_pickup_at FROM trips t
           JOIN riders r ON r.id = t.rider_id
           WHERE t.org_id = $1
             AND LOWER(COALESCE(r.first_name, split_part(r.name, ' ', 1))) = LOWER($2)
             AND LOWER(COALESCE(r.last_name, split_part(r.name, ' ', 2))) = LOWER($3)
             AND DATE(t.scheduled_pickup_at AT TIME ZONE 'UTC') = DATE($4::timestamptz)
             AND t.status NOT IN ('cancelled') LIMIT 1`,
          [req.user!.orgId, trip.passengerFirstName, trip.passengerLastName, trip.pickupAt]
        );
        if (dup) duplicateWarning = { tripId: dup.id, scheduledPickupAt: dup.scheduled_pickup_at };
      }
      res.json({ valid: results[0].status !== 'invalid', issues: results[0].issues, duplicateWarning });
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
  // riderId is required only when no inline newRider payload is supplied.
  // (express-validator 7.3 has no .notExists(); a function condition is used instead.)
  body('riderId').if((_value, { req }) => !req.body.newRider).isInt(),
  body('pickupAddress').trim().notEmpty(),
  body('dropoffAddress').trim().notEmpty(),
  body('scheduledPickupAt').isISO8601(),
  body('mobilityType').optional().isIn(['standard', 'wheelchair', 'stretcher', 'bariatric']),
  body('driverId').optional().isInt(),
  body('vehicleId').optional().isInt(),
  body('dispatcherNotes').optional().trim().isLength({ max: 1000 }),
  // canonical fields (optional — shared model with CSV import)
  body('appointmentAt').optional().isISO8601(),
  body('levelOfService').optional().trim().isLength({ max: 20 }),
  body('additionalPassengers').optional().isInt({ min: 0 }).toInt(),
  body('assistanceNeeds').optional().trim().isLength({ max: 1000 }),
  body('tripType').optional().trim().isLength({ max: 50 }),
  body('externalTripId').optional().trim().isLength({ max: 100 }),
  // inline new rider (alternative to riderId)
  body('newRider').optional().isObject(),
  body('newRider.firstName').if(body('newRider').exists()).trim().notEmpty(),
  body('newRider.lastName').if(body('newRider').exists()).trim().notEmpty(),
  body('newRider.phone').if(body('newRider').exists()).trim().notEmpty(),
  body('newRider.dateOfBirth').optional().isDate(),
  body('newRider.medicalId').optional().trim().isLength({ max: 50 }),
  // optional return leg
  body('returnTrip').optional().isObject(),
  body('returnTrip.pickupAt').if(body('returnTrip').exists()).isISO8601(),
  body('returnTrip.appointmentAt').optional().isISO8601(),
  async (req: Request, res: Response, next: NextFunction) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return next(new AppError(errors.array()[0].msg, 400));

    try {
      const {
        riderId, pickupAddress, dropoffAddress, scheduledPickupAt, scheduledDropoffAt,
        mobilityType, driverId, vehicleId, dispatcherNotes,
        pickupLat, pickupLng, dropoffLat, dropoffLng,
        appointmentAt, levelOfService, additionalPassengers, assistanceNeeds,
        tripType, externalTripId, newRider, returnTrip,
      } = req.body as Record<string, unknown>;

      // Resolve rider: existing riderId, or insert an inline new rider
      let resolvedRiderId: number;
      if (newRider) {
        const nr = newRider as {
          firstName: string; lastName: string; phone: string;
          dateOfBirth?: string; medicalId?: string;
        };
        const inserted = await queryOne<{ id: number }>(
          `INSERT INTO riders (org_id, name, first_name, last_name, date_of_birth, medical_id, phone, home_address)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
          [req.user!.orgId, `${nr.firstName} ${nr.lastName}`.trim(), nr.firstName, nr.lastName,
           nr.dateOfBirth || null, nr.medicalId || null, nr.phone, pickupAddress]
        );
        resolvedRiderId = inserted!.id;
      } else {
        // Verify rider belongs to org
        const rider = await queryOne<{ id: number }>(
          'SELECT id FROM riders WHERE id = $1 AND org_id = $2 AND is_active = true',
          [riderId, req.user!.orgId]
        );
        if (!rider) return next(new AppError('Rider not found', 404));
        resolvedRiderId = rider.id;
      }

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
           mobility_type, dispatcher_notes, status, created_by,
           appointment_at, level_of_service, additional_passengers, assistance_needs, trip_type, external_trip_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::mobility_type,$14,$15::trip_status,$16,$17,$18,$19,$20,$21,$22)
         RETURNING *`,
        [req.user!.orgId, resolvedRiderId, resolvedDriverId, vehicleId || null,
         pickupAddress, resolvedPickupLat, resolvedPickupLng,
         dropoffAddress, resolvedDropoffLat, resolvedDropoffLng,
         scheduledPickupAt, scheduledDropoffAt || null,
         mobilityType || 'standard', dispatcherNotes || null, initialStatus, req.user!.userId,
         appointmentAt || null, levelOfService || null, additionalPassengers ?? 0,
         assistanceNeeds || null, tripType || null, externalTripId || null]
      );

      // Notify dispatcher map in real time
      getIo().to(`org:${req.user!.orgId}:dispatchers`).emit('trip:created', trip);

      // Optional return leg: swapped addresses, same rider + canonical fields, status 'scheduled'
      if (returnTrip) {
        const rt = returnTrip as { pickupAt: string; appointmentAt?: string };
        const returnNotes = dispatcherNotes ? `${dispatcherNotes} — Return leg` : 'Return leg';
        const returnLeg = await queryOne(
          `INSERT INTO trips (org_id, rider_id, pickup_address, pickup_lat, pickup_lng,
             dropoff_address, dropoff_lat, dropoff_lng, scheduled_pickup_at,
             mobility_type, dispatcher_notes, status, created_by,
             appointment_at, level_of_service, additional_passengers, assistance_needs, trip_type, external_trip_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::mobility_type,$11,'scheduled',$12,$13,$14,$15,$16,$17,$18)
           RETURNING *`,
          [req.user!.orgId, resolvedRiderId,
           dropoffAddress, resolvedDropoffLat, resolvedDropoffLng,
           pickupAddress, resolvedPickupLat, resolvedPickupLng,
           rt.pickupAt,
           mobilityType || 'standard', returnNotes, req.user!.userId,
           rt.appointmentAt || null, levelOfService || null, additionalPassengers ?? 0,
           assistanceNeeds || null, tripType || null, externalTripId || null]
        );
        getIo().to(`org:${req.user!.orgId}:dispatchers`).emit('trip:created', returnLeg);
      }

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

      getIo().to(`org:${req.user!.orgId}:dispatchers`).emit('trip:updated', trip);
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
      getIo().to(`org:${req.user!.orgId}:dispatchers`).emit('trip:status-changed', {
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

      getIo().to(`org:${req.user!.orgId}:dispatchers`).emit('trip:assigned', {
        tripId: parseInt(req.params.id, 10),
        driverId,
        timestamp: new Date().toISOString(),
      });

      res.json(trip);
    } catch (err) { next(err); }
  }
);

export default router;
