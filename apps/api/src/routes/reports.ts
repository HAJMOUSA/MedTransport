import { Router, Request, Response, NextFunction } from 'express';
import { query as qv } from 'express-validator';
import { query } from '../db/pool';
import { authenticate, requireRole } from '../middleware/auth';

const router = Router();
router.use(authenticate, requireRole('admin', 'dispatcher'));

// ─── GET /api/reports/summary ─────────────────────────────────────────────────
router.get('/summary',
  qv('startDate').optional().isDate(),
  qv('endDate').optional().isDate(),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const start = (req.query.startDate as string) || new Date().toISOString().slice(0, 10);
      const end   = (req.query.endDate as string) || start;

      const [tripSummary, otpSummary, driverSummary] = await Promise.all([
        // Trip stats
        query(
          `SELECT
             COUNT(*) as total_trips,
             COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
             COUNT(CASE WHEN status = 'cancelled' THEN 1 END) as cancelled,
             COUNT(CASE WHEN status = 'no_show' THEN 1 END) as no_shows,
             ROUND(AVG(EXTRACT(EPOCH FROM (actual_pickup_at - scheduled_pickup_at))/60)::numeric, 1) as avg_delay_minutes,
             ROUND(SUM(COALESCE(distance_miles, 0))::numeric, 1) as total_miles
           FROM trips
           WHERE org_id = $1
             AND DATE(scheduled_pickup_at AT TIME ZONE 'UTC') BETWEEN $2 AND $3`,
          [req.user!.orgId, start, end]
        ),

        // OTP verification rate
        query(
          `SELECT
             COUNT(*) as total_otp_events,
             COUNT(CASE WHEN status = 'verified' THEN 1 END) as verified,
             COUNT(CASE WHEN status = 'fallback_photo' THEN 1 END) as fallback_photos,
             COUNT(CASE WHEN status = 'expired' THEN 1 END) as expired
           FROM otp_events oe
           JOIN trips t ON t.id = oe.trip_id
           WHERE t.org_id = $1
             AND DATE(oe.created_at AT TIME ZONE 'UTC') BETWEEN $2 AND $3`,
          [req.user!.orgId, start, end]
        ),

        // Driver breakdown
        query(
          `SELECT
             u.name as driver_name,
             COUNT(CASE WHEN t.status = 'completed' THEN 1 END) as completed,
             ROUND(100.0 * COUNT(CASE WHEN t.status = 'completed'
               AND t.actual_pickup_at <= t.scheduled_pickup_at + INTERVAL '5 minutes'
             THEN 1 END)::numeric /
             NULLIF(COUNT(CASE WHEN t.status = 'completed' THEN 1 END), 0), 1) as on_time_pct
           FROM drivers d
           JOIN users u ON u.id = d.user_id
           LEFT JOIN trips t ON t.driver_id = d.id
             AND DATE(t.scheduled_pickup_at AT TIME ZONE 'UTC') BETWEEN $2 AND $3
           WHERE d.org_id = $1
           GROUP BY u.name
           ORDER BY completed DESC`,
          [req.user!.orgId, start, end]
        ),
      ]);

      res.json({
        trips: tripSummary[0],
        otp: otpSummary[0],
        drivers: driverSummary,
        period: { start, end },
      });
    } catch (err) { next(err); }
  }
);

export default router;
