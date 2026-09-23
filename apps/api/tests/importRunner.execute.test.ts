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

function mockDb(riders: RiderRow[], opts?: { existingExtIds?: string[] }) {
  // Module-level pool functions: runAnalysis reads + job lifecycle writes
  queryOneMock.mockImplementation((sql: string) => {
    if (sql.includes('INSERT INTO import_jobs')) return Promise.resolve({ id: JOB_ID });
    if (sql.includes('FROM import_uploads')) return Promise.resolve({ content: buf, filename: 'vendor-a.csv' });
    if (sql.includes('FROM vendor_profile_versions')) return Promise.resolve({ config: structuredClone(VENDOR_A_PROFILE) });
    if (sql.includes('FROM organizations')) return Promise.resolve({ timezone: 'America/New_York' });
    if (sql.includes('FROM trips')) return Promise.resolve(null); // background geocode lookup → skip
    return Promise.resolve(null);
  });
  queryMock.mockImplementation((sql: string) => {
    if (sql.includes('FROM levels_of_service')) return Promise.resolve(LOS);
    if (sql.includes('FROM trips')) return Promise.resolve((opts?.existingExtIds ?? []).map(id => ({ external_trip_id: id })));
    if (sql.includes('FROM riders')) return Promise.resolve(riders);
    return Promise.resolve([]); // UPDATE import_jobs / INSERT INTO audit_log
  });

  // Transaction client: command-appropriate results
  clientQueryMock.mockImplementation((sql: string, params?: unknown[]) => {
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return Promise.resolve({ rows: [] });
    if (sql.includes('INSERT INTO riders')) {
      return Promise.resolve({
        rows: [{ id: 77, first_name: params?.[2], last_name: params?.[3], name: params?.[1], date_of_birth: params?.[4], phone: params?.[6] }],
      });
    }
    if (sql.includes('FROM riders')) return Promise.resolve({ rows: riders });
    if (sql.includes('INSERT INTO trips')) return Promise.resolve({ rows: [{ id: ++nextTripId }] });
    if (sql.includes('UPDATE trips')) return Promise.resolve({ rows: [] });
    return Promise.resolve({ rows: [] });
  });
  connectMock.mockResolvedValue({ query: clientQueryMock, release: clientReleaseMock });
}

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
});
