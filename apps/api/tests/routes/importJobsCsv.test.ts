import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import express from 'express';
import type { Server } from 'http';
import type { AddressInfo } from 'net';

const { queryMock, queryOneMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  queryOneMock: vi.fn(),
}));
vi.mock('../../src/db/pool', () => ({ query: queryMock, queryOne: queryOneMock }));
vi.mock('../../src/middleware/auth', () => ({
  authenticate: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.user = { userId: 1, orgId: 42, role: 'admin', jti: 'test' };
    next();
  },
  requireRole: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
}));

import importTripsRouter from '../../src/routes/importTrips';
import { errorHandler } from '../../src/middleware/errorHandler';

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use('/api/import/trips', importTripsRouter);
  app.use(errorHandler);
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}/api/import/trips`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('GET /api/import/trips/jobs/:id/errors.csv', () => {
  it('neutralizes spreadsheet-formula prefixes in vendor-controlled cells', async () => {
    queryOneMock.mockResolvedValueOnce({
      errors: [{ row: 2, sourceTripId: '=EVIL()', field: 'trip_id', code: 'E_FORMAT', guidance: 'Check the ID' }],
    });
    const res = await fetch(`${baseUrl}/jobs/123/errors.csv`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^text\/csv/);
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="import-123-errors.csv"');
    const lines = (await res.text()).split('\n');
    expect(lines[0]).toBe('row,source_trip_id,field,code,guidance');
    expect(lines[1]).toBe(`"2","'=EVIL()","trip_id","E_FORMAT","Check the ID"`);
  });

  it('keeps commas and quotes inside one fully quoted cell', async () => {
    queryOneMock.mockResolvedValueOnce({
      errors: [{ row: 3, sourceTripId: 'ABC,123', field: 'trip_id', code: 'E_FORMAT', guidance: 'He said "hi"' }],
    });
    const res = await fetch(`${baseUrl}/jobs/123/errors.csv`);
    const lines = (await res.text()).split('\n');
    expect(lines[1]).toBe(`"3","ABC,123","trip_id","E_FORMAT","He said ""hi"""`);
  });

  it('emits E_INSERT message in the guidance column', async () => {
    queryOneMock.mockResolvedValueOnce({
      errors: [{ row: 5, sourceTripId: 'T-9', code: 'E_INSERT', message: 'duplicate key value' }],
    });
    const res = await fetch(`${baseUrl}/jobs/123/errors.csv`);
    const lines = (await res.text()).split('\n');
    expect(lines[1]).toBe(`"5","T-9","","E_INSERT","duplicate key value"`);
  });

  it('returns 404 for an unknown job', async () => {
    queryOneMock.mockResolvedValueOnce(null);
    const res = await fetch(`${baseUrl}/jobs/999/errors.csv`);
    expect(res.status).toBe(404);
  });
});
