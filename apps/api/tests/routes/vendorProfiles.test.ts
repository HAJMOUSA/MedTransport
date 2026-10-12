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

import request from 'supertest';
import { app } from '../../src/app';
import { queryOne } from '../../src/db/pool';

const token = (role: 'admin' | 'dispatcher') =>
  jwt.sign({ userId: 1, orgId: 1, role, jti: `jti-${role}` }, 'test-secret');

beforeEach(() => { vi.mocked(queryOne).mockReset().mockResolvedValue(null); });

describe('vendor profile rename/delete', () => {
  it('rejects a dispatcher renaming a profile', async () => {
    await request(app).patch('/api/import/profiles/1')
      .set('Authorization', `Bearer ${token('dispatcher')}`)
      .send({ name: 'X' }).expect(403);
  });

  it('rejects a dispatcher deleting a profile', async () => {
    await request(app).delete('/api/import/profiles/1')
      .set('Authorization', `Bearer ${token('dispatcher')}`).expect(403);
  });

  it('lets an admin rename a profile', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce({ id: 1, name: 'New Name', is_active: true });
    const res = await request(app).patch('/api/import/profiles/1')
      .set('Authorization', `Bearer ${token('admin')}`)
      .send({ name: 'New Name' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('New Name');
  });

  it('404s when renaming a profile in another org', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(null);
    await request(app).patch('/api/import/profiles/999')
      .set('Authorization', `Bearer ${token('admin')}`)
      .send({ name: 'X' }).expect(404);
  });

  it('lets an admin delete (deactivate) a profile', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce({ id: 1 });
    await request(app).delete('/api/import/profiles/1')
      .set('Authorization', `Bearer ${token('admin')}`).expect(204);
  });
});
