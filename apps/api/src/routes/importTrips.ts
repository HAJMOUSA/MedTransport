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

const router = Router();
router.use(authenticate, requireRole('admin', 'dispatcher'));

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

export default router;
