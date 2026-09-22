import { describe, it, expect } from 'vitest';
import { CANONICAL_FIELDS, isValidMappingTarget, requiredKeys } from '../../src/services/importEngine/canonical';

describe('canonical registry', () => {
  it('has 19 unique fields with required flags', () => {
    expect(CANONICAL_FIELDS).toHaveLength(19);
    expect(new Set(CANONICAL_FIELDS.map(f => f.key)).size).toBe(19);
    const required = CANONICAL_FIELDS.filter(f => f.required).map(f => f.key);
    expect(required).toEqual(expect.arrayContaining([
      'external_trip_id','pickup_at','passenger_first_name','passenger_last_name',
      'primary_phone','pickup_address','dropoff_address','level_of_service','trip_type',
    ]));
  });
  it('validates mapping targets with suffixes', () => {
    expect(isValidMappingTarget('pickup_at')).toBe(true);
    expect(isValidMappingTarget('pickup_at.date')).toBe(true);
    expect(isValidMappingTarget('pickup_at.time')).toBe(true);
    expect(isValidMappingTarget('pickup_at.street')).toBe(false);   // not an address
    expect(isValidMappingTarget('pickup_address.street')).toBe(true);
    expect(isValidMappingTarget('notes.date')).toBe(false);
    expect(isValidMappingTarget('bogus')).toBe(false);
  });
  it('requiredKeys honors overrides', () => {
    expect(requiredKeys(['primary_phone']).has('primary_phone')).toBe(false);
    expect(requiredKeys([]).has('primary_phone')).toBe(true);
  });
});
