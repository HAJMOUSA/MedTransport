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

  // ── Aggressive fuzzy matching (real broker exports) ───────────────────────
  it('matches possessive and noisy headers via subset/typo', () => {
    const m = suggestMapping([
      "Member's First Name", "Member's Last Name", "Member's Phone Number",
      "Member's Alt Phone", 'Medicaid Number', 'Trip Number', 'Trip Mileage',
      'Will Call Flag', 'Number of Additional Passengers', 'Special Needs',
      'Driver Notes', 'Trip Status', 'Date of Birth',
    ]);
    expect(m).toMatchObject({
      "Member's First Name": 'passenger_first_name',
      "Member's Last Name": 'passenger_last_name',
      "Member's Phone Number": 'primary_phone',
      "Member's Alt Phone": 'alternate_phone',
      'Medicaid Number': 'medical_id',
      'Trip Number': 'external_trip_id',
      'Trip Mileage': 'distance_miles',
      'Will Call Flag': 'will_call',
      'Number of Additional Passengers': 'additional_passengers',
      'Special Needs': 'assistance_needs',
      'Driver Notes': 'notes',
      'Trip Status': 'status',
      'Date of Birth': 'date_of_birth',
    });
  });

  it('treats "Delivery" as the drop-off location', () => {
    const m = suggestMapping([
      'Pickup Address', 'Pickup City', 'Pickup State', 'Pickup Zip Code',
      'Delivery Address', 'Delivery City', 'Delivery State', 'Delivery Zip Code',
    ]);
    expect(m).toMatchObject({
      'Pickup Address': 'pickup_address.street',
      'Pickup City': 'pickup_address.city',
      'Pickup State': 'pickup_address.state',
      'Pickup Zip Code': 'pickup_address.zip',
      'Delivery Address': 'dropoff_address.street',
      'Delivery City': 'dropoff_address.city',
      'Delivery State': 'dropoff_address.state',
      'Delivery Zip Code': 'dropoff_address.zip',
    });
  });

  it('does not let a located facility phone steal the passenger phone', () => {
    const m = suggestMapping(['Delivery Phone Number', "Member's Phone Number"]);
    expect(m["Member's Phone Number"]).toBe('primary_phone');
    expect(m['Delivery Phone Number']).toBeUndefined();
  });

  it('maps Passenger Type to requested_vehicle_type', () => {
    const m = suggestMapping(['Passenger Type']);
    expect(m['Passenger Type']).toBe('requested_vehicle_type');
  });
});
