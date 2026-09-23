import { Router, Request, Response, NextFunction } from 'express';
import { body, validationResult } from 'express-validator';
import { authenticate, requireRole } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { query, queryOne } from '../db/pool';
import { isValidMappingTarget } from '../services/importEngine/canonical';

const router = Router();
router.use(authenticate);

function validateConfig(config: Record<string, unknown>): string | null {
  const required = ['headerSignature', 'columnMap', 'dateFormat', 'timeFormat', 'dateTimeFormat', 'timezone'];
  for (const k of required) if (config[k] === undefined) return `config.${k} is required`;
  if (!Array.isArray(config.headerSignature)) return 'config.headerSignature must be an array';
  const columnMap = config.columnMap as Record<string, string>;
  for (const [source, target] of Object.entries(columnMap)) {
    if (!isValidMappingTarget(target)) return `Invalid mapping target "${target}" for column "${source}"`;
  }
  return null;
}

// ─── GET /api/import/profiles ────────────────────────────────────────────────
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rows = await query(
      `SELECT p.id, p.name, p.is_active, p.created_at,
              (SELECT MAX(v.version) FROM vendor_profile_versions v WHERE v.profile_id = p.id) AS "latestVersion"
       FROM vendor_profiles p WHERE p.org_id = $1 ORDER BY p.name`,
      [req.user!.orgId]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// ─── POST /api/import/profiles (admin) ───────────────────────────────────────
router.post('/', requireRole('admin'),
  body('name').trim().notEmpty().isLength({ max: 200 }),
  body('config').isObject(),
  async (req: Request, res: Response, next: NextFunction) => {
    if (!validationResult(req).isEmpty()) return next(new AppError('name and config are required', 400));
    try {
      const invalid = validateConfig(req.body.config);
      if (invalid) return next(new AppError(invalid, 400));
      const profile = await queryOne<{ id: number }>(
        'INSERT INTO vendor_profiles (org_id, name, created_by) VALUES ($1, $2, $3) RETURNING id',
        [req.user!.orgId, req.body.name, req.user!.userId]
      );
      const version = await queryOne<{ id: number }>(
        'INSERT INTO vendor_profile_versions (profile_id, version, config, created_by) VALUES ($1, 1, $2, $3) RETURNING id',
        [profile!.id, JSON.stringify(req.body.config), req.user!.userId]
      );
      res.status(201).json({ profileId: profile!.id, versionId: version!.id });
    } catch (err) { next(err); }
  }
);

// ─── GET /api/import/profiles/:id ────────────────────────────────────────────
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const profile = await queryOne(
      'SELECT id, name, is_active FROM vendor_profiles WHERE id = $1 AND org_id = $2',
      [req.params.id, req.user!.orgId]
    );
    if (!profile) return next(new AppError('Profile not found', 404));
    const versions = await query(
      'SELECT id, version, created_at FROM vendor_profile_versions WHERE profile_id = $1 ORDER BY version DESC',
      [req.params.id]
    );
    const latest = await queryOne<{ config: unknown }>(
      'SELECT config FROM vendor_profile_versions WHERE profile_id = $1 ORDER BY version DESC LIMIT 1',
      [req.params.id]
    );
    res.json({ ...profile, versions, latestConfig: latest?.config ?? null });
  } catch (err) { next(err); }
});

// ─── POST /api/import/profiles/:id/versions (admin) ──────────────────────────
router.post('/:id/versions', requireRole('admin'),
  body('config').isObject(),
  async (req: Request, res: Response, next: NextFunction) => {
    if (!validationResult(req).isEmpty()) return next(new AppError('config is required', 400));
    try {
      const invalid = validateConfig(req.body.config);
      if (invalid) return next(new AppError(invalid, 400));
      const profile = await queryOne<{ id: number }>(
        'SELECT id FROM vendor_profiles WHERE id = $1 AND org_id = $2',
        [req.params.id, req.user!.orgId]
      );
      if (!profile) return next(new AppError('Profile not found', 404));
      const row = await queryOne<{ id: number; version: number }>(
        `INSERT INTO vendor_profile_versions (profile_id, version, config, created_by)
         VALUES ($1, (SELECT COALESCE(MAX(version), 0) + 1 FROM vendor_profile_versions WHERE profile_id = $1), $2, $3)
         RETURNING id, version`,
        [profile.id, JSON.stringify(req.body.config), req.user!.userId]
      );
      res.status(201).json({ versionId: row!.id, version: row!.version });
    } catch (err) { next(err); }
  }
);

export default router;
