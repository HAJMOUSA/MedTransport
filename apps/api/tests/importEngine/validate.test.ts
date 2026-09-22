import { describe, it, expect } from 'vitest';
import type { CanonicalTrip } from '@midtransport/shared';
import { validateRows } from '../../src/services/importEngine/validate';

function goodTrip(): CanonicalTrip {
  return {
    externalTripId: 'T-1', willCall: false,
    appointmentAt: '2026-09-21T12:30:00.000Z', pickupAt: '2026-09-21T12:30:00.000Z',
    passengerFirstName: 'Mary', passengerLastName: "O'Brien", dateOfBirth: '1950-01-15',
    medicalId: '0123456789A', primaryPhone: '3135551234', alternatePhone: null,
    pickupAddress: { street: '123 Main St', city: 'Detroit', state: 'MI', zip: '48201' },
    dropoffAddress: { street: '500 Woodward Ave', city: 'Detroit', state: 'MI', zip: '48226' },
    levelOfService: 'AMB', additionalPassengers: 0, assistanceNeeds: null,
    tripType: 'One Way', status: 'scheduled', distanceMiles: 4.5, notes: null,
  };
}

const REQUIRED = new Set(['external_trip_id','pickup_at','passenger_first_name','passenger_last_name','primary_phone','pickup_address','dropoff_address','level_of_service','trip_type']);
const CTX = { levelOfServiceCodes: ['AMB', 'STR', 'WCH'], existingExternalIds: new Set<string>() };
const map = (trips: CanonicalTrip[]) => ({ trips, rowNumbers: trips.map((_, i) => i + 2), issues: [], notices: [] });

describe('validateRows', () => {
  it('passes a good trip', () => {
    const { results, counts } = validateRows(map([goodTrip()]), REQUIRED, CTX);
    expect(results[0].status).toBe('valid');
    expect(counts).toMatchObject({ total: 1, valid: 1, invalid: 0 });
  });
  it('flags missing required fields', () => {
    const t = { ...goodTrip(), primaryPhone: null };
    const { results } = validateRows(map([t]), REQUIRED, CTX);
    expect(results[0].status).toBe('invalid');
    expect(results[0].issues.some(i => i.code === 'E_REQUIRED_FIELD' && i.field === 'primary_phone')).toBe(true);
  });
  it('requires pickup time unless will-call', () => {
    const t = { ...goodTrip(), pickupAt: null };
    expect(validateRows(map([t]), REQUIRED, CTX).results[0].status).toBe('invalid');
    const wc = { ...goodTrip(), pickupAt: null, willCall: true };
    expect(validateRows(map([wc]), REQUIRED, CTX).results[0].status).toBe('valid');
  });
  it('validates phones and zips', () => {
    const t = { ...goodTrip(), primaryPhone: '12', pickupAddress: { street: '1 Main', city: 'Detroit', state: 'MI', zip: '4820A' } };
    const codes = validateRows(map([t]), REQUIRED, CTX).results[0].issues.map(i => i.code);
    expect(codes).toContain('E_PHONE_INVALID');
    expect(codes).toContain('E_ZIP_INVALID');
  });
  it('flags unknown level-of-service codes', () => {
    const t = { ...goodTrip(), levelOfService: 'Helicopter' };
    const { results } = validateRows(map([t]), REQUIRED, CTX);
    expect(results[0].issues.some(i => i.code === 'E_CONTROLLED_VALUE' && i.field === 'level_of_service')).toBe(true);
  });
  it('detects in-file and in-DB duplicates', () => {
    const a = goodTrip();
    const b = { ...goodTrip() };
    const { results } = validateRows(map([a, b]), REQUIRED, CTX);
    expect(results[1].issues.some(i => i.code === 'E_DUPLICATE_IN_FILE')).toBe(true);
    const { results: dbResults } = validateRows(map([goodTrip()]), REQUIRED,
      { ...CTX, existingExternalIds: new Set(['T-1']) });
    expect(dbResults[0].issues.some(i => i.code === 'E_DUPLICATE_IN_DB')).toBe(true);
  });
  it('unknown status → warning and status nulled', () => {
    const t = { ...goodTrip(), status: 'In Orbit' };
    const { results } = validateRows(map([t]), REQUIRED, CTX);
    expect(results[0].status).toBe('warning');
    expect(results[0].trip.status).toBeNull();
  });
  it('flags non-numeric numeric fields left raw by mapping', () => {
    const t = { ...goodTrip(), distanceMiles: 'four' as unknown as number };
    expect(validateRows(map([t]), REQUIRED, CTX).results[0].issues.some(i => i.code === 'E_NUMERIC_PARSE')).toBe(true);
  });
});
