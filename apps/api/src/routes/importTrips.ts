import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import crypto from 'crypto';
import { body, validationResult } from 'express-validator';
import { authenticate, requireRole } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { query, queryOne } from '../db/pool';
import { decodeCsv } from '../services/importEngine/encoding';
import { parseCsv, CsvStructureError } from '../services/importEngine/csvParse';
import { detectProfile, ProfileCandidate } from '../services/importEngine/profiles';
import { executeImport, runAnalysis } from '../services/importRunner';
import { CANONICAL_FIELDS } from '../services/importEngine/canonical';

const router = Router();
router.use(authenticate, requireRole('admin', 'dispatcher'));

// ─── GET /api/import/trips/canonical-fields ─────────────────────────────────
// Registered before any /:id param routes so it isn't captured as an id.
router.get('/canonical-fields', (_req: Request, res: Response) => {
  res.json(CANONICAL_FIELDS);
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.originalname.toLowerCase().endsWith('.csv')) return cb(null, false);
    cb(null, true);
  },
});

// Lazy cleanup of expired uploads (no cron needed)
async function purgeExpiredUploads(): Promise<void> {
  await query('DELETE FROM import_uploads WHERE expires_at < NOW()');
}

// ─── POST /api/import/trips/upload ───────────────────────────────────────────
router.post('/upload', upload.single('file'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.file) return next(new AppError('CSV file is required (.csv only)', 400));

    const { text, encoding } = decodeCsv(req.file.buffer);
    let parsed;
    try {
      parsed = parseCsv(text);
    } catch (err) {
      if (err instanceof CsvStructureError) return next(new AppError(err.message, 400));
      throw err;
    }

    const sha256 = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
    await purgeExpiredUploads();
    const staged = await queryOne<{ id: number }>(
      `INSERT INTO import_uploads (org_id, uploaded_by, filename, sha256, content, detected_encoding, row_count, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW() + INTERVAL '2 hours') RETURNING id`,
      [req.user!.orgId, req.user!.userId, req.file.originalname, sha256, req.file.buffer, encoding, parsed.rows.length]
    );

    // Auto-detect vendor profile by header signature
    const candidates = await query<ProfileCandidate & { config: unknown }>(
      `SELECT p.id AS "profileId", v.id AS "versionId", p.name,
              v.config->'headerSignature' AS "headerSignature"
       FROM vendor_profiles p
       JOIN vendor_profile_versions v ON v.profile_id = p.id
       WHERE p.org_id = $1 AND p.is_active = true
         AND v.version = (SELECT MAX(version) FROM vendor_profile_versions WHERE profile_id = p.id)`,
      [req.user!.orgId]
    );
    const detection = detectProfile(parsed.headers, candidates);

    res.status(201).json({
      uploadId: staged!.id,
      filename: req.file.originalname,
      sha256,
      encoding,
      delimiter: ',',
      headers: parsed.headers,
      rowCount: parsed.rows.length,
      detectedProfile: detection,
    });
  } catch (err) { next(err); }
});

// ─── POST /api/import/trips/analyze ──────────────────────────────────────────
router.post('/analyze',
  body('uploadId').isInt(), body('profileVersionId').isInt(),
  body('mappingOverrides').optional().isObject(),
  async (req: Request, res: Response, next: NextFunction) => {
    if (!validationResult(req).isEmpty()) return next(new AppError('uploadId and profileVersionId are required', 400));
    try {
      const { uploadId, profileVersionId, mappingOverrides } = req.body;
      const result = await runAnalysis(req.user!.orgId, uploadId, profileVersionId, mappingOverrides);
      const { validated, config, ...publicResult } = result; // don't leak full trips in preview
      res.json(publicResult);
    } catch (err) { next(err); }
  }
);

// ─── POST /api/import/trips/execute ────────────────────────────────────────
router.post('/execute',
  body('uploadId').isInt(), body('profileVersionId').isInt(), body('profileId').isInt(),
  body('mode').isIn(['test', 'all_or_nothing', 'valid_rows_only']),
  body('duplicatePolicy').isIn(['skip', 'reject', 'update']),
  body('mappingOverrides').optional().isObject(),
  async (req: Request, res: Response, next: NextFunction) => {
    if (!validationResult(req).isEmpty()) return next(new AppError('Missing or invalid execute parameters', 400));
    try {
      const { uploadId, profileVersionId, profileId, mode, duplicatePolicy, mappingOverrides } = req.body;
      if ((mode === 'all_or_nothing' || duplicatePolicy === 'update') && req.user!.role !== 'admin') {
        return next(new AppError('All-or-nothing mode and update policy require an administrator', 403));
      }
      const uploadRow = await queryOne<{ filename: string; sha256: string }>(
        'SELECT filename, sha256 FROM import_uploads WHERE id = $1 AND org_id = $2 AND expires_at > NOW()',
        [uploadId, req.user!.orgId]
      );
      if (!uploadRow) return next(new AppError('Upload not found or expired — re-upload the file', 404));

      const jobId = await executeImport({
        orgId: req.user!.orgId, userId: req.user!.userId, userRole: req.user!.role,
        uploadId, profileVersionId, profileId, mappingOverrides,
        mode, duplicatePolicy, filename: uploadRow.filename, fileHash: uploadRow.sha256,
      });
      res.status(202).json({ jobId, statusUrl: `/api/import/trips/jobs/${jobId}` });
    } catch (err) { next(err); }
  }
);

// ─── GET /api/import/trips/jobs/:id ─────────────────────────────────────────
router.get('/jobs/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const job = await queryOne(
      `SELECT id, status, mode, duplicate_policy, filename, total_rows, imported_rows, updated_rows,
              skipped_rows, duplicate_rows, error_rows, created_at, completed_at
       FROM import_jobs WHERE id = $1 AND org_id = $2 AND import_type = 'trips'`,
      [req.params.id, req.user!.orgId]
    );
    if (!job) return next(new AppError('Import job not found', 404));
    res.json(job);
  } catch (err) { next(err); }
});

// ─── GET /api/import/trips/jobs/:id/errors.csv ──────────────────────────────
router.get('/jobs/:id/errors.csv', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const job = await queryOne<{ errors: Array<{ row?: number; sourceTripId?: string | null; field?: string | null; code?: string; guidance?: string; message?: string }> }>(
      `SELECT errors FROM import_jobs WHERE id = $1 AND org_id = $2 AND import_type = 'trips'`,
      [req.params.id, req.user!.orgId]
    );
    if (!job) return next(new AppError('Import job not found', 404));
    const cell = (v: unknown): string => {
      let s = String(v ?? '');
      // Neutralize spreadsheet-formula prefixes (spec: notes/export safety)
      if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
      return `"${s.replace(/"/g, '""')}"`;
    };
    const lines = ['row,source_trip_id,field,code,guidance'];
    for (const e of job.errors ?? []) {
      lines.push([cell(e.row), cell(e.sourceTripId), cell(e.field), cell(e.code), cell(e.guidance ?? e.message)].join(','));
    }
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="import-${req.params.id}-errors.csv"`);
    res.send(lines.join('\n'));
  } catch (err) { next(err); }
});

export default router;
