import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

const { queryMock, queryOneMock, connectMock, clientQueryMock, clientReleaseMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  queryOneMock: vi.fn(),
  connectMock: vi.fn(),
  clientQueryMock: vi.fn(),
  clientReleaseMock: vi.fn(),
}));
vi.mock('../src/db/pool', () => ({ query: queryMock, queryOne: queryOneMock, db: { connect: connectMock } }));
vi.mock('../src/lib/geocode', () => ({ geocodeAddress: vi.fn().mockResolvedValue(null) }));

import { executeImport } from '../src/services/importRunner';
import type { ExecuteOptions, RiderRow } from '../src/services/importRunner';
import { VENDOR_A_PROFILE } from './fixtures/profiles';

const buf = fs.readFileSync(path.join(__dirname, './fixtures/vendor-a.csv'));

const LOS = [{ code: 'AMB' }, { code: 'STR' }, { code: 'WCH' }];
const JOB_ID = 555;

const MATCHING_RIDER: RiderRow = {
  id: 1, first_name: 'FakeFirst', last_name: 'FakeLast', name: 'FakeFirst FakeLast',
  date_of_birth: '1950-01-15', phone: '(313) 555-0001',
};

function makeOpts(partial?: Partial<ExecuteOptions>): ExecuteOptions {
  return {
    orgId: 1, userId: 9, userRole: 'admin', uploadId: 10, profileVersionId: 20, profileId: 30,
    mode: 'valid_rows_only', duplicatePolicy: 'skip',
    filename: 'vendor-a.csv', fileHash: 'abc123',
    ...partial,
  };
}

let nextTripId = 9000;

function mockDb(riders: RiderRow[], opts?: { existingExtIds?: string[]; existingExtIdsProfileId?: number; profileId?: number; content?: Buffer; failTripInsertFor?: string }) {
  // Module-level pool functions: runAnalysis reads + job lifecycle writes
  queryOneMock.mockImplementation((sql: string) => {
    if (sql.includes('INSERT INTO import_jobs')) return Promise.resolve({ id: JOB_ID });
    if (sql.includes('FROM import_uploads')) return Promise.resolve({ content: opts?.content ?? buf, filename: 'vendor-a.csv' });
    if (sql.includes('FROM vendor_profile_versions')) return Promise.resolve({ config: structuredClone(VENDOR_A_PROFILE), profileId: opts?.profileId ?? 30 });
    if (sql.includes('FROM organizations')) return Promise.resolve({ timezone: 'America/New_York' });
    if (sql.includes('FROM trips')) return Promise.resolve(null); // background geocode lookup → skip
    return Promise.resolve(null);
  });
  queryMock.mockImplementation((sql: string, params?: unknown[]) => {
    if (sql.includes('FROM levels_of_service')) return Promise.resolve(LOS);
    if (sql.includes('FROM trips')) {
      // Dup detection is vendor-scoped: when existingExtIdsProfileId is set, the ids only
      // "exist" if the query's profile predicate (params[2]) targets that same profile.
      if (opts?.existingExtIdsProfileId !== undefined && params?.[2] !== opts.existingExtIdsProfileId) {
        return Promise.resolve([]);
      }
      return Promise.resolve((opts?.existingExtIds ?? []).map(id => ({ external_trip_id: id })));
    }
    if (sql.includes('FROM riders')) return Promise.resolve(riders);
    return Promise.resolve([]); // UPDATE import_jobs / INSERT INTO audit_log
  });

  // Transaction client: command-appropriate results
  clientQueryMock.mockImplementation((sql: string, params?: unknown[]) => {
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return Promise.resolve({ rows: [] });
    if (sql === 'SAVEPOINT row_write' || sql === 'RELEASE SAVEPOINT row_write' || sql === 'ROLLBACK TO SAVEPOINT row_write') {
      return Promise.resolve({ rows: [] });
    }
    if (sql.includes('INSERT INTO riders')) {
      return Promise.resolve({
        rows: [{ id: 77, first_name: params?.[2], last_name: params?.[3], name: params?.[1], date_of_birth: params?.[4], phone: params?.[6] }],
      });
    }
    if (sql.includes('FROM riders')) return Promise.resolve({ rows: riders });
    if (sql.includes('INSERT INTO trips')) {
      if (opts?.failTripInsertFor && params?.[7] === opts.failTripInsertFor) {
        return Promise.reject(new Error('duplicate key value violates unique constraint "trips_external_id_unique"'));
      }
      return Promise.resolve({ rows: [{ id: ++nextTripId }] });
    }
    if (sql.includes('UPDATE trips')) return Promise.resolve({ rows: [], rowCount: 1 });
    return Promise.resolve({ rows: [] });
  });
  connectMock.mockResolvedValue({ query: clientQueryMock, release: clientReleaseMock });
}

// Build a CSV with the vendor-a header and caller-supplied data rows (all valid by construction)
const VENDOR_A_HEADER = buf.toString('utf8').split(/\r?\n/)[0];
const validRow = (ext: string, first: string, last: string, phone: string, dob: string) =>
  `,9/21/2026,Monday,N,N,500 Woodward Ave,Detroit,Clinic Main,(313) 555-9000,MI,48226,,Dialysis - bring chart,Wheelchair,,0011223344A,76,,${first},${last},${phone},0,,123 Main St,Detroit,MI,48201,N,Walker assistance,8:30,25.00,4.5,${ext},Dialysis,Scheduled,One Way,,Wheelchair Van,N,${dob},`;
const csvWithRows = (rows: string[]): Buffer => Buffer.from([VENDOR_A_HEADER, ...rows].join('\n'), 'utf8');

const sqlOf = (mock: typeof queryMock) => mock.mock.calls.map(c => String(c[0]));
const findCall = (mock: typeof queryMock, fragment: string) =>
  mock.mock.calls.find(c => String(c[0]).includes(fragment));

beforeEach(() => {
  queryMock.mockReset();
  queryOneMock.mockReset();
  connectMock.mockReset();
  clientQueryMock.mockReset();
  clientReleaseMock.mockReset();
  nextTripId = 9000;
});

describe('executeImport', () => {
  it('test mode creates no trips and finalizes the job without a transaction', async () => {
    mockDb([MATCHING_RIDER]);
    const jobId = await executeImport(makeOpts({ mode: 'test' }));

    expect(jobId).toBe(JOB_ID);
    expect(connectMock).not.toHaveBeenCalled();
    expect(clientQueryMock).not.toHaveBeenCalled();

    // job row created with mode + counts
    const jobInsert = findCall(queryOneMock, 'INSERT INTO import_jobs')!;
    expect(jobInsert[1]).toEqual([1, 9, 'vendor-a.csv', 'test', 'abc123', 20, 'skip', 3]);

    // finalized as completed with analysis counts, no result trips
    const finalize = findCall(queryMock, "UPDATE import_jobs SET status = 'completed'")!;
    expect(finalize[1][0]).toBe(3);   // total_rows
    expect(finalize[1][1]).toBe(2);   // error_rows = invalid count
    expect(finalize[1][3]).toEqual([]); // result_trip_ids
    expect(finalize[1][4]).toBe(JOB_ID);
  });

  it('valid_rows_only inserts only the valid row and reports counts', async () => {
    mockDb([MATCHING_RIDER]);
    const jobId = await executeImport(makeOpts());

    expect(jobId).toBe(JOB_ID);
    const clientSql = sqlOf(clientQueryMock);
    expect(clientSql[0]).toBe('BEGIN');
    expect(clientSql[clientSql.length - 1]).toBe('COMMIT');
    expect(clientReleaseMock).toHaveBeenCalled();

    // riders loaded inside the transaction with the ::text DOB cast
    const riderSelect = clientSql.find(s => s.includes('FROM riders'))!;
    expect(riderSelect).toContain('date_of_birth::text AS date_of_birth');

    // exactly one trip inserted (rows 3/4 of the fixture are invalid → skipped)
    const tripInserts = clientSql.filter(s => s.includes('INSERT INTO trips'));
    expect(tripInserts).toHaveLength(1);
    expect(clientSql.some(s => s.includes('INSERT INTO riders'))).toBe(false); // matched existing rider

    const insertParams = clientQueryMock.mock.calls.find(c => String(c[0]).includes('INSERT INTO trips'))![1] as unknown[];
    expect(insertParams[0]).toBe(1);       // org_id
    expect(insertParams[1]).toBe(1);       // matched rider id
    expect(insertParams[7]).toBe('FAKE-A-001'); // external_trip_id
    expect(insertParams[15]).toBe(JOB_ID); // import_job_id
    expect(insertParams[16]).toBe(9);      // created_by

    // job completed with all six counters + result ids
    const jobUpdate = findCall(queryMock, "UPDATE import_jobs SET status = 'completed'")!;
    expect(jobUpdate[1][0]).toBe(1);  // imported_rows
    expect(jobUpdate[1][1]).toBe(0);  // updated_rows
    expect(jobUpdate[1][2]).toBe(0);  // skipped_rows
    expect(jobUpdate[1][3]).toBe(0);  // duplicate_rows
    expect(jobUpdate[1][4]).toBe(2);  // error_rows
    expect(jobUpdate[1][6]).toEqual([9001]); // result_trip_ids
    expect(jobUpdate[1][7]).toBe(JOB_ID);

    // audit row written with acting role
    const audit = findCall(queryMock, 'INSERT INTO audit_log')!;
    expect(audit[1].slice(0, 4)).toEqual([1, 9, 'admin', JOB_ID]);
  });

  it('all_or_nothing fails the job when invalid rows exist (no inserts)', async () => {
    mockDb([MATCHING_RIDER]);
    const jobId = await executeImport(makeOpts({ mode: 'all_or_nothing' }));

    expect(jobId).toBe(JOB_ID);
    expect(connectMock).not.toHaveBeenCalled(); // transaction never opened
    expect(clientQueryMock).not.toHaveBeenCalled();

    const failUpdate = findCall(queryMock, "UPDATE import_jobs SET status = 'failed'")!;
    expect(failUpdate[1][0]).toBe(2); // error_rows = invalid count
    expect(failUpdate[1][2]).toBe(JOB_ID);
    expect(findCall(queryMock, "UPDATE import_jobs SET status = 'completed'")).toBeUndefined();
  });

  it('duplicate policy skip skips the duplicate and counts it', async () => {
    mockDb([MATCHING_RIDER], { existingExtIds: ['FAKE-A-001'] });
    await executeImport(makeOpts({ duplicatePolicy: 'skip' }));

    const clientSql = sqlOf(clientQueryMock);
    expect(clientSql.some(s => s.includes('INSERT INTO trips'))).toBe(false);
    expect(clientSql.some(s => s.includes('UPDATE trips'))).toBe(false);

    const jobUpdate = findCall(queryMock, "UPDATE import_jobs SET status = 'completed'")!;
    expect(jobUpdate[1][0]).toBe(0);  // imported
    expect(jobUpdate[1][2]).toBe(1);  // skipped
    expect(jobUpdate[1][3]).toBe(1);  // duplicates
    expect(jobUpdate[1][4]).toBe(2);  // failed (the two invalid rows)
  });

  it('duplicate policy reject fails the duplicate row', async () => {
    mockDb([MATCHING_RIDER], { existingExtIds: ['FAKE-A-001'] });
    await executeImport(makeOpts({ duplicatePolicy: 'reject' }));

    expect(sqlOf(clientQueryMock).some(s => s.includes('INSERT INTO trips'))).toBe(false);
    const jobUpdate = findCall(queryMock, "UPDATE import_jobs SET status = 'completed'")!;
    expect(jobUpdate[1][3]).toBe(1);  // duplicates
    expect(jobUpdate[1][4]).toBe(3);  // failed: 2 invalid + 1 rejected dup
  });

  it('duplicate policy update updates the existing trip instead of inserting', async () => {
    mockDb([MATCHING_RIDER], { existingExtIds: ['FAKE-A-001'] });
    await executeImport(makeOpts({ duplicatePolicy: 'update' }));

    const clientSql = sqlOf(clientQueryMock);
    expect(clientSql.some(s => s.includes('INSERT INTO trips'))).toBe(false);
    const updateCall = clientQueryMock.mock.calls.find(c => String(c[0]).includes('UPDATE trips SET'))!;
    const params = updateCall[1] as unknown[];
    expect(params[11]).toBe(1);           // org_id
    expect(params[12]).toBe(30);          // source_vendor_profile_id
    expect(params[13]).toBe('FAKE-A-001'); // external_trip_id

    const jobUpdate = findCall(queryMock, "UPDATE import_jobs SET status = 'completed'")!;
    expect(jobUpdate[1][1]).toBe(1);  // updated_rows
    expect(jobUpdate[1][3]).toBe(1);  // duplicates
    expect(jobUpdate[1][6]).toEqual([]); // no new trip ids
  });

  it('AC #5: same external id under a different vendor profile is NOT a duplicate — row imports clean', async () => {
    // FAKE-A-001 already exists in trips under profile A (30). Importing the same id under
    // profile B (31) must not raise E_DUPLICATE_IN_DB: dedupe key is (org, profile, ext id).
    const PROFILE_A = 30, PROFILE_B = 31;
    mockDb([MATCHING_RIDER], { profileId: PROFILE_B, existingExtIds: ['FAKE-A-001'], existingExtIdsProfileId: PROFILE_A });
    await executeImport(makeOpts({ profileId: PROFILE_B }));

    // the dup query carried the vendor-profile predicate, scoped to profile B
    const dupCall = queryMock.mock.calls.find(c => String(c[0]).includes('external_trip_id = ANY'))!;
    expect(String(dupCall[0])).toContain('source_vendor_profile_id');
    expect((dupCall[1] as unknown[])[2]).toBe(PROFILE_B);

    // no duplicate flagged → the valid row INSERTs and counts as created
    expect(sqlOf(clientQueryMock).some(s => s.includes('INSERT INTO trips'))).toBe(true);
    expect(sqlOf(clientQueryMock).some(s => s.includes('UPDATE trips'))).toBe(false);
    const jobUpdate = findCall(queryMock, "UPDATE import_jobs SET status = 'completed'")!;
    expect(jobUpdate[1][0]).toBe(1);  // imported_rows
    expect(jobUpdate[1][1]).toBe(0);  // updated_rows
    expect(jobUpdate[1][2]).toBe(0);  // skipped_rows
    expect(jobUpdate[1][3]).toBe(0);  // duplicate_rows
  });

  it('will-call row with no pickup/appointment time inserts with will_call=true and NULL scheduled_pickup_at', async () => {
    // Same vendor-a shape but Will Call Flag = Y and no Appointment Date/Time at all:
    // valid per the engine (pickup_at exempt when will_call), so the row must not be lost.
    const willCallRow = (ext: string, first: string, last: string, phone: string, dob: string) => {
      const cells = validRow(ext, first, last, phone, dob).split(',');
      cells[1] = '';    // Appointment Date
      cells[29] = '';   // Time
      cells[38] = 'Y';  // Will Call Flag
      return cells.join(',');
    };
    const csv = csvWithRows([willCallRow('WC-001', 'WillCall', 'Person', '(313) 555-0009', '4/4/1954')]);
    mockDb([], { content: csv });
    await executeImport(makeOpts());

    const tripInsert = clientQueryMock.mock.calls.find(c => String(c[0]).includes('INSERT INTO trips'))!;
    const params = tripInsert[1] as unknown[];
    expect(params[4]).toBeNull();  // scheduled_pickup_at = pickupAt ?? appointmentAt (both null)
    expect(params[17]).toBe(true); // will_call

    const jobUpdate = findCall(queryMock, "UPDATE import_jobs SET status = 'completed'")!;
    expect(jobUpdate[1][0]).toBe(1);  // imported_rows — the valid will-call row is not lost
    expect(jobUpdate[1][4]).toBe(0);  // error_rows
  });

  it('auto-creates a rider when no rider matches and links the trip', async () => {
    mockDb([]); // no riders anywhere
    await executeImport(makeOpts());

    const riderInsert = clientQueryMock.mock.calls.find(c => String(c[0]).includes('INSERT INTO riders'))!;
    expect(riderInsert[1][1]).toBe('FakeFirst FakeLast'); // name
    expect(riderInsert[1][4]).toBe('1950-01-15');         // date_of_birth

    const tripInsert = clientQueryMock.mock.calls.find(c => String(c[0]).includes('INSERT INTO trips'))!;
    expect((tripInsert[1] as unknown[])[1]).toBe(77);     // trip linked to the new rider id

    const jobUpdate = findCall(queryMock, "UPDATE import_jobs SET status = 'completed'")!;
    expect(jobUpdate[1][0]).toBe(1);  // imported_rows
  });

  it('valid_rows_only recovers past a single-row insert failure via per-row savepoint', async () => {
    const multi = csvWithRows([
      validRow('FAKE-A-001', 'FakeFirst', 'FakeLast', '(313) 555-0001', '1/15/1950'),
      validRow('FAKE-B-002', 'Second', 'Person', '(313) 555-0002', '2/2/1952'),
      validRow('FAKE-C-003', 'Third', 'Human', '(313) 555-0003', '3/3/1953'),
    ]);
    mockDb([], { content: multi, failTripInsertFor: 'FAKE-B-002' });
    await executeImport(makeOpts());

    // Savepoint choreography: one SAVEPOINT per row, RELEASE on success, ROLLBACK TO on failure
    const seq = sqlOf(clientQueryMock);
    expect(seq.filter(s => s === 'SAVEPOINT row_write')).toHaveLength(3);
    expect(seq.filter(s => s === 'RELEASE SAVEPOINT row_write')).toHaveLength(2);
    expect(seq.filter(s => s === 'ROLLBACK TO SAVEPOINT row_write')).toHaveLength(1);
    // the rollback belongs to the middle row: after the 2nd SAVEPOINT, before the 3rd
    const spIdxs = seq.map((s, i) => (s === 'SAVEPOINT row_write' ? i : -1)).filter(i => i >= 0);
    const rbIdx = seq.indexOf('ROLLBACK TO SAVEPOINT row_write');
    expect(rbIdx).toBeGreaterThan(spIdxs[1]);
    expect(rbIdx).toBeLessThan(spIdxs[2]);
    expect(seq[seq.length - 1]).toBe('COMMIT');

    // the other two rows still insert and persist; the failing row lands in errors
    expect(seq.filter(s => s.includes('INSERT INTO trips'))).toHaveLength(3); // 2 ok + 1 failed attempt
    const jobUpdate = findCall(queryMock, "UPDATE import_jobs SET status = 'completed'")!;
    expect(jobUpdate[1][0]).toBe(2);             // imported_rows
    expect(jobUpdate[1][4]).toBe(1);             // error_rows
    expect(jobUpdate[1][6]).toEqual([9001, 9002]); // result_trip_ids — only real inserts
    const errs = JSON.parse(jobUpdate[1][5] as string) as Array<{ code?: string; sourceTripId?: string }>;
    expect(errs.some(e => e.code === 'E_INSERT' && e.sourceTripId === 'FAKE-B-002')).toBe(true);
  });
});
