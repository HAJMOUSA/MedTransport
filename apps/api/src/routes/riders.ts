import { Router, Request, Response, NextFunction } from 'express';
import { body, query as queryValidator, validationResult, param } from 'express-validator';
import { query, queryOne } from '../db/pool';
import { authenticate, requireRole } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';

const router = Router();
router.use(authenticate);

// ─── GET /api/riders ─────────────────────────────────────────────────────────
router.get('/',
  queryValidator('search').optional().isString().trim(),
  queryValidator('mobility_type').optional().isIn(['standard', 'wheelchair', 'stretcher', 'bariatric']),
  queryValidator('page').optional().isInt({ min: 1 }).toInt(),
  queryValidator('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { search, mobility_type, page = 1, limit = 50 } = req.query as {
        search?: string; mobility_type?: string; page?: number; limit?: number;
      };
      const offset = (page - 1) * limit;

      let sql = `
        SELECT id, name, phone, phone_alt, email, home_address, mobility_type,
               dispatcher_notes, emergency_contact, emergency_phone,
               insurance_id, insurance_name, is_active, created_at
        FROM riders
        WHERE org_id = $1 AND is_active = true
      `;
      const params: unknown[] = [req.user!.orgId];

      if (search) {
        params.push(`%${search}%`);
        sql += ` AND (name ILIKE $${params.length} OR phone ILIKE $${params.length})`;
      }
      if (mobility_type) {
        params.push(mobility_type);
        sql += ` AND mobility_type = $${params.length}::mobility_type`;
      }

      // Count total
      const countResult = await queryOne<{ count: string }>(
        `SELECT COUNT(*) as count FROM riders WHERE org_id = $1 AND is_active = true ${search ? 'AND (name ILIKE $2 OR phone ILIKE $2)' : ''}`,
        search ? [req.user!.orgId, `%${search}%`] : [req.user!.orgId]
      );

      sql += ` ORDER BY name ASC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
      params.push(limit, offset);

      const riders = await query(sql, params);

      const total = parseInt(countResult?.count ?? '0', 10);
      res.json({
        data: riders,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      });
    } catch (err) {
      next(err);
    }
  }
);

// ─── GET /api/riders/:id ─────────────────────────────────────────────────────
router.get('/:id', param('id').isInt(), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rider = await queryOne(
      `SELECT r.*,
        (SELECT COUNT(*) FROM trips t WHERE t.rider_id = r.id AND t.status = 'completed') as trips_completed,
        (SELECT MAX(t.scheduled_pickup_at) FROM trips t WHERE t.rider_id = r.id) as last_trip_at
       FROM riders r WHERE r.id = $1 AND r.org_id = $2`,
      [req.params.id, req.user!.orgId]
    );
    if (!rider) return next(new AppError('Rider not found', 404));
    res.json(rider);
  } catch (err) { next(err); }
});

// ─── POST /api/riders ────────────────────────────────────────────────────────
router.post('/',
  requireRole('admin', 'dispatcher'),
  body('name').trim().notEmpty().isLength({ max: 200 }),
  body('phone').trim().notEmpty().matches(/^[+\d\s\-().]{7,20}$/),
  body('phone_alt').optional().trim().matches(/^[+\d\s\-().]{7,20}$/),
  body('email').optional().isEmail().normalizeEmail(),
  body('home_address').optional().trim().isLength({ max: 500 }),
  body('mobility_type').optional().isIn(['standard', 'wheelchair', 'stretcher', 'bariatric']),
  body('emergency_contact').optional().trim().isLength({ max: 200 }),
  body('emergency_phone').optional().trim().matches(/^[+\d\s\-().]{7,20}$/),
  body('dispatcher_notes').optional().trim().isLength({ max: 1000 }),
  body('insurance_id').optional().trim().isLength({ max: 100 }),
  body('insurance_name').optional().trim().isLength({ max: 100 }),
  async (req: Request, res: Response, next: NextFunction) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return next(new AppError(errors.array()[0].msg, 400));

    try {
      const { name, phone, phone_alt, email, home_address, mobility_type,
        emergency_contact, emergency_phone, dispatcher_notes,
        insurance_id, insurance_name } = req.body as Record<string, string>;

      // Check for duplicate phone within org
      const existing = await queryOne(
        'SELECT id FROM riders WHERE org_id = $1 AND phone = $2 AND is_active = true',
        [req.user!.orgId, phone]
      );
      if (existing) return next(new AppError('A rider with this phone number already exists', 409));

      const rider = await queryOne(
        `INSERT INTO riders (org_id, name, phone, phone_alt, email, home_address, mobility_type,
           emergency_contact, emergency_phone, dispatcher_notes, insurance_id, insurance_name)
         VALUES ($1, $2, $3, $4, $5, $6, $7::mobility_type, $8, $9, $10, $11, $12)
         RETURNING *`,
        [req.user!.orgId, name, phone, phone_alt || null, email || null,
         home_address || null, mobility_type || 'standard',
         emergency_contact || null, emergency_phone || null, dispatcher_notes || null,
         insurance_id || null, insurance_name || null]
      );

      res.status(201).json(rider);
    } catch (err) { next(err); }
  }
);

// ─── PUT /api/riders/:id ─────────────────────────────────────────────────────
router.put('/:id',
  requireRole('admin', 'dispatcher'),
  param('id').isInt(),
  body('name').optional().trim().notEmpty().isLength({ max: 200 }),
  body('phone').optional().trim().matches(/^[+\d\s\-().]{7,20}$/),
  async (req: Request, res: Response, next: NextFunction) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return next(new AppError(errors.array()[0].msg, 400));

    try {
      // Ensure rider belongs to this org
      const existing = await queryOne<{ id: number }>(
        'SELECT id FROM riders WHERE id = $1 AND org_id = $2',
        [req.params.id, req.user!.orgId]
      );
      if (!existing) return next(new AppError('Rider not found', 404));

      const fields = ['name', 'phone', 'phone_alt', 'email', 'home_address',
        'mobility_type', 'emergency_contact', 'emergency_phone', 'dispatcher_notes',
        'insurance_id', 'insurance_name'];
      const updates: string[] = [];
      const values: unknown[] = [];

      const enumFields: Record<string, string> = { mobility_type: 'mobility_type' };
      fields.forEach((field) => {
        if (req.body[field] !== undefined) {
          values.push(req.body[field]);
          const cast = enumFields[field] ? `::${enumFields[field]}` : '';
          updates.push(`${field} = $${values.length}${cast}`);
        }
      });

      if (updates.length === 0) return next(new AppError('No fields to update', 400));

      values.push(req.params.id, req.user!.orgId);
      const rider = await queryOne(
        `UPDATE riders SET ${updates.join(', ')}, updated_at = NOW()
         WHERE id = $${values.length - 1} AND org_id = $${values.length}
         RETURNING *`,
        values
      );

      res.json(rider);
    } catch (err) { next(err); }
  }
);

// ─── DELETE /api/riders/:id (soft delete) ────────────────────────────────────
router.delete('/:id', requireRole('admin'), param('id').isInt(),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await queryOne(
        'UPDATE riders SET is_active = false, updated_at = NOW() WHERE id = $1 AND org_id = $2 RETURNING id',
        [req.params.id, req.user!.orgId]
      );
      if (!result) return next(new AppError('Rider not found', 404));
      res.json({ message: 'Rider archived successfully' });
    } catch (err) { next(err); }
  }
);

export default router;
