import type { CanonicalTrip, DuplicatePolicy, ImportIssue, ImportMode, VendorProfileConfig } from '@midtransport/shared';
import { db, query, queryOne } from '../db/pool';
import { geocodeAddress } from '../lib/geocode';
import { logger } from '../lib/logger';
import { AppError } from '../middleware/errorHandler';
import { decodeCsv } from './importEngine/encoding';
import { parseCsv } from './importEngine/csvParse';
import { applyMapping } from './importEngine/mapping';
import { validateRows, ValidateContext } from './importEngine/validate';
import { requiredKeys } from './importEngine/canonical';
import { ERROR_GUIDANCE } from './importEngine/errors';

export interface MaskedSample {
  row: number; status: 'valid' | 'warning' | 'invalid';
  externalTripId: string | null; passengerName: string;
  primaryPhone: string; medicalId: string | null;
  pickupAt: string | null; pickupAddress: string; dropoffAddress: string;
}

export interface AnalysisResult {
  counts: { total: number; valid: number; warning: number; invalid: number; duplicates: number; newRiders: number; matchedRiders: number };
  sample: MaskedSample[];
  notices: string[];
  issues: ImportIssue[];          // capped at 500
  headers: string[];
  recognized: string[];
  unmapped: string[];
  config: VendorProfileConfig;    // effective config (for execute reuse)
  validated: ReturnType<typeof validateRows>['results']; // internal — execute reuses
}

export async function loadProfileConfig(orgId: number, versionId: number): Promise<{ config: VendorProfileConfig; profileId: number }> {
  const row = await queryOne<{ config: VendorProfileConfig; profileId: number }>(
    `SELECT v.config, p.id AS "profileId" FROM vendor_profile_versions v
     JOIN vendor_profiles p ON p.id = v.profile_id
     WHERE v.id = $1 AND p.org_id = $2 AND p.is_active = true`,
    [versionId, orgId]
  );
  if (!row) throw new AppError('Vendor profile version not found', 404);
  return row;
}

export async function runAnalysis(
  orgId: number, uploadId: number,
  resolved: { config: VendorProfileConfig; profileId: number | null },
  mappingOverrides?: Record<string, string>
): Promise<AnalysisResult> {
  const uploadRow = await queryOne<{ content: Buffer; filename: string }>(
    'SELECT content, filename FROM import_uploads WHERE id = $1 AND org_id = $2 AND expires_at > NOW()',
    [uploadId, orgId]
  );
  if (!uploadRow) throw new AppError('Upload not found or expired — re-upload the file', 404);

  const { config, profileId } = resolved;
  if (mappingOverrides) config.columnMap = { ...config.columnMap, ...mappingOverrides };

  const org = await queryOne<{ timezone: string }>('SELECT timezone FROM organizations WHERE id = $1', [orgId]);
  const { text, encoding } = decodeCsv(uploadRow.content);
  const parsed = parseCsv(text);
  const mapped = applyMapping(parsed, config, org?.timezone || 'America/New_York');

  // DB context: LOS codes + existing external IDs for this vendor profile.
  // Dedupe key is (org, vendor profile, external_trip_id) — manual-entry trips have
  // NULL source_vendor_profile_id and must never match. Profileless (inline-config)
  // imports carry profileId = null and dedupe only against other inline imports.
  const losRows = await query<{ code: string }>(
    'SELECT code FROM levels_of_service WHERE org_id = $1 AND is_active = true', [orgId]);
  const extIds = mapped.trips.map(t => t.externalTripId).filter((x): x is string => !!x);
  const dupRows = extIds.length > 0
    ? profileId === null
      ? await query<{ external_trip_id: string }>(
          `SELECT external_trip_id FROM trips
           WHERE org_id = $1 AND external_trip_id = ANY($2)
             AND source_vendor_profile_id IS NULL`,
          [orgId, extIds])
      : await query<{ external_trip_id: string }>(
          `SELECT external_trip_id FROM trips
           WHERE org_id = $1 AND external_trip_id = ANY($2)
             AND source_vendor_profile_id = $3`,
          [orgId, extIds, profileId])
    : [];
  const ctx: ValidateContext = {
    levelOfServiceCodes: losRows.map(r => r.code),
    existingExternalIds: new Set(dupRows.map(r => r.external_trip_id)),
  };

  const required = requiredKeys(config.requiredOverrides ?? []);
  const validated = validateRows(mapped, required, ctx);

  // Required canonical fields with no mapped source column can never produce a value —
  // surface one config-level issue per missing field (row 0; not counted per-row).
  const mappedTargets = new Set(Object.values(config.columnMap).map(t => t.split('.')[0]));
  // Engine falls back pickup_at ← appointment_at, so a mapped appointment_at covers pickup_at
  if (mappedTargets.has('appointment_at')) mappedTargets.add('pickup_at');
  const unmappedRequired: ImportIssue[] = [...required]
    .filter(key => !mappedTargets.has(key))
    .map(key => ({
      row: 0, sourceTripId: null, field: key,
      code: 'E_UNMAPPED_REQUIRED', guidance: ERROR_GUIDANCE.E_UNMAPPED_REQUIRED, severity: 'error',
    }));

  // Rider match estimate (read-only): match on lower(first)+lower(last)+dob, else phone
  const riders = await query<{ id: number; first_name: string | null; last_name: string | null; name: string; date_of_birth: string | null; phone: string }>(
    // date_of_birth::text — node-pg parses DATE into JS Date by default; cast guarantees 'YYYY-MM-DD'
    'SELECT id, first_name, last_name, name, date_of_birth::text AS date_of_birth, phone FROM riders WHERE org_id = $1 AND is_active = true', [orgId]);
  let matchedRiders = 0, newRiders = 0;
  for (const r of validated.results) {
    if (r.status === 'invalid') continue;
    const m = matchRider(riders, r.trip);
    if (m) matchedRiders++; else newRiders++;
  }

  const maskPhone = (p: string | null) => p ? `••••••${p.slice(-4)}` : '';
  const maskId = (m: string | null) => m ? `••••${m.slice(-2)}` : null;
  const fmtAddr = (a: { street: string; city: string; state: string; zip: string } | null) =>
    a ? [a.street, a.city, a.state, a.zip].filter(Boolean).join(', ') : '';

  const sample: MaskedSample[] = validated.results.slice(0, 10).map(r => ({
    row: r.row, status: r.status,
    externalTripId: r.trip.externalTripId,
    passengerName: [r.trip.passengerFirstName, r.trip.passengerLastName].filter(Boolean).join(' '),
    primaryPhone: maskPhone(r.trip.primaryPhone),
    medicalId: maskId(r.trip.medicalId),
    pickupAt: r.trip.pickupAt,
    pickupAddress: fmtAddr(r.trip.pickupAddress),
    dropoffAddress: fmtAddr(r.trip.dropoffAddress),
  }));

  const mappedSources = new Set(Object.keys(config.columnMap));
  const notices = encoding === 'windows-1252'
    ? ['Converted Windows-1252 file to UTF-8', ...mapped.notices]
    : mapped.notices;
  return {
    counts: { ...validated.counts, matchedRiders, newRiders },
    sample,
    notices,
    issues: [...unmappedRequired, ...validated.issues].slice(0, 500),
    headers: parsed.headers,
    recognized: parsed.headers.filter(h => mappedSources.has(h)),
    unmapped: parsed.headers.filter(h => !mappedSources.has(h)),
    config,
    validated: validated.results,
  };
}

export interface RiderRow {
  id: number; first_name: string | null; last_name: string | null;
  name: string; date_of_birth: string | null; phone: string;
}

export function matchRider(riders: RiderRow[], trip: CanonicalTrip): RiderRow | null {
  const first = (trip.passengerFirstName || '').toLowerCase();
  const last = (trip.passengerLastName || '').toLowerCase();
  const dob = trip.dateOfBirth;
  const phone = trip.primaryPhone?.replace(/\D/g, '');
  return riders.find(r => {
    const rFirst = (r.first_name || r.name.split(' ')[0] || '').toLowerCase();
    const rLast = (r.last_name || r.name.split(' ').slice(1).join(' ') || '').toLowerCase();
    if (first && last && rFirst === first && rLast === last) {
      if (dob && r.date_of_birth) return String(r.date_of_birth).slice(0, 10) === dob;
      return true;
    }
    return !!phone && r.phone.replace(/\D/g, '') === phone;
  }) ?? null;
}

// ─── Execute ───────────────────────────────────────────────────────────────

export interface ExecuteOptions {
  orgId: number; userId: number; userRole: string; uploadId: number;
  profileVersionId: number | null;    // null for profileless (inline-config) imports
  profileId: number | null;           // resolved vendor_profiles.id; null for inline imports
  config: VendorProfileConfig;        // resolved effective config (profile version or inline)
  mappingOverrides?: Record<string, string>;
  mode: ImportMode; duplicatePolicy: DuplicatePolicy;
  filename: string; fileHash: string;
}

export async function executeImport(opts: ExecuteOptions): Promise<number> {
  // Analyze fresh at execute time — upload/profile may have changed since preview
  const analysis = await runAnalysis(
    opts.orgId, opts.uploadId,
    { config: opts.config, profileId: opts.profileId },
    opts.mappingOverrides
  );
  const { validated } = analysis;

  const job = await queryOne<{ id: number }>(
    `INSERT INTO import_jobs (org_id, imported_by, import_type, filename, status, mode, file_hash, vendor_profile_version_id, duplicate_policy, total_rows)
     VALUES ($1, $2, 'trips', $3, 'processing', $4, $5, $6, $7, $8) RETURNING id`,
    [opts.orgId, opts.userId, opts.filename, opts.mode, opts.fileHash, opts.profileVersionId, opts.duplicatePolicy, analysis.counts.total]
  );
  const jobId = job!.id;

  if (opts.mode === 'test') {
    await finalizeJob(jobId, analysis, []);
    return jobId;
  }

  if (opts.mode === 'all_or_nothing' && analysis.counts.invalid > 0) {
    await query(
      `UPDATE import_jobs SET status = 'failed', error_rows = $1, errors = $2, completed_at = NOW() WHERE id = $3`,
      [analysis.counts.invalid, JSON.stringify(analysis.issues), jobId]
    );
    return jobId; // caller surfaces failed job with issues
  }

  const client = await db.connect();
  const tripIds: number[] = [];
  let created = 0, updated = 0, skipped = 0, duplicates = 0, failed = 0;
  const errors: unknown[] = [];

  try {
    await client.query('BEGIN');
    // date_of_birth::text — node-pg parses DATE into JS Date by default; cast guarantees 'YYYY-MM-DD'
    const riders = (await client.query(
      'SELECT id, first_name, last_name, name, date_of_birth::text AS date_of_birth, phone FROM riders WHERE org_id = $1 AND is_active = true',
      [opts.orgId]
    )).rows as RiderRow[];

    for (const row of validated) {
      const hasDupIssue = row.issues.some(i => i.code === 'E_DUPLICATE_IN_DB');
      const otherErrors = row.issues.filter(i => i.severity === 'error' && i.code !== 'E_DUPLICATE_IN_DB');

      if (otherErrors.length > 0) { failed++; errors.push(...otherErrors); continue; }

      if (hasDupIssue) {
        duplicates++;
        if (opts.duplicatePolicy === 'skip') { skipped++; continue; }
        if (opts.duplicatePolicy === 'reject') { failed++; errors.push(...row.issues.filter(i => i.code === 'E_DUPLICATE_IN_DB')); continue; }
        // 'update' falls through to the UPDATE branch below
      }

      // Rider match/create runs OUTSIDE the savepoint: if createRider fails it propagates
      // to the outer catch → full ROLLBACK → job failed. That failure is honest — don't swallow it.
      const rider = matchRider(riders, row.trip) ?? await createRider(client, opts.orgId, row.trip, riders);
      const t = row.trip;
      const pickupStr = fmtAddr(t.pickupAddress);
      const dropoffStr = fmtAddr(t.dropoffAddress);

      // Per-row savepoint: without it, one statement error aborts the whole transaction —
      // every later statement fails and COMMIT silently rolls back, leaving created>0 but zero trips.
      await client.query('SAVEPOINT row_write');
      try {
        if (hasDupIssue && opts.duplicatePolicy === 'update') {
          const upd = await client.query(
            `UPDATE trips SET rider_id=$1, pickup_address=$2, dropoff_address=$3,
               scheduled_pickup_at=$4, appointment_at=$5, level_of_service=$6,
               additional_passengers=$7, assistance_needs=$8, trip_type=$9,
               distance_miles=$10, dispatcher_notes=$11, will_call=$15,
               requested_vehicle_type=$16, updated_at=NOW()
             WHERE org_id=$12 AND source_vendor_profile_id=$13 AND external_trip_id=$14`,
            [rider.id, pickupStr, dropoffStr, t.pickupAt, t.appointmentAt, t.levelOfService,
             t.additionalPassengers, t.assistanceNeeds, t.tripType, t.distanceMiles, t.notes,
             opts.orgId, opts.profileId, t.externalTripId, t.willCall, t.requestedVehicleType]
          );
          await client.query('RELEASE SAVEPOINT row_write');
          // Safety net: the vendor-scoped analysis query guarantees the dup belongs to this
          // profile, so rowCount is 1 in practice — but if the row matched nothing (deleted
          // between analysis and execute), don't claim an update that never happened.
          if ((upd.rowCount ?? 0) > 0) updated++; else skipped++;
          continue;
        }

        const inserted = await client.query(
          `INSERT INTO trips (org_id, rider_id, pickup_address, dropoff_address,
             scheduled_pickup_at, appointment_at, status, mobility_type,
             external_trip_id, level_of_service, additional_passengers, assistance_needs,
             trip_type, distance_miles, dispatcher_notes, source_vendor_profile_id,
             import_job_id, created_by, will_call, requested_vehicle_type)
           VALUES ($1,$2,$3,$4,$5,$6,$7::trip_status,'standard',$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
           RETURNING id`,
          [opts.orgId, rider.id, pickupStr, dropoffStr,
           t.pickupAt ?? t.appointmentAt, t.appointmentAt, t.status ?? 'scheduled',
           t.externalTripId, t.levelOfService, t.additionalPassengers, t.assistanceNeeds,
           t.tripType, t.distanceMiles, t.notes, opts.profileId, jobId, opts.userId, t.willCall,
           t.requestedVehicleType]
        );
        await client.query('RELEASE SAVEPOINT row_write');
        tripIds.push(inserted.rows[0].id);
        created++;
      } catch (err) {
        await client.query('ROLLBACK TO SAVEPOINT row_write');
        failed++;
        errors.push({ row: row.row, sourceTripId: row.trip.externalTripId, code: 'E_INSERT', message: (err as Error).message });
      }
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    await query(`UPDATE import_jobs SET status = 'failed', completed_at = NOW() WHERE id = $1`, [jobId]);
    client.release();
    throw err;
  }
  client.release();

  await query(
    `UPDATE import_jobs SET status = 'completed', imported_rows = $1, updated_rows = $2,
       skipped_rows = $3, duplicate_rows = $4, error_rows = $5, errors = $6,
       result_trip_ids = $7, completed_at = NOW() WHERE id = $8`,
    [created, updated, skipped, duplicates, failed, JSON.stringify([...analysis.issues.filter(i => i.severity === 'error'), ...errors].slice(0, 1000)), tripIds, jobId]
  );

  // Audit: generated trip IDs recorded, no sensitive values
  await query(
    `INSERT INTO audit_log (org_id, user_id, user_role, entity_type, entity_id, action, details)
     VALUES ($1, $2, $3, 'import_job', $4, 'import_executed', $5)`,
    [opts.orgId, opts.userId, opts.userRole, jobId, JSON.stringify({ mode: opts.mode, created, updated, skipped, duplicates, failed, tripIds })]
  ).catch((err) => logger.warn('import audit write failed', { error: (err as Error).message }));

  // Best-effort background geocoding (throttled per Nominatim policy) — fire and forget
  geocodeImportedTrips(tripIds).catch(err => logger.warn('Background geocode failed', { error: err.message }));

  return jobId;
}

async function createRider(
  client: import('pg').PoolClient, orgId: number,
  t: CanonicalTrip, riders: RiderRow[]
): Promise<RiderRow> {
  const name = [t.passengerFirstName, t.passengerLastName].filter(Boolean).join(' ');
  const inserted = await client.query(
    `INSERT INTO riders (org_id, name, first_name, last_name, date_of_birth, medical_id, phone, phone_alt, home_address, dispatcher_notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING id, first_name, last_name, name, date_of_birth::text AS date_of_birth, phone`,
    [orgId, name, t.passengerFirstName, t.passengerLastName, t.dateOfBirth, t.medicalId,
     t.primaryPhone, t.alternatePhone, fmtAddr(t.pickupAddress),
     t.assistanceNeeds ? `Assistance: ${t.assistanceNeeds}` : null]
  );
  const row = inserted.rows[0] as RiderRow;
  riders.push(row); // subsequent rows for the same passenger match
  return row;
}

function fmtAddr(a: { street: string; city: string; state: string; zip: string } | null): string {
  return a ? [a.street, a.city, a.state, a.zip].filter(Boolean).join(', ') : '';
}

async function finalizeJob(jobId: number, analysis: AnalysisResult, tripIds: number[]): Promise<void> {
  await query(
    `UPDATE import_jobs SET status = 'completed', total_rows = $1, error_rows = $2, errors = $3, result_trip_ids = $4, completed_at = NOW() WHERE id = $5`,
    [analysis.counts.total, analysis.counts.invalid, JSON.stringify(analysis.issues.slice(0, 1000)), tripIds, jobId]
  );
}

async function geocodeImportedTrips(tripIds: number[]): Promise<void> {
  for (const id of tripIds) {
    const trip = await queryOne<{ pickup_address: string; dropoff_address: string }>(
      'SELECT pickup_address, dropoff_address FROM trips WHERE id = $1', [id]);
    if (!trip) continue;
    const p = await geocodeAddress(trip.pickup_address);
    const d = await geocodeAddress(trip.dropoff_address);
    if (p || d) {
      await query(
        `UPDATE trips SET pickup_lat = COALESCE($1, pickup_lat), pickup_lng = COALESCE($2, pickup_lng),
           dropoff_lat = COALESCE($3, dropoff_lat), dropoff_lng = COALESCE($4, dropoff_lng)
         WHERE id = $5`,
        [p?.lat ?? null, p?.lng ?? null, d?.lat ?? null, d?.lng ?? null, id]
      );
    }
    await new Promise(r => setTimeout(r, 1100)); // Nominatim 1 req/s policy
  }
}
