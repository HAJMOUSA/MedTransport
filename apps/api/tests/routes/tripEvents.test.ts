import { describe, it, expect, vi, beforeEach } from 'vitest';
import jwt from 'jsonwebtoken';
import os from 'os';
import path from 'path';

process.env.JWT_SECRET = 'test-secret';
process.env.UPLOAD_DIR = path.join(os.tmpdir(), 'midtransport-test-uploads');

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
vi.mock('../../src/lib/geocode', () => ({
  geocodeAddress: vi.fn().mockResolvedValue(null),
}));

import request from 'supertest';
import { app } from '../../src/app';
import { query, queryOne } from '../../src/db/pool';

const mockQuery = vi.mocked(query);
const mockQueryOne = vi.mocked(queryOne);

function token(role: 'admin' | 'dispatcher' | 'driver'): string {
  return jwt.sign({ userId: 1, orgId: 1, role, jti: `jti-${role}` }, 'test-secret');
}

beforeEach(() => {
  mockQuery.mockReset().mockResolvedValue([]);
  mockQueryOne.mockReset().mockResolvedValue(null);
});

describe('PATCH /api/trips/:id/status signature gate', () => {
  it('blocks completed with 409 when no signature event exists', async () => {
    mockQueryOne.mockResolvedValue(null);
    const res = await request(app)
      .patch('/api/trips/5/status')
      .set('Authorization', `Bearer ${token('driver')}`)
      .send({ status: 'completed' });
    expect(res.status).toBe(409);
  });

  it('allows completed when a signature event exists', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ id: 99 })                       // signature exists
      .mockResolvedValueOnce({ id: 5, status: 'completed' });  // updated trip
    const res = await request(app)
      .patch('/api/trips/5/status')
      .set('Authorization', `Bearer ${token('driver')}`)
      .send({ status: 'completed' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('completed');
  });

  it('does not gate non-completed transitions', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 5, status: 'en_route_pickup' });
    const res = await request(app)
      .patch('/api/trips/5/status')
      .set('Authorization', `Bearer ${token('driver')}`)
      .send({ status: 'en_route_pickup' });
    expect(res.status).toBe(200);
  });
});

describe('POST /api/trips/:id/signature', () => {
  it('rejects unauthenticated', async () => {
    await request(app).post('/api/trips/5/signature').send({ imageBase64: 'x' }).expect(401);
  });

  it('400 when imageBase64 missing', async () => {
    const res = await request(app)
      .post('/api/trips/5/signature')
      .set('Authorization', `Bearer ${token('driver')}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it('404 when trip not in org', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ id: 7 }) // driver lookup
      .mockResolvedValueOnce(null);     // trip lookup -> not found
    const res = await request(app)
      .post('/api/trips/5/signature')
      .set('Authorization', `Bearer ${token('driver')}`)
      .send({ imageBase64: 'data:image/png;base64,iVBORw0KGgo=' });
    expect(res.status).toBe(404);
  });

  it('201 and records a signature event on success', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ id: 7 })     // driver lookup
      .mockResolvedValueOnce({ id: 5 })     // trip lookup
      .mockResolvedValueOnce({ id: 123 });  // insert RETURNING id
    const res = await request(app)
      .post('/api/trips/5/signature')
      .set('Authorization', `Bearer ${token('driver')}`)
      .send({ imageBase64: 'data:image/png;base64,iVBORw0KGgo=', lat: 43.6, lng: -70.2 });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ tripId: 5, eventType: 'signature' });
  });
});

describe('POST /api/trips/:id/no-show', () => {
  it('rejects invalid reason code', async () => {
    const res = await request(app)
      .post('/api/trips/5/no-show')
      .set('Authorization', `Bearer ${token('driver')}`)
      .send({ reasonCode: 'not_a_reason' });
    expect(res.status).toBe(400);
  });

  it('404 when trip not in org', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ id: 7 }) // driver lookup
      .mockResolvedValueOnce(null);     // trip lookup
    const res = await request(app)
      .post('/api/trips/5/no-show')
      .set('Authorization', `Bearer ${token('driver')}`)
      .send({ reasonCode: 'rider_not_present' });
    expect(res.status).toBe(404);
  });

  it('records event + sets status no_show', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ id: 7 })   // driver lookup
      .mockResolvedValueOnce({ id: 5 });  // trip lookup
    const res = await request(app)
      .post('/api/trips/5/no-show')
      .set('Authorization', `Bearer ${token('driver')}`)
      .send({ reasonCode: 'rider_not_present', note: 'Waited 5 min' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('no_show');
  });
});

describe('POST /api/trips/:id/cancellation', () => {
  it('rejects invalid reason code', async () => {
    const res = await request(app)
      .post('/api/trips/5/cancellation')
      .set('Authorization', `Bearer ${token('dispatcher')}`)
      .send({ reasonCode: 'nope' });
    expect(res.status).toBe(400);
  });

  it('records event + sets status cancelled', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ id: 7 })   // driver lookup
      .mockResolvedValueOnce({ id: 5 });  // trip lookup
    const res = await request(app)
      .post('/api/trips/5/cancellation')
      .set('Authorization', `Bearer ${token('dispatcher')}`)
      .send({ reasonCode: 'duplicate' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('cancelled');
  });
});
