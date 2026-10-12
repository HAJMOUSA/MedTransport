import { describe, it, expect, vi, beforeEach } from 'vitest';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = 'test-secret';

vi.mock('../../src/db/pool', () => ({
  db: { connect: vi.fn(), query: vi.fn(), end: vi.fn() },
  query: vi.fn().mockResolvedValue([]),
  queryOne: vi.fn().mockResolvedValue(null),
}));
vi.mock('../../src/db/redis', () => ({
  redis: { get: vi.fn().mockResolvedValue(null), hgetall: vi.fn().mockResolvedValue({}), smembers: vi.fn().mockResolvedValue([]) },
  RedisKeys: { tokenBlacklist: (j: string) => `blacklist:${j}`, activeDrivers: (o: number) => `a:${o}`, driverLocation: (d: number) => `l:${d}` },
}));
vi.mock('../../src/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import request from 'supertest';
import { app } from '../../src/app';
import { query } from '../../src/db/pool';

const token = (role: 'admin' | 'dispatcher' | 'driver') =>
  jwt.sign({ userId: 1, orgId: 1, role, jti: `jti-${role}` }, 'test-secret');

beforeEach(() => { vi.mocked(query).mockReset().mockResolvedValue([]); });

describe('GET /api/tracking/trips/:id/route', () => {
  it('rejects a driver role', async () => {
    await request(app).get('/api/tracking/trips/24/route')
      .set('Authorization', `Bearer ${token('driver')}`).expect(403);
  });

  it('returns parsed GPS points for a dispatcher', async () => {
    vi.mocked(query).mockResolvedValueOnce([
      { lat: '39.64750000', lng: '-84.13140000', speed_mph: '12.5', heading_deg: 90, recorded_at: new Date('2026-10-06T12:00:00Z') },
    ] as never);
    const res = await request(app).get('/api/tracking/trips/24/route')
      .set('Authorization', `Bearer ${token('dispatcher')}`);
    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({ lat: 39.6475, lng: -84.1314, speedMph: 12.5 });
    expect(typeof res.body[0].recordedAt).toBe('string');
  });
});
