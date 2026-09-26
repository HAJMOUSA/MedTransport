import { CANONICAL_FIELDS, isValidMappingTarget } from './canonical';

// Normalize a header/alias for comparison: NFKC, lowercase, non-alphanumerics
// to single spaces, collapse, trim.  "PU  City!" -> "pu city", "D.O.B" -> "d o b".
function norm(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/ {2,}/g, ' ')
    .trim();
}

function tokens(s: string): string[] {
  return norm(s).split(' ').filter(Boolean);
}

// Order-independent token-set equality (confident match, no fuzzy scoring).
function sameTokenSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false; // guard against repeated-token set collapse
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size !== sb.size) return false;
  for (const t of sa) if (!sb.has(t)) return false;
  return true;
}

// Curated synonyms per canonical key. Address fields are handled separately
// (sub-parts), so they are intentionally absent here. 'state' is deliberately
// NOT a status synonym — a bare "State" column is an ambiguous address part.
const SYNONYMS: Record<string, string[]> = {
  external_trip_id: ['trip id', 'trip number', 'confirmation', 'confirmation number', 'reservation', 'reservation id', 'res id', 'leg id', 'vendor trip id', 'external id', 'external trip id'],
  will_call: ['will call', 'willcall', 'wc', 'on demand'],
  appointment_at: ['appointment', 'appt', 'appointment time', 'appt time'],
  pickup_at: ['pickup', 'pick up', 'pu', 'pickup time', 'pick up time', 'scheduled pickup', 'requested pickup', 'pickup datetime'],
  passenger_first_name: ['first name', 'fname', 'first', 'patient first name', 'member first name', 'rider first name', 'passenger first'],
  passenger_last_name: ['last name', 'lname', 'last', 'surname', 'patient last name', 'member last name', 'rider last name', 'passenger last'],
  date_of_birth: ['dob', 'd o b', 'birth date', 'birthdate', 'date of birth'],
  medical_id: ['member id', 'medicaid id', 'mrn', 'medical record', 'medical record number', 'insurance id', 'patient id', 'medical id', 'member number'],
  primary_phone: ['phone', 'phone number', 'primary phone', 'home phone', 'tel', 'telephone', 'mobile', 'cell', 'cell phone', 'contact number', 'contact phone'],
  alternate_phone: ['alt phone', 'alternate phone', 'secondary phone', 'phone 2', 'other phone', 'emergency phone'],
  level_of_service: ['los', 'level of service', 'service level', 'mode', 'space type', 'transport type'],
  additional_passengers: ['additional passengers', 'extra passengers', 'escorts', 'companions', 'guests', 'number of passengers', 'passenger count'],
  assistance_needs: ['assistance', 'assistance needs', 'special needs', 'accommodations', 'mobility needs'],
  trip_type: ['trip type', 'trip leg', 'direction', 'trip kind', 'leg type'],
  status: ['status', 'trip status'],
  distance_miles: ['distance', 'miles', 'mileage', 'trip miles', 'distance miles'],
  notes: ['notes', 'comments', 'remarks', 'special instructions', 'driver notes', 'comment'],
};

function detectLocation(n: string): 'pickup' | 'dropoff' | null {
  const pickup = /\b(pickup|pick up|pu|origin|from)\b/.test(n);
  const dropoff = /\b(dropoff|drop off|do|dest|destination|to)\b/.test(n);
  if (pickup === dropoff) return null; // neither, or ambiguous both
  return pickup ? 'pickup' : 'dropoff';
}

function detectAddressPart(n: string): 'street' | 'city' | 'state' | 'zip' | null {
  if (/\b(street|address|addr|location|line 1|line1)\b/.test(n)) return 'street';
  if (/\bcity\b/.test(n)) return 'city';
  if (/\b(state|province)\b/.test(n)) return 'state';
  if (/\b(zip|zipcode|zip code|postal|postal code)\b/.test(n)) return 'zip';
  return null;
}

// Try to match one header to a canonical target. `isTaken` enforces one-to-one.
function matchHeader(header: string, isTaken: (target: string) => boolean): string | null {
  const n = norm(header);
  const t = tokens(header);
  const loc = detectLocation(n);

  // 1. Address sub-parts — require an unambiguous location.
  if (loc) {
    const part = detectAddressPart(n);
    if (part) {
      const target = `${loc}_address.${part}`;
      if (isValidMappingTarget(target) && !isTaken(target)) return target;
    }
  }

  // 2. Datetime date/time sub-parts (pickup or appointment).
  const wantsDate = /\bdate\b/.test(n);
  const wantsTime = /\btime\b/.test(n);
  if (wantsDate || wantsTime) {
    let base: 'appointment_at' | 'pickup_at' | null = null;
    if (/\b(appointment|appt)\b/.test(n)) base = 'appointment_at';
    else if (loc === 'pickup' || /\b(pickup|pick up|pu)\b/.test(n)) base = 'pickup_at';
    if (base) {
      if (wantsDate && !wantsTime && !isTaken(`${base}.date`)) return `${base}.date`;
      if (wantsTime && !wantsDate && !isTaken(`${base}.time`)) return `${base}.time`;
      if (wantsDate && wantsTime && !isTaken(base)) return base; // single datetime column
    }
  }

  // 3. Base fields by key / label / synonym (exact or full-token-set equality).
  for (const f of CANONICAL_FIELDS) {
    if (f.type === 'address') continue; // handled in pass 1; no bare mapping
    const aliases = [f.key.replace(/_/g, ' '), f.label, ...(SYNONYMS[f.key] ?? [])];
    for (const alias of aliases) {
      if (n === norm(alias) || sameTokenSet(t, tokens(alias))) {
        if (!isTaken(f.key)) return f.key;
        break; // this field matched but its target is taken; try the next field
      }
    }
  }

  return null;
}

/**
 * Suggest a canonical mapping target for each source header. Confident matches
 * only (exact or full-token-set equality); ambiguous/unknown headers are omitted.
 * Each canonical target is suggested at most once (first header wins).
 */
export function suggestMapping(headers: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  const taken = new Set<string>();
  for (const h of headers) {
    if (h in result) continue; // ignore duplicate header strings
    const target = matchHeader(h, (tgt) => taken.has(tgt));
    if (target) {
      result[h] = target;
      taken.add(target);
    }
  }
  return result;
}
