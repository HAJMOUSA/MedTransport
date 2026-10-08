export type CanonicalFieldType = 'text'|'date'|'datetime'|'phone'|'zip'|'integer'|'decimal'|'boolean'|'address'|'controlled';
export interface CanonicalFieldDef {
  key: string; label: string; type: CanonicalFieldType; required: boolean; description: string;
}

export const CANONICAL_FIELDS: CanonicalFieldDef[] = [
  { key: 'external_trip_id',      label: 'External Trip ID',       type: 'text',      required: true,  description: 'Vendor trip identifier; unique per vendor + organization' },
  { key: 'will_call',             label: 'Will Call',              type: 'boolean',   required: false, description: 'When true, pickup time may be empty' },
  { key: 'appointment_at',        label: 'Appointment Date/Time',  type: 'datetime',  required: false, description: 'Optional when pickup time is supplied' },
  { key: 'pickup_at',             label: 'Pickup Date/Time',       type: 'datetime',  required: true,  description: 'Required unless Will Call' },
  { key: 'passenger_first_name',  label: 'Passenger First Name',   type: 'text',      required: true,  description: 'Letters, spaces, apostrophes, hyphens, periods' },
  { key: 'passenger_last_name',   label: 'Passenger Last Name',    type: 'text',      required: true,  description: 'Letters, spaces, apostrophes, hyphens, periods' },
  { key: 'date_of_birth',         label: 'Date of Birth',          type: 'date',      required: false, description: 'Stored as YYYY-MM-DD' },
  { key: 'medical_id',            label: 'Medical ID',             type: 'text',      required: false, description: 'Text only — never numeric, leading zeroes preserved' },
  { key: 'primary_phone',         label: 'Primary Phone',          type: 'phone',     required: true,  description: 'Digits plus optional leading +' },
  { key: 'alternate_phone',       label: 'Alternate Phone',        type: 'phone',     required: false, description: 'Same normalization as primary phone' },
  { key: 'pickup_address',        label: 'Pickup Address',         type: 'address',   required: true,  description: 'Structured: street, city, state, zip' },
  { key: 'dropoff_address',       label: 'Drop-off Address',       type: 'address',   required: true,  description: 'Structured: street, city, state, zip' },
  { key: 'level_of_service',      label: 'Level of Service',       type: 'controlled',required: true,  description: 'Translated to an org levels_of_service code' },
  { key: 'additional_passengers', label: 'Additional Passengers',  type: 'integer',   required: false, description: 'Non-negative integer, default 0' },
  { key: 'assistance_needs',      label: 'Assistance Needs',       type: 'text',      required: false, description: 'Free text' },
  { key: 'trip_type',             label: 'Trip Type',              type: 'controlled',required: true,  description: 'Translated to the org controlled list' },
  { key: 'requested_vehicle_type',label: 'Requested Vehicle Type', type: 'text',      required: false, description: 'Vehicle / space type requested by the vendor, stored as free text (e.g. "Ambulatory", "Manual Wheelchair", "Scooter")' },
  { key: 'status',                label: 'Status',                 type: 'controlled',required: false, description: 'Recognized values only; unknown values flagged' },
  { key: 'distance_miles',        label: 'Distance (miles)',       type: 'decimal',   required: false, description: 'Non-negative; not an authoritative routing distance' },
  { key: 'notes',                 label: 'Notes',                  type: 'text',      required: false, description: 'Sanitized text; never parsed as phone/identifier' },
];

const FIELD_MAP = new Map(CANONICAL_FIELDS.map(f => [f.key, f]));

export function isValidMappingTarget(target: string): boolean {
  const [key, suffix] = target.split('.');
  const field = FIELD_MAP.get(key);
  if (!field) return false;
  if (!suffix) return true;
  if (field.type === 'datetime') return suffix === 'date' || suffix === 'time';
  if (field.type === 'address') return ['street', 'city', 'state', 'zip'].includes(suffix);
  return false;
}

export function requiredKeys(overrides: string[]): Set<string> {
  const skip = new Set(overrides);
  return new Set(CANONICAL_FIELDS.filter(f => f.required && !skip.has(f.key)).map(f => f.key));
}
