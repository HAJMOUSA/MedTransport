import { describe, it, expect, vi, beforeEach } from 'vitest';
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
vi.mock('../../src/lib/io', () => ({
  getIo: () => ({ to: () => ({ emit: vi.fn() }) }),
}));
vi.mock('../../src/services/otp', () => ({
  verifyOtp: vi.fn().mockResolvedValue({ success: true }),
  recordFallback: vi.fn().mockResolvedValue(1),
}));

import request from 'supertest';
import { app } from '../../src/app';
import { query, queryOne } from '../../src/db/pool';

const mockQuery = vi.mocked(query);
const mockQueryOne = vi.mocked(queryOne);

function token(): string {
  return jwt.sign({ userId: 1, orgId: 1, role: 'driver', jti: 'jti-d' }, 'test-secret');
}

beforeEach(() => {
  mockQuery.mockReset().mockResolvedValue([]);
  mockQueryOne.mockReset().mockResolvedValue({ id: 5, org_id: 1 }); // trip lookup
});

describe('POST /api/otp/:tripId/verify dropoff', () => {
  it('returns arrived_dropoff (does not complete) for dropoff', async () => {
    const res = await request(app)
      .post('/api/otp/5/verify')
      .set('Authorization', `Bearer ${token()}`)
      .send({ code: '123456', eventType: 'dropoff' });
    expect(res.status).toBe(200);
    expect(res.body.newStatus).toBe('arrived_dropoff');
  });

  it('still advances to picked_up for pickup', async () => {
    const res = await request(app)
      .post('/api/otp/5/verify')
      .set('Authorization', `Bearer ${token()}`)
      .send({ code: '123456', eventType: 'pickup' });
    expect(res.status).toBe(200);
    expect(res.body.newStatus).toBe('picked_up');
  });
});
