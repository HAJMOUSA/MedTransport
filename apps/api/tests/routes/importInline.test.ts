import { describe, it, expect, vi, beforeEach } from 'vitest';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';

process.env.JWT_SECRET = 'test-secret';

const { queryMock, queryOneMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  queryOneMock: vi.fn(),
}));
vi.mock('../../src/db/pool', () => ({
  db: { connect: vi.fn(), query: vi.fn(), end: vi.fn() },
  query: queryMock,
  queryOne: queryOneMock,
}));
vi.mock('../../src/db/redis', () => ({
  redis: { get: vi.fn().mockResolvedValue(null) },
  RedisKeys: { tokenBlacklist: (j: string) => `blacklist:${j}` },
}));
vi.mock('../../src/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../src/lib/geocode', () => ({
  geocodeAddress: vi.fn().mockResolvedValue(null),
}));

import request from 'supertest';
import { app } from '../../src/app';
import { VENDOR_A_PROFILE } from '../fixtures/profiles';

const buf = fs.readFileSync(path.join(__dirname, '../fixtures/vendor-a.csv'));

function token(role: 'admin' | 'dispatcher' | 'driver'): string {
  return jwt.sign({ userId: 1, orgId: 1, role, jti: `jti-${role}` }, 'test-secret');
}

beforeEach(() => {
  queryMock.mockReset();
  queryOneMock.mockReset();
  // Pipeline mocks: upload row, org timezone, LOS codes, no dups, no riders
  queryOneMock.mockImplementation((sql: string) => {
    if (sql.includes('FROM import_uploads')) return Promise.resolve({ content: buf, filename: 'vendor-a.csv' });
    if (sql.includes('FROM organizations')) return Promise.resolve({ timezone: 'America/New_York' });
    return Promise.resolve(null);
  });
  queryMock.mockImplementation((sql: string) => {
    if (sql.includes('FROM levels_of_service')) return Promise.resolve([{ code: 'AMB' }, { code: 'STR' }, { code: 'WCH' }]);
    if (sql.includes('FROM trips')) return Promise.resolve([]);
    if (sql.includes('FROM riders')) return Promise.resolve([]);
    return Promise.resolve([]);
  });
});

describe('POST /api/import/trips/analyze — inline (profileless) configs', () => {
  it('400s when neither profileVersionId nor inlineConfig is provided', async () => {
    const res = await request(app).post('/api/import/trips/analyze')
      .set('Authorization', `Bearer ${token('dispatcher')}`)
      .send({ uploadId: 10 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Provide profileVersionId or inlineConfig');
  });

  it('400s when both profileVersionId and inlineConfig are provided', async () => {
    const res = await request(app).post('/api/import/trips/analyze')
      .set('Authorization', `Bearer ${token('dispatcher')}`)
      .send({ uploadId: 10, profileVersionId: 20, inlineConfig: VENDOR_A_PROFILE });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Provide profileVersionId or inlineConfig');
  });

  it('400s when inlineConfig fails config validation', async () => {
    const res = await request(app).post('/api/import/trips/analyze')
      .set('Authorization', `Bearer ${token('dispatcher')}`)
      .send({ uploadId: 10, inlineConfig: { ...VENDOR_A_PROFILE, columnMap: null } });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('columnMap');
  });

  it('400s when inlineConfig has non-object valueTranslations', async () => {
    const res = await request(app).post('/api/import/trips/analyze')
      .set('Authorization', `Bearer ${token('dispatcher')}`)
      .send({ uploadId: 10, inlineConfig: { ...VENDOR_A_PROFILE, valueTranslations: ['not', 'an', 'object'] } });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('valueTranslations');
  });

  it('runs the full pipeline with a valid inlineConfig (dedupe scoped to profileless imports)', async () => {
    const res = await request(app).post('/api/import/trips/analyze')
      .set('Authorization', `Bearer ${token('dispatcher')}`)
      .send({ uploadId: 10, inlineConfig: VENDOR_A_PROFILE });
    expect(res.status).toBe(200);
    expect(res.body.counts.total).toBe(3);
    expect(res.body.headers).toContain('Trip Number');
    expect(res.body.recognized).toContain('Trip Number');

    // profileless run: dup query uses the IS NULL predicate, no profile id param
    const dupCall = queryMock.mock.calls.find(c => String(c[0]).includes('external_trip_id = ANY'));
    expect(dupCall).toBeDefined();
    expect(String(dupCall![0])).toContain('source_vendor_profile_id IS NULL');
    expect(dupCall![1] as unknown[]).toHaveLength(2);
  });

  it('still accepts a saved profileVersionId (regression: profile path unchanged)', async () => {
    queryOneMock.mockImplementation((sql: string) => {
      if (sql.includes('FROM import_uploads')) return Promise.resolve({ content: buf, filename: 'vendor-a.csv' });
      if (sql.includes('FROM vendor_profile_versions')) {
        return Promise.resolve({ config: structuredClone(VENDOR_A_PROFILE), profileId: 30 });
      }
      if (sql.includes('FROM organizations')) return Promise.resolve({ timezone: 'America/New_York' });
      return Promise.resolve(null);
    });
    const res = await request(app).post('/api/import/trips/analyze')
      .set('Authorization', `Bearer ${token('dispatcher')}`)
      .send({ uploadId: 10, profileVersionId: 20 });
    expect(res.status).toBe(200);
    expect(res.body.counts.total).toBe(3);

    const dupCall = queryMock.mock.calls.find(c => String(c[0]).includes('external_trip_id = ANY'));
    expect(String(dupCall![0])).toContain('source_vendor_profile_id = $3');
    expect((dupCall![1] as unknown[])[2]).toBe(30);
  });
});

describe('POST /api/import/trips/execute — config resolution guards', () => {
  const base = { uploadId: 10, mode: 'test', duplicatePolicy: 'skip' };

  it('400s when neither profileVersionId nor inlineConfig is provided', async () => {
    const res = await request(app).post('/api/import/trips/execute')
      .set('Authorization', `Bearer ${token('admin')}`)
      .send(base);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Provide profileVersionId or inlineConfig');
  });

  it('400s when both are provided', async () => {
    const res = await request(app).post('/api/import/trips/execute')
      .set('Authorization', `Bearer ${token('admin')}`)
      .send({ ...base, profileVersionId: 20, inlineConfig: VENDOR_A_PROFILE });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Provide profileVersionId or inlineConfig');
  });
});
