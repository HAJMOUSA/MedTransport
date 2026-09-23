import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import type { CanonicalTrip } from '@midtransport/shared';

const { queryMock, queryOneMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  queryOneMock: vi.fn(),
}));
vi.mock('../src/db/pool', () => ({ query: queryMock, queryOne: queryOneMock }));

import { runAnalysis, matchRider, loadProfileConfig } from '../src/services/importRunner';
import type { RiderRow } from '../src/services/importRunner';
import { AppError } from '../src/middleware/errorHandler';
import { VENDOR_A_PROFILE } from './fixtures/profiles';

const buf = fs.readFileSync(path.join(__dirname, './fixtures/vendor-a.csv'));

const LOS = [{ code: 'AMB' }, { code: 'STR' }, { code: 'WCH' }];

// Resolved config the routes would hand to runAnalysis for profile version 20 (profile 30)
const resolved = () => ({ config: structuredClone(VENDOR_A_PROFILE), profileId: 30 });

function mockDb(riders: RiderRow[], opts?: { existingExtIds?: string[]; content?: Buffer }) {
  queryOneMock.mockImplementation((sql: string) => {
    if (sql.includes('FROM import_uploads')) return Promise.resolve({ content: opts?.content ?? buf, filename: 'vendor-a.csv' });
    if (sql.includes('FROM vendor_profile_versions')) return Promise.resolve({ config: structuredClone(VENDOR_A_PROFILE), profileId: 30 });
    if (sql.includes('FROM organizations')) return Promise.resolve({ timezone: 'America/New_York' });
    return Promise.resolve(null);
  });
  queryMock.mockImplementation((sql: string) => {
    if (sql.includes('FROM levels_of_service')) return Promise.resolve(LOS);
    if (sql.includes('FROM trips')) return Promise.resolve((opts?.existingExtIds ?? []).map(id => ({ external_trip_id: id })));
    if (sql.includes('FROM riders')) return Promise.resolve(riders);
    return Promise.resolve([]);
  });
}

const MATCHING_RIDER: RiderRow = {
  id: 1, first_name: 'FakeFirst', last_name: 'FakeLast', name: 'FakeFirst FakeLast',
  date_of_birth: '1950-01-15', phone: '(313) 555-0001',
};

beforeEach(() => {
  queryMock.mockReset();
  queryOneMock.mockReset();
});

describe('runAnalysis', () => {
  it('runs full pipeline: counts, masked sample, recognized/unmapped headers', async () => {
    mockDb([MATCHING_RIDER]);
    const result = await runAnalysis(1, 10, resolved());

    expect(result.counts.total).toBe(3);
    expect(result.counts.valid).toBe(1);
    expect(result.counts.invalid).toBe(2);
    expect(result.counts.matchedRiders).toBe(1); // only the valid row participates
    expect(result.counts.newRiders).toBe(0);

    // sample masking
    expect(result.sample.length).toBeLessThanOrEqual(10);
    const s1 = result.sample[0];
    expect(s1.status).toBe('valid');
    expect(s1.passengerName).toBe('FakeFirst FakeLast');
    expect(s1.primaryPhone).toBe('••••••0001');
    expect(s1.medicalId).toBe('••••4A');
    expect(s1.pickupAddress).toBe('123 Main St, Detroit, MI, 48201');

    // headers recognized/unmapped from columnMap keys
    const mapped = new Set(Object.keys(VENDOR_A_PROFILE.columnMap));
    expect(result.recognized.every(h => mapped.has(h))).toBe(true);
    expect(result.unmapped.every(h => !mapped.has(h))).toBe(true);
    expect(result.recognized).toContain('Trip Number');
    expect(result.unmapped).toContain('Manifest Number');
    expect([...result.recognized, ...result.unmapped].sort()).toEqual([...result.headers].sort());

    // issues capped and internal fields present for execute reuse
    expect(result.issues.length).toBeLessThanOrEqual(500);
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.validated).toHaveLength(3);
    expect(result.config.columnMap['Trip Number']).toBe('external_trip_id');
  });

  it('counts newRiders when no rider matches', async () => {
    mockDb([]);
    const result = await runAnalysis(1, 10, resolved());
    expect(result.counts.matchedRiders).toBe(0);
    expect(result.counts.newRiders).toBe(1); // invalid rows excluded from matching
  });

  it('flags duplicates already in DB', async () => {
    mockDb([], { existingExtIds: ['FAKE-A-001'] });
    const result = await runAnalysis(1, 10, resolved());
    expect(result.counts.duplicates).toBeGreaterThan(0);
    expect(result.issues.some(i => i.code === 'E_DUPLICATE_IN_DB')).toBe(true);
  });

  it('applies mapping overrides to config and recognized headers', async () => {
    mockDb([]);
    const result = await runAnalysis(1, 10, resolved(), { 'Trip Reason': 'notes' });
    expect(result.config.columnMap['Trip Reason']).toBe('notes');
    expect(result.recognized).toContain('Trip Reason');
    expect(result.unmapped).not.toContain('Trip Reason');
  });

  it('404s when upload is missing or expired', async () => {
    queryOneMock.mockResolvedValue(null);
    await expect(runAnalysis(1, 99, resolved())).rejects.toMatchObject({ statusCode: 404 });
    await expect(runAnalysis(1, 99, resolved())).rejects.toBeInstanceOf(AppError);
  });

  it('prepends E_UNMAPPED_REQUIRED (row 0) for required fields with no mapped source column', async () => {
    mockDb([]);
    const config = structuredClone(VENDOR_A_PROFILE);
    for (const k of Object.keys(config.columnMap)) {
      if (config.columnMap[k].split('.')[0] === 'primary_phone') delete config.columnMap[k];
    }
    const result = await runAnalysis(1, 10, { config, profileId: 30 });

    const unmapped = result.issues.filter(i => i.code === 'E_UNMAPPED_REQUIRED');
    // vendor-a maps no pickup_at column either (appointment fallback), so both are flagged
    expect(unmapped.map(i => i.field).sort()).toEqual(['pickup_at', 'primary_phone'].sort());
    for (const i of unmapped) {
      expect(i.row).toBe(0);
      expect(i.sourceTripId).toBeNull();
      expect(i.severity).toBe('error');
      expect(i.guidance).toBeTruthy();
    }
    expect(result.issues[0].code).toBe('E_UNMAPPED_REQUIRED'); // prepended ahead of per-row issues

    // row-0 issues don't inflate per-row counts: still 3 rows, all invalid
    // (row 1 now also fails its own E_REQUIRED_FIELD for primary_phone)
    expect(result.counts.total).toBe(3);
    expect(result.counts.invalid).toBe(3);
  });

  it('prepends a conversion notice when the upload is windows-1252', async () => {
    // Smart quotes as raw 0x93/0x94 bytes force windows-1252 detection (invalid UTF-8)
    const win1252 = Buffer.from(
      buf.toString('utf8')
        .replace('Dialysis - bring chart', 'Dialysis \u201Cbring chart\u201D')
        .replace(/\u201C/g, '\x93').replace(/\u201D/g, '\x94'),
      'latin1'
    );
    mockDb([], { content: win1252 });
    const result = await runAnalysis(1, 10, resolved());
    expect(result.notices[0]).toBe('Converted Windows-1252 file to UTF-8');
    expect(result.counts.total).toBe(3); // pipeline still parses fully
  });

  it('profileless (profileId: null) analysis dedupes only against other profileless imports', async () => {
    mockDb([], { existingExtIds: ['FAKE-A-001'] });
    const result = await runAnalysis(1, 10, { config: structuredClone(VENDOR_A_PROFILE), profileId: null });
    const dupCall = queryMock.mock.calls.find(c => String(c[0]).includes('external_trip_id = ANY'))!;
    expect(String(dupCall[0])).toContain('source_vendor_profile_id IS NULL');
    expect(dupCall[1] as unknown[]).toHaveLength(2); // org + ext ids only — no profile param
    expect(result.counts.duplicates).toBeGreaterThan(0);
  });
});

describe('loadProfileConfig', () => {
  it('404s when profile version is not found for the org', async () => {
    queryOneMock.mockResolvedValue(null); // profile version not found
    await expect(loadProfileConfig(1, 999)).rejects.toMatchObject({
      message: 'Vendor profile version not found', statusCode: 404,
    });
    await expect(loadProfileConfig(1, 999)).rejects.toBeInstanceOf(AppError);
  });
});

describe('matchRider', () => {
  const trip: CanonicalTrip = {
    externalTripId: 'X1', willCall: false, appointmentAt: null, pickupAt: null,
    passengerFirstName: 'FakeFirst', passengerLastName: 'FakeLast', dateOfBirth: '1950-01-15',
    medicalId: null, primaryPhone: '3135550001', alternatePhone: null,
    pickupAddress: null, dropoffAddress: null, levelOfService: null,
    additionalPassengers: 0, assistanceNeeds: null, tripType: null,
    status: null, distanceMiles: null, notes: null,
  };

  it('matches on name (case-insensitive) + DOB', () => {
    expect(matchRider([MATCHING_RIDER], trip)?.id).toBe(1);
  });

  it('DOB is authoritative when names match and both sides have DOB', () => {
    const rider = { ...MATCHING_RIDER, date_of_birth: '1960-01-01' };
    expect(matchRider([rider], trip)).toBeNull(); // same phone, but DOB mismatch rejects
  });

  it('matches on phone digits when names differ', () => {
    const rider: RiderRow = { ...MATCHING_RIDER, first_name: 'Other', last_name: 'Person', name: 'Other Person' };
    expect(matchRider([rider], trip)?.id).toBe(1); // phone 3135550001 matches
  });

  it('matches on name alone when either side lacks DOB', () => {
    const rider = { ...MATCHING_RIDER, date_of_birth: null };
    expect(matchRider([rider], trip)?.id).toBe(1);
  });

  it('DOB veto works on the cast YYYY-MM-DD rider strings the query now guarantees', () => {
    // riders.date_of_birth is selected as date_of_birth::text, so matchRider
    // always compares plain 'YYYY-MM-DD' strings — no pg Date parsing involved.
    const sameDob = { ...MATCHING_RIDER, date_of_birth: '1950-01-15' };
    expect(matchRider([sameDob], trip)?.id).toBe(1);       // name + DOB agree → match
    const otherDob = { ...MATCHING_RIDER, date_of_birth: '1951-01-15' };
    expect(matchRider([otherDob], trip)).toBeNull();        // name matches, DOB vetoes
  });

  it('splits legacy `name` when first_name/last_name are NULL', () => {
    const legacy: RiderRow = {
      id: 7, first_name: null, last_name: null,
      name: 'FakeFirst FakeLast', date_of_birth: '1950-01-15', phone: '000',
    };
    expect(matchRider([legacy], trip)?.id).toBe(7);
  });

  it('returns null when nothing matches', () => {
    const other = { ...trip, passengerFirstName: 'Nobody', primaryPhone: '0000000' };
    expect(matchRider([MATCHING_RIDER], other)).toBeNull();
  });
});
