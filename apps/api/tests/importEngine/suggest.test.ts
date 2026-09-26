import { describe, it, expect } from 'vitest';
import { suggestMapping } from '../../src/services/importEngine/suggest';

describe('suggestMapping', () => {
  it('maps a generic clinic export by key/label', () => {
    const m = suggestMapping([
      'First Name', 'Last Name', 'DOB', 'Phone', 'Trip ID',
      'Pickup Address', 'Dropoff Address', 'Level of Service', 'Trip Type',
    ]);
    expect(m).toMatchObject({
      'First Name': 'passenger_first_name',
      'Last Name': 'passenger_last_name',
      'DOB': 'date_of_birth',
      'Phone': 'primary_phone',
      'Trip ID': 'external_trip_id',
      'Pickup Address': 'pickup_address.street',
      'Dropoff Address': 'dropoff_address.street',
      'Level of Service': 'level_of_service',
      'Trip Type': 'trip_type',
    });
  });

  it('resolves synonyms and punctuation/case variants', () => {
    const m = suggestMapping(['MRN', 'LOS', 'Tel', 'D.O.B', 'Will Call']);
    expect(m).toMatchObject({
      'MRN': 'medical_id',
      'LOS': 'level_of_service',
      'Tel': 'primary_phone',
      'D.O.B': 'date_of_birth',
      'Will Call': 'will_call',
    });
  });

  it('maps pickup/dropoff address sub-parts when location + part are named', () => {
    const m = suggestMapping(['PU City', 'Dropoff Zip']);
    expect(m).toMatchObject({
      'PU City': 'pickup_address.city',
      'Dropoff Zip': 'dropoff_address.zip',
    });
  });

  it('maps datetime date/time sub-parts for pickup and appointment', () => {
    const m = suggestMapping(['Appointment Date', 'Appointment Time', 'Pickup Time']);
    expect(m).toMatchObject({
      'Appointment Date': 'appointment_at.date',
      'Appointment Time': 'appointment_at.time',
      'Pickup Time': 'pickup_at.time',
    });
  });

  it('enforces one-to-one: a target is suggested at most once', () => {
    const m = suggestMapping(['Phone', 'Phone Number']);
    expect(m['Phone']).toBe('primary_phone');
    expect(m['Phone Number']).toBeUndefined();
  });

  it('one-to-one first header wins regardless of order', () => {
    const b = suggestMapping(['Phone Number', 'Phone']);
    expect(b['Phone Number']).toBe('primary_phone');
    expect(b['Phone']).toBeUndefined();
  });

  it('leaves ambiguous or unknown headers unmapped', () => {
    const m = suggestMapping(['City', 'State', 'Date', 'Name', 'Widget Count']);
    expect(m).toEqual({});
  });

  it('returns an empty map for no headers', () => {
    expect(suggestMapping([])).toEqual({});
  });
});
