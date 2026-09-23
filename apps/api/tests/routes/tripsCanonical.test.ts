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

const validTrip = {
  externalTripId: null,
  willCall: false,
  appointmentAt: null,
  pickupAt: '2026-10-01T14:00:00.000Z',
  passengerFirstName: 'Jane',
  passengerLastName: 'Doe',
  dateOfBirth: null,
  medicalId: null,
  primaryPhone: '2075551234',
  alternatePhone: null,
  pickupAddress: { street: '1 Main St', city: 'Portland', state: 'ME', zip: '04101' },
  dropoffAddress: { street: '2 Oak Ave', city: 'Portland', state: 'ME', zip: '04102' },
  levelOfService: 'AMB',
  additionalPassengers: 0,
  assistanceNeeds: null,
  tripType: 'one_way',
  status: null,
  distanceMiles: null,
  notes: null,
};

beforeEach(() => {
  mockQuery.mockReset().mockResolvedValue([{ code: 'AMB', label: 'Ambulatory' }]);
  mockQueryOne.mockReset().mockResolvedValue(null);
});

describe('POST /api/trips/validate-canonical', () => {
  it('rejects unauthenticated', async () => {
    await request(app).post('/api/trips/validate-canonical').send({}).expect(401);
  });

  it('accepts a fully valid trip', async () => {
    const res = await request(app).post('/api/trips/validate-canonical')
      .set('Authorization', `Bearer ${token('dispatcher')}`)
      .send({ trip: validTrip });
    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(true);
    expect(res.body.issues).toEqual([]);
    expect(res.body.duplicateWarning).toBeNull();
  });

  it('flags a bad phone with E_PHONE_INVALID', async () => {
    const res = await request(app).post('/api/trips/validate-canonical')
      .set('Authorization', `Bearer ${token('dispatcher')}`)
      .send({ trip: { ...validTrip, primaryPhone: 'not-a-phone' } });
    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(false);
    expect(res.body.issues.some((i: { code: string }) => i.code === 'E_PHONE_INVALID')).toBe(true);
  });

  it('returns a duplicate warning when a matching trip exists', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 42, scheduled_pickup_at: '2026-10-01T13:00:00.000Z' });
    const res = await request(app).post('/api/trips/validate-canonical')
      .set('Authorization', `Bearer ${token('dispatcher')}`)
      .send({ trip: validTrip });
    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(true);
    expect(res.body.duplicateWarning).toEqual({ tripId: 42, scheduledPickupAt: '2026-10-01T13:00:00.000Z' });
  });
});

describe('GET /api/trips/lookups', () => {
  it('returns levels of service and static trip types', async () => {
    const res = await request(app).get('/api/trips/lookups')
      .set('Authorization', `Bearer ${token('dispatcher')}`);
    expect(res.status).toBe(200);
    expect(res.body.levelOfService).toEqual([{ code: 'AMB', label: 'Ambulatory' }]);
    expect(res.body.tripTypes).toEqual([
      { value: 'one_way', label: 'One way' },
      { value: 'round_trip', label: 'Round trip' },
      { value: 'multi_stop', label: 'Multi-stop' },
    ]);
  });

  it('is not captured by the /:id route', async () => {
    const res = await request(app).get('/api/trips/lookups')
      .set('Authorization', `Bearer ${token('dispatcher')}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('levelOfService');
  });
});

describe('POST /api/trips (extended)', () => {
  const baseBody = {
    pickupAddress: '1 Main St, Portland, ME 04101',
    dropoffAddress: '2 Oak Ave, Portland, ME 04102',
    scheduledPickupAt: '2026-10-01T14:00:00.000Z',
  };

  it('requires riderId when no newRider is supplied', async () => {
    const res = await request(app).post('/api/trips')
      .set('Authorization', `Bearer ${token('dispatcher')}`)
      .send(baseBody);
    expect(res.status).toBe(400);
  });

  it('keeps the existing riderId path working', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ id: 5 })                 // rider lookup
      .mockResolvedValueOnce({ id: 101, status: 'scheduled' }); // trip insert
    const res = await request(app).post('/api/trips')
      .set('Authorization', `Bearer ${token('dispatcher')}`)
      .send({ ...baseBody, riderId: 5 });
    expect(res.status).toBe(201);
    expect(res.body.id).toBe(101);
    expect(mockQueryOne).toHaveBeenCalledTimes(2);
  });

  it('accepts a will-call trip with no scheduledPickupAt and stores will_call=true', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ id: 7 })   // rider insert
      .mockResolvedValueOnce({ id: 103, will_call: true, scheduled_pickup_at: null, status: 'scheduled' }); // trip insert
    const res = await request(app).post('/api/trips')
      .set('Authorization', `Bearer ${token('dispatcher')}`)
      .send({
        pickupAddress: '1 Main St, Portland, ME 04101',
        dropoffAddress: '2 Oak Ave, Portland, ME 04102',
        willCall: true,
        newRider: { firstName: 'Jane', lastName: 'Doe', phone: '2075551234' },
      });
    expect(res.status).toBe(201);
    expect(res.body.will_call).toBe(true);

    const tripInsert = mockQueryOne.mock.calls[1];
    const params = tripInsert[1] as unknown[];
    expect(params[10]).toBeNull(); // scheduled_pickup_at
    expect(params[22]).toBe(true); // will_call
  });

  it('still requires scheduledPickupAt when willCall is not set', async () => {
    const res = await request(app).post('/api/trips')
      .set('Authorization', `Bearer ${token('dispatcher')}`)
      .send({
        pickupAddress: '1 Main St, Portland, ME 04101',
        dropoffAddress: '2 Oak Ave, Portland, ME 04102',
        riderId: 5,
      });
    expect(res.status).toBe(400);
  });

  it('creates an inline new rider and a return leg with swapped addresses', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ id: 7 })                          // rider insert
      .mockResolvedValueOnce({ id: 101, status: 'scheduled' })   // outbound trip
      .mockResolvedValueOnce({ id: 102, status: 'scheduled' });  // return leg
    const res = await request(app).post('/api/trips')
      .set('Authorization', `Bearer ${token('dispatcher')}`)
      .send({
        ...baseBody,
        newRider: { firstName: 'Jane', lastName: 'Doe', phone: '2075551234' },
        levelOfService: 'AMB',
        tripType: 'round_trip',
        returnTrip: { pickupAt: '2026-10-01T18:00:00.000Z' },
      });
    expect(res.status).toBe(201);
    expect(res.body.id).toBe(101);
    expect(mockQueryOne).toHaveBeenCalledTimes(3);

    // Rider insert: name = first + last, split fields, home_address = pickup
    const riderInsert = mockQueryOne.mock.calls[0];
    expect(riderInsert[0]).toContain('INSERT INTO riders');
    expect(riderInsert[1]).toEqual([1, 'Jane Doe', 'Jane', 'Doe', null, null, '2075551234', baseBody.pickupAddress]);

    // Return leg insert: pickup/dropoff swapped, same canonical fields, status scheduled
    const returnInsert = mockQueryOne.mock.calls[2];
    const params = returnInsert[1] as unknown[];
    expect(returnInsert[0]).toContain("'scheduled'");
    expect(params[2]).toBe(baseBody.dropoffAddress); // pickup_address = original dropoff
    expect(params[5]).toBe(baseBody.pickupAddress);  // dropoff_address = original pickup
    expect(params[8]).toBe('2026-10-01T18:00:00.000Z'); // scheduled_pickup_at = returnTrip.pickupAt
  });
});
