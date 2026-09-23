import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import type { CanonicalTrip } from '@midtransport/shared';

const { queryMock, queryOneMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  queryOneMock: vi.fn(),
}));
vi.mock('../src/db/pool', () => ({ query: queryMock, queryOne: queryOneMock }));

import { runAnalysis, matchRider } from '../src/services/importRunner';
import type { RiderRow } from '../src/services/importRunner';
import { AppError } from '../src/middleware/errorHandler';
import { VENDOR_A_PROFILE } from './fixtures/profiles';

const buf = fs.readFileSync(path.join(__dirname, './fixtures/vendor-a.csv'));

const LOS = [{ code: 'AMB' }, { code: 'STR' }, { code: 'WCH' }];

function mockDb(riders: RiderRow[], opts?: { existingExtIds?: string[] }) {
  queryOneMock.mockImplementation((sql: string) => {
    if (sql.includes('FROM import_uploads')) return Promise.resolve({ content: buf, filename: 'vendor-a.csv' });
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
    const result = await runAnalysis(1, 10, 20);

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
    const result = await runAnalysis(1, 10, 20);
    expect(result.counts.matchedRiders).toBe(0);
    expect(result.counts.newRiders).toBe(1); // invalid rows excluded from matching
  });

  it('flags duplicates already in DB', async () => {
    mockDb([], { existingExtIds: ['FAKE-A-001'] });
    const result = await runAnalysis(1, 10, 20);
    expect(result.counts.duplicates).toBeGreaterThan(0);
    expect(result.issues.some(i => i.code === 'E_DUPLICATE_IN_DB')).toBe(true);
  });

  it('applies mapping overrides to config and recognized headers', async () => {
    mockDb([]);
    const result = await runAnalysis(1, 10, 20, { 'Trip Reason': 'notes' });
    expect(result.config.columnMap['Trip Reason']).toBe('notes');
    expect(result.recognized).toContain('Trip Reason');
    expect(result.unmapped).not.toContain('Trip Reason');
  });

  it('404s when upload is missing or expired', async () => {
    queryOneMock.mockResolvedValue(null);
    await expect(runAnalysis(1, 99, 20)).rejects.toMatchObject({ statusCode: 404 });
    await expect(runAnalysis(1, 99, 20)).rejects.toBeInstanceOf(AppError);
  });

  it('404s when profile version is not found for the org', async () => {
    queryOneMock.mockImplementation((sql: string) => {
      if (sql.includes('FROM import_uploads')) return Promise.resolve({ content: buf, filename: 'vendor-a.csv' });
      return Promise.resolve(null); // profile version not found
    });
    await expect(runAnalysis(1, 10, 999)).rejects.toMatchObject({
      message: 'Vendor profile version not found', statusCode: 404,
    });
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
