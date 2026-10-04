import { Router, Request, Response, NextFunction } from 'express';
import { param, query as qv, validationResult } from 'express-validator';
import { query } from '../db/pool';
import { redis, RedisKeys } from '../db/redis';
import { authenticate, requireRole } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';

const router = Router();
router.use(authenticate);

// ─── GET /api/tracking/drivers/live ──────────────────────────────────────────
// Returns every on-shift driver for the org with their last known position.
// Source of truth for "who is on shift" is the DB (drivers.on_shift), NOT a
// Redis set — so drivers stay visible across reconnects and API/Redis restarts.
// Position comes from Redis (hot) and falls back to the latest persisted GPS row.
router.get('/drivers/live', requireRole('admin', 'dispatcher'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const drivers = await query<{ driver_id: number; driver_name: string }>(
        `SELECT d.id AS driver_id, u.name AS driver_name
         FROM drivers d
         JOIN users u ON u.id = d.user_id
         WHERE d.org_id = $1 AND d.on_shift = true`,
        [req.user!.orgId]
      );

      const positions = await Promise.all(
        drivers.map(async ({ driver_id, driver_name }) => {
          // 1. Hot path: last position cached in Redis
          const loc = await redis.hgetall(RedisKeys.driverLocation(driver_id));
          if (loc.lat) {
            return {
              driverId: driver_id,
              driverName: driver_name,
              lat: parseFloat(loc.lat),
              lng: parseFloat(loc.lng),
              speedMph: parseFloat(loc.speed ?? '0'),
              headingDeg: parseInt(loc.heading ?? '0', 10),
              accuracyM: parseInt(loc.accuracy ?? '50', 10),
              timestamp: new Date(parseInt(loc.updatedAt ?? '0', 10)).toISOString(),
            };
          }

          // 2. Fallback: most recent persisted GPS fix (e.g. after a Redis restart)
          const last = await query<{
            lat: string; lng: string; speed_mph: string | null;
            heading_deg: number | null; accuracy_m: number | null; recorded_at: Date;
          }>(
            `SELECT latitude AS lat, longitude AS lng, speed_mph, heading_deg, accuracy_m, recorded_at
             FROM driver_locations WHERE driver_id = $1
             ORDER BY recorded_at DESC LIMIT 1`,
            [driver_id]
          );
          const row = last[0];
          if (!row) return null; // on shift but never reported a position yet
          return {
            driverId: driver_id,
            driverName: driver_name,
            lat: parseFloat(row.lat),
            lng: parseFloat(row.lng),
            speedMph: row.speed_mph ? parseFloat(row.speed_mph) : 0,
            headingDeg: row.heading_deg ?? 0,
            accuracyM: row.accuracy_m ?? 50,
            timestamp: new Date(row.recorded_at).toISOString(),
          };
        })
      );

      res.json(positions.filter(Boolean));
    } catch (err) { next(err); }
  }
);

// ─── GET /api/tracking/trips/:tripId/route ────────────────────────────────────
// Returns the GPS breadcrumb trail for a completed or active trip
router.get('/trips/:tripId/route',
  requireRole('admin', 'dispatcher'),
  param('tripId').isInt(),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const locations = await query(
        `SELECT dl.latitude as lat, dl.longitude as lng, dl.speed_mph, dl.heading_deg,
                dl.recorded_at
         FROM driver_locations dl
         JOIN trips t ON t.id = dl.trip_id
         WHERE dl.trip_id = $1 AND t.org_id = $2
         ORDER BY dl.recorded_at ASC`,
        [req.params.tripId, req.user!.orgId]
      );
      res.json(locations);
    } catch (err) { next(err); }
  }
);

// ─── GET /api/tracking/drivers/:driverId/metrics ──────────────────────────────
router.get('/drivers/:driverId/metrics',
  requireRole('admin', 'dispatcher'),
  param('driverId').isInt(),
  qv('date').optional().isDate(),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const date = (req.query.date as string) || new Date().toISOString().slice(0, 10);

      const metrics = await query(
        `SELECT
           COUNT(CASE WHEN status = 'completed' THEN 1 END) as trips_completed,
           COUNT(CASE WHEN status = 'no_show' THEN 1 END) as no_shows,
           COUNT(CASE WHEN status = 'cancelled' THEN 1 END) as cancellations,
           ROUND(
             100.0 * COUNT(CASE WHEN status = 'completed'
               AND actual_pickup_at <= scheduled_pickup_at + INTERVAL '5 minutes'
             THEN 1 END)::numeric /
             NULLIF(COUNT(CASE WHEN status = 'completed' THEN 1 END), 0), 1
           ) as on_time_percent,
           SUM(COALESCE(distance_miles, 0)) as total_miles
         FROM trips t
         JOIN drivers d ON d.id = t.driver_id
         WHERE t.driver_id = $1
           AND t.org_id = $2
           AND DATE(t.scheduled_pickup_at AT TIME ZONE 'UTC') = $3`,
        [req.params.driverId, req.user!.orgId, date]
      );

      res.json(metrics[0] ?? {
        trips_completed: 0, no_shows: 0, cancellations: 0,
        on_time_percent: null, total_miles: 0,
      });
    } catch (err) { next(err); }
  }
);

export default router;
