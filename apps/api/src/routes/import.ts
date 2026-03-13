import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import Papa from 'papaparse';
import { authenticate, requireRole } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { query, queryOne } from '../db/pool';
import { logger } from '../lib/logger';

const router = Router();
router.use(authenticate, requireRole('admin', 'dispatcher'));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB max
  fileFilter: (_req, file, cb) => {
    if (file.mimetype !== 'text/csv' && !file.originalname.endsWith('.csv')) {
      return cb(new Error('Only CSV files allowed'));
    }
    cb(null, true);
  },
});

// ─── POST /api/import/riders ─────────────────────────────────────────────────
router.post('/riders', upload.single('file'), async (req: Request, res: Response, next: NextFunction) => {
  if (!req.file) return next(new AppError('CSV file is required', 400));

  const csvText = req.file.buffer.toString('utf-8');

  // Create import job
  const job = await queryOne<{ id: number }>(
    `INSERT INTO import_jobs (org_id, imported_by, import_type, filename, status)
     VALUES ($1, $2, 'riders', $3, 'processing') RETURNING id`,
    [req.user!.orgId, req.user!.userId, req.file.originalname]
  );

  const jobId = job!.id;

  // Parse and import asynchronously
  processRiderImport(csvText, req.user!.orgId, jobId).catch((err) => {
    logger.error('Rider import failed', { jobId, error: (err as Error).message });
  });

  res.status(202).json({
    message: 'Import started',
    jobId,
    statusUrl: `/api/import/jobs/${jobId}`,
  });
});

async function processRiderImport(csvText: string, orgId: number, jobId: number): Promise<void> {
  const { data } = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.toLowerCase().trim().replace(/\s+/g, '_'),
  });

  let imported = 0, skipped = 0, errors = 0;
  const errorList: Array<{ row: number; error: string }> = [];

  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const rowNum = i + 2; // +2 for header + 1-indexed

    const name = (row.name || row.full_name || row.patient_name || '').trim();
    const phone = (row.phone || row.phone_number || row.mobile || '').trim();

    if (!name || !phone) {
      errorList.push({ row: rowNum, error: `Missing required fields: name="${name}", phone="${phone}"` });
      errors++;
      continue;
    }

    // Check for duplicate
    const existing = await queryOne(
      'SELECT id FROM riders WHERE org_id = $1 AND phone = $2 AND is_active = true',
      [orgId, phone]
    );

    if (existing) {
      skipped++;
      continue;
    }

    try {
      await query(
        `INSERT INTO riders (org_id, name, phone, home_address, mobility_type,
           emergency_contact, dispatcher_notes, insurance_id, insurance_name)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          orgId, name, phone,
          row.address || row.home_address || null,
          ['standard', 'wheelchair', 'stretcher', 'bariatric'].includes(row.mobility_type?.toLowerCase())
            ? row.mobility_type.toLowerCase() : 'standard',
          row.emergency_contact || null,
          row.notes || row.dispatcher_notes || null,
          row.insurance_id || row.member_id || row.medicaid_id || null,
          row.insurance_name || row.insurer || row.payer || null,
        ]
      );
      imported++;
    } catch (err) {
      errorList.push({ row: rowNum, error: (err as Error).message });
      errors++;
    }
  }

  // Update job status
  await query(
    `UPDATE import_jobs
     SET status = 'completed', total_rows = $1, imported_rows = $2,
         skipped_rows = $3, error_rows = $4, errors = $5, completed_at = NOW()
     WHERE id = $6`,
    [data.length, imported, skipped, errors, JSON.stringify(errorList), jobId]
  );

  logger.info('Rider import completed', { jobId, imported, skipped, errors });
}

// ─── GET /api/import/jobs/:id ────────────────────────────────────────────────
router.get('/jobs/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const job = await queryOne(
      'SELECT * FROM import_jobs WHERE id = $1 AND org_id = $2',
      [req.params.id, req.user!.orgId]
    );
    if (!job) return next(new AppError('Import job not found', 404));
    res.json(job);
  } catch (err) { next(err); }
});

// ─── GET /api/import/template/riders ─────────────────────────────────────────
router.get('/template/riders', (_req, res) => {
  const csv = [
    'name,phone,address,mobility_type,emergency_contact,notes,insurance_id,insurance_name',
    'Maria Rodriguez,+15551234567,"123 Main St, Springfield IL 62701",standard,Pedro Rodriguez +15559876543,Prefers side entrance,1234567890A,Medicaid',
    'James Thompson,+15552345678,"456 Oak Ave, Springfield IL 62702",wheelchair,,,MCR-9876543,Medicare',
    'Linda Martinez,+15553456789,"789 Pine Rd, Springfield IL 62703",standard,,,,' ,
  ].join('\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="midtransport-riders-template.csv"');
  res.send(csv);
});

export default router;
