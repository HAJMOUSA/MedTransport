import type { CanonicalTrip, ImportIssue, VendorProfileConfig } from '@midtransport/shared';
import { query, queryOne } from '../db/pool';
import { AppError } from '../middleware/errorHandler';
import { decodeCsv } from './importEngine/encoding';
import { parseCsv } from './importEngine/csvParse';
import { applyMapping } from './importEngine/mapping';
import { validateRows, ValidateContext } from './importEngine/validate';
import { requiredKeys } from './importEngine/canonical';

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

export async function loadProfileConfig(orgId: number, versionId: number): Promise<VendorProfileConfig> {
  const row = await queryOne<{ config: VendorProfileConfig }>(
    `SELECT v.config FROM vendor_profile_versions v
     JOIN vendor_profiles p ON p.id = v.profile_id
     WHERE v.id = $1 AND p.org_id = $2 AND p.is_active = true`,
    [versionId, orgId]
  );
  if (!row) throw new AppError('Vendor profile version not found', 404);
  return row.config;
}

export async function runAnalysis(
  orgId: number, uploadId: number, profileVersionId: number,
  mappingOverrides?: Record<string, string>
): Promise<AnalysisResult> {
  const uploadRow = await queryOne<{ content: Buffer; filename: string }>(
    'SELECT content, filename FROM import_uploads WHERE id = $1 AND org_id = $2 AND expires_at > NOW()',
    [uploadId, orgId]
  );
  if (!uploadRow) throw new AppError('Upload not found or expired — re-upload the file', 404);

  const config = await loadProfileConfig(orgId, profileVersionId);
  if (mappingOverrides) config.columnMap = { ...config.columnMap, ...mappingOverrides };

  const org = await queryOne<{ timezone: string }>('SELECT timezone FROM organizations WHERE id = $1', [orgId]);
  const { text } = decodeCsv(uploadRow.content);
  const parsed = parseCsv(text);
  const mapped = applyMapping(parsed, config, org?.timezone || 'America/New_York');

  // DB context: LOS codes + existing external IDs for this vendor
  const losRows = await query<{ code: string }>(
    'SELECT code FROM levels_of_service WHERE org_id = $1 AND is_active = true', [orgId]);
  const extIds = mapped.trips.map(t => t.externalTripId).filter((x): x is string => !!x);
  const dupRows = extIds.length > 0
    ? await query<{ external_trip_id: string }>(
        `SELECT external_trip_id FROM trips
         WHERE org_id = $1 AND external_trip_id = ANY($2)`,
        [orgId, extIds])
    : [];
  const ctx: ValidateContext = {
    levelOfServiceCodes: losRows.map(r => r.code),
    existingExternalIds: new Set(dupRows.map(r => r.external_trip_id)),
  };

  const validated = validateRows(mapped, requiredKeys(config.requiredOverrides), ctx);

  // Rider match estimate (read-only): match on lower(first)+lower(last)+dob, else phone
  const riders = await query<{ id: number; first_name: string | null; last_name: string | null; name: string; date_of_birth: string | null; phone: string }>(
    'SELECT id, first_name, last_name, name, date_of_birth, phone FROM riders WHERE org_id = $1 AND is_active = true', [orgId]);
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
  return {
    counts: { ...validated.counts, matchedRiders, newRiders },
    sample,
    notices: mapped.notices,
    issues: validated.issues.slice(0, 500),
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
