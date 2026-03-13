import { Router, Request, Response, NextFunction } from 'express';
import { body, param, validationResult } from 'express-validator';
import bcrypt from 'bcryptjs';
import { query, queryOne } from '../db/pool';
import { authenticate, requireRole } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';

const router = Router();
router.use(authenticate);

// ─── GET /api/drivers ────────────────────────────────────────────────────────
router.get('/', requireRole('admin', 'dispatcher'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const drivers = await query(
        `SELECT d.id, d.on_shift, d.shift_started_at, d.license_number, d.license_expiry,
                u.id as user_id, u.name, u.email, u.phone, u.is_active,
                v.id as vehicle_id, v.name as vehicle_name, v.license_plate, v.vehicle_type,
                (SELECT COUNT(*) FROM trips t
                 WHERE t.driver_id = d.id AND t.status = 'completed'
                   AND DATE(t.scheduled_pickup_at) = CURRENT_DATE) as trips_today
         FROM drivers d
         JOIN users u ON u.id = d.user_id
         LEFT JOIN vehicles v ON v.id = d.vehicle_id
         WHERE d.org_id = $1 AND u.is_active = true
         ORDER BY u.name ASC`,
        [req.user!.orgId]
      );
      res.json(drivers);
    } catch (err) { next(err); }
  }
);

// ─── POST /api/drivers ────────────────────────────────────────────────────────
// Creates a new user with role='driver' + driver profile
router.post('/',
  requireRole('admin'),
  body('name').trim().notEmpty().isLength({ max: 200 }),
  body('email').isEmail().normalizeEmail(),
  body('phone').trim().notEmpty(),
  body('password').isLength({ min: 8 }),
  body('licenseNumber').optional().trim(),
  body('licenseExpiry').optional().isDate(),
  body('vehicleId').optional().isInt(),
  async (req: Request, res: Response, next: NextFunction) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return next(new AppError(errors.array()[0].msg, 400));

    try {
      const { name, email, phone, password, licenseNumber, licenseExpiry, vehicleId } =
        req.body as Record<string, string>;

      const passwordHash = await bcrypt.hash(password, 12);

      // Create user
      const user = await queryOne<{ id: number }>(
        `INSERT INTO users (org_id, email, password_hash, name, role, phone)
         VALUES ($1, $2, $3, $4, 'driver', $5) RETURNING id`,
        [req.user!.orgId, email, passwordHash, name, phone]
      );

      // Create driver profile
      const driver = await queryOne(
        `INSERT INTO drivers (user_id, org_id, vehicle_id, license_number, license_expiry)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [user!.id, req.user!.orgId, vehicleId || null, licenseNumber || null, licenseExpiry || null]
      );

      res.status(201).json({ userId: user!.id, ...driver });
    } catch (err) { next(err); }
  }
);

// ─── PUT /api/drivers/:id ─────────────────────────────────────────────────────
router.put('/:id',
  requireRole('admin'),
  param('id').isInt(),
  body('phone').optional().trim(),
  body('licenseNumber').optional().trim(),
  body('licenseExpiry').optional().isDate(),
  async (req: Request, res: Response, next: NextFunction) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return next(new AppError(errors.array()[0].msg, 400));

    try {
      const { phone, licenseNumber, licenseExpiry } = req.body as Record<string, string | undefined>;

      // Update user phone if provided
      if (phone !== undefined) {
        await query(
          `UPDATE users SET phone = $1, updated_at = NOW()
           WHERE id = (SELECT user_id FROM drivers WHERE id = $2 AND org_id = $3)`,
          [phone, req.params.id, req.user!.orgId]
        );
      }

      // Update driver-specific fields
      const driverUpdates: string[] = [];
      const driverValues: unknown[] = [];

      if (licenseNumber !== undefined) {
        driverValues.push(licenseNumber);
        driverUpdates.push(`license_number = $${driverValues.length}`);
      }
      if (licenseExpiry !== undefined) {
        driverValues.push(licenseExpiry || null);
        driverUpdates.push(`license_expiry = $${driverValues.length}`);
      }

      if (driverUpdates.length > 0) {
        driverValues.push(req.params.id, req.user!.orgId);
        await query(
          `UPDATE drivers SET ${driverUpdates.join(', ')}
           WHERE id = $${driverValues.length - 1} AND org_id = $${driverValues.length}`,
          driverValues
        );
      }

      const driver = await queryOne(
        `SELECT d.id, d.on_shift, d.shift_started_at, d.license_number, d.license_expiry,
                u.id as user_id, u.name, u.email, u.phone, u.is_active,
                v.id as vehicle_id, v.name as vehicle_name, v.license_plate
         FROM drivers d
         JOIN users u ON u.id = d.user_id
         LEFT JOIN vehicles v ON v.id = d.vehicle_id
         WHERE d.id = $1 AND d.org_id = $2`,
        [req.params.id, req.user!.orgId]
      );

      if (!driver) return next(new AppError('Driver not found', 404));
      res.json(driver);
    } catch (err) { next(err); }
  }
);

export default router;
