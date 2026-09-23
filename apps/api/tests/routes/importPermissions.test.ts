import { describe, it, expect, vi, beforeAll } from 'vitest';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = 'test-secret';

vi.mock('../../src/db/pool', () => ({
  db: { connect: vi.fn(), query: vi.fn(), end: vi.fn() },
  query: vi.fn().mockResolvedValue([]),
  queryOne: vi.fn().mockResolvedValue(null),
}));
vi.mock('../../src/db/redis', () => ({
  redis: { get: vi.fn().mockResolvedValue(null) },
  RedisKeys: { tokenBlacklist: (j: string) => `blacklist:${j}` },
}));
vi.mock('../../src/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import request from 'supertest';
import { app } from '../../src/app';

function token(role: 'admin' | 'dispatcher' | 'driver'): string {
  return jwt.sign({ userId: 1, orgId: 1, role, jti: `jti-${role}` }, 'test-secret');
}

describe('import route permissions', () => {
  it('rejects unauthenticated', async () => {
    await request(app).post('/api/import/trips/execute').send({}).expect(401);
  });
  it('rejects driver role on upload', async () => {
    await request(app).post('/api/import/trips/upload')
      .set('Authorization', `Bearer ${token('driver')}`).expect(403);
  });
  it('rejects non-admin execute with all_or_nothing', async () => {
    const res = await request(app).post('/api/import/trips/execute')
      .set('Authorization', `Bearer ${token('dispatcher')}`)
      .send({ uploadId: 1, profileVersionId: 1, profileId: 1, mode: 'all_or_nothing', duplicatePolicy: 'skip' });
    expect(res.status).toBe(403);
  });
  it('rejects non-admin profile creation', async () => {
    await request(app).post('/api/import/profiles')
      .set('Authorization', `Bearer ${token('dispatcher')}`)
      .send({ name: 'X', config: {} }).expect(403);
  });
  it('canonical-fields is reachable by dispatcher', async () => {
    const res = await request(app).get('/api/import/trips/canonical-fields')
      .set('Authorization', `Bearer ${token('dispatcher')}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(19);
  });
});
