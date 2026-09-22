import { describe, it, expect } from 'vitest';
import type { VendorProfileConfig } from '@midtransport/shared';
import { applyMapping } from '../../src/services/importEngine/mapping';

const PROFILE: VendorProfileConfig = {
  headerSignature: ['Trip Number', 'Appointment Date', 'Time'],
  columnMap: {
    'Trip Number': 'external_trip_id',
    'Appointment Date': 'appointment_at.date',
    'Time': 'appointment_at.time',
    "Member's First Name": 'passenger_first_name',
    "Member's Last Name": 'passenger_last_name',
    "Member's Phone Number": 'primary_phone',
    'Pickup Address': 'pickup_address.street',
    'Pickup City': 'pickup_address.city',
    'Pickup State': 'pickup_address.state',
    'Pickup Zip Code': 'pickup_address.zip',
    'Level of Service': 'level_of_service',
    'Will Call Flag': 'will_call',
    'Trip Mileage': 'distance_miles',
  },
  encoding: 'auto', delimiter: ',',
  dateFormat: 'M/d/yyyy', timeFormat: 'H:mm', dateTimeFormat: 'iso',
  timezone: 'America/New_York',
  valueTranslations: {
    level_of_service: { 'Ambulatory': 'AMB', 'Wheelchair': 'WCH' },
    will_call: { 'Y': 'true', 'N': 'false' },
  },
  defaults: {}, requiredOverrides: [],
};

const ROW = {
  'Trip Number': ' T-100 ', 'Appointment Date': '9/21/2026', 'Time': '8:30',
  "Member's First Name": ' Mary ', "Member's Last Name": "O'Brien",
  "Member's Phone Number": '(313) 555-1234',
  'Pickup Address': '123 Main St', 'Pickup City': 'Detroit', 'Pickup State': 'MI', 'Pickup Zip Code': '48201',
  'Level of Service': 'Ambulatory', 'Will Call Flag': 'N', 'Trip Mileage': '4.5',
};

describe('applyMapping', () => {
  const parsed = { headers: Object.keys(ROW), rows: [ROW], rowNumbers: [2] };

  it('maps, normalizes, translates, assembles addresses and datetimes', () => {
    const { trips, issues } = applyMapping(parsed, PROFILE, 'America/New_York');
    const t = trips[0];
    expect(t.externalTripId).toBe('T-100');                       // trimmed
    expect(t.appointmentAt).toBe('2026-09-21T12:30:00.000Z');     // EDT → UTC
    expect(t.pickupAt).toBe('2026-09-21T12:30:00.000Z');          // fallback from appointment
    expect(t.passengerFirstName).toBe('Mary');
    expect(t.passengerLastName).toBe("O'Brien");
    expect(t.primaryPhone).toBe('3135551234');
    expect(t.pickupAddress).toEqual({ street: '123 Main St', city: 'Detroit', state: 'MI', zip: '48201' });
    expect(t.levelOfService).toBe('AMB');                         // translated
    expect(t.willCall).toBe(false);
    expect(t.distanceMiles).toBe(4.5);
    expect(issues).toHaveLength(0);
  });

  it('reports transformation notices', () => {
    const { notices } = applyMapping(parsed, PROFILE, 'America/New_York');
    expect(notices.some(n => /whitespace/i.test(n))).toBe(true);
  });

  it('flags unparseable dates with row context', () => {
    const bad = { ...ROW, 'Appointment Date': 'garbage' };
    const { trips, issues } = applyMapping({ ...parsed, rows: [bad] }, PROFILE, 'America/New_York');
    expect(trips[0].appointmentAt).toBeNull();
    expect(issues.some(i => i.code === 'E_DATE_PARSE' && i.row === 2 && i.sourceTripId === 'T-100')).toBe(true);
  });

  it('keeps untranslated controlled values raw for validation to flag', () => {
    const odd = { ...ROW, 'Level of Service': 'Helicopter' };
    const { trips } = applyMapping({ ...parsed, rows: [odd] }, PROFILE, 'America/New_York');
    expect(trips[0].levelOfService).toBe('Helicopter'); // validate.ts emits E_CONTROLLED_VALUE
  });

  it('applies defaults for unmapped fields', () => {
    const withDefaults = { ...PROFILE, defaults: { trip_type: 'One Way' } };
    const { trips } = applyMapping(parsed, withDefaults, 'America/New_York');
    expect(trips[0].tripType).toBe('One Way');
  });
});
