import { CANONICAL_FIELDS, isValidMappingTarget } from './canonical';

// Normalize a header/alias for comparison: NFKC, drop apostrophes (so "Member's"
// becomes "members" rather than "member s"), lowercase, non-alphanumerics to
// single spaces, collapse, trim.  "PU  City!" -> "pu city", "D.O.B" -> "d o b".
function norm(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/['’]/g, '')
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
  if (a.length !== b.length) return false; // guard: 'a a b b' (len 4) must not equal 'a b' (len 2) via set collapse
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size !== sb.size) return false;
  for (const t of sa) if (!sb.has(t)) return false;
  return true;
}

// Bounded Levenshtein for single-token typo tolerance.
function lev(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (Math.abs(m - n) > 1) return 2; // we only care about <= 1
  const prev = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(
        prev[j] + 1,
        prev[j - 1] + 1,
        diag + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
      diag = tmp;
    }
  }
  return prev[n];
}

// A synonym token "matches" a header token if equal, or (for tokens >= 4 chars)
// within one edit — typo tolerance without over-matching short tokens.
function tokenMatches(syn: string, hdr: string[]): boolean {
  if (hdr.includes(syn)) return true;
  if (syn.length >= 4) return hdr.some(h => h.length >= 4 && lev(syn, h) <= 1);
  return false;
}

// Every token of the synonym appears (fuzzily) in the header → synonym ⊆ header.
function synonymSubset(syn: string[], hdr: string[]): boolean {
  return syn.length > 0 && syn.every(s => tokenMatches(s, hdr));
}

// Do the synonym tokens appear as a contiguous, in-order run within the header?
// "phone number" is contiguous in "members phone number"; "member number" is not.
// A strong tie-breaker that prevents scattered-token false matches.
function isContiguous(syn: string[], hdr: string[]): boolean {
  if (syn.length === 0 || syn.length > hdr.length) return false;
  for (let start = 0; start + syn.length <= hdr.length; start++) {
    let ok = true;
    for (let k = 0; k < syn.length; k++) {
      if (!tokenMatches(syn[k], [hdr[start + k]])) { ok = false; break; }
    }
    if (ok) return true;
  }
  return false;
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
  medical_id: ['member id', 'medicaid id', 'medicaid number', 'medicaid no', 'mrn', 'medical record', 'medical record number', 'insurance id', 'patient id', 'medical id', 'member number'],
  primary_phone: ['phone', 'phone number', 'primary phone', 'home phone', 'tel', 'telephone', 'mobile', 'cell', 'cell phone', 'contact number', 'contact phone'],
  alternate_phone: ['alt phone', 'alternate phone', 'secondary phone', 'phone 2', 'other phone', 'emergency phone'],
  level_of_service: ['los', 'level of service', 'service level', 'mode', 'space type', 'transport type'],
  additional_passengers: ['additional passengers', 'extra passengers', 'escorts', 'companions', 'guests', 'number of passengers', 'passenger count'],
  assistance_needs: ['assistance', 'assistance needs', 'special needs', 'accommodations', 'mobility needs'],
  trip_type: ['trip type', 'trip leg', 'direction', 'trip kind', 'leg type'],
  status: ['status', 'trip status'],
  distance_miles: ['distance', 'miles', 'mileage', 'trip miles', 'trip mileage', 'distance miles'],
  notes: ['notes', 'comments', 'remarks', 'special instructions', 'driver notes', 'comment'],
  requested_vehicle_type: ['passenger type', 'vehicle type', 'mobility type', 'requested vehicle', 'requested vehicle type', 'space required'],
};

function detectLocation(n: string): 'pickup' | 'dropoff' | null {
  const pickup = /\b(pickup|pick up|pu|origin|from)\b/.test(n);
  const dropoff = /\b(dropoff|drop off|drop|do|dest|destination|to|delivery|deliver)\b/.test(n);
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

// Strict match: exact / full-token-set equality + address/datetime sub-parts.
// `isTaken` enforces one-to-one.
function matchHeaderStrict(header: string, isTaken: (target: string) => boolean): string | null {
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
    else if (wantsTime && !wantsDate) base = 'appointment_at'; // bare "Time" → appointment time (pickup falls back to appointment downstream)
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

interface FuzzyCandidate { field: string; matched: number; contig: number; extra: number; }

// Rank: more matched tokens, then contiguous over scattered, then fewest extras.
function better(a: FuzzyCandidate, b: FuzzyCandidate | null): boolean {
  if (!b) return true;
  if (a.matched !== b.matched) return a.matched > b.matched;
  if (a.contig !== b.contig) return a.contig > b.contig;
  return a.extra < b.extra;
}

// Best fuzzy (subset/typo) field for a header, or null. Headers that carry a
// pickup/dropoff location are intentionally excluded here: their address/datetime
// parts are handled by the strict pass, and a located column like
// "Delivery Phone Number" must NOT grab the passenger-level primary_phone.
function fuzzyCandidate(header: string): FuzzyCandidate | null {
  const n = norm(header);
  if (detectLocation(n)) return null;
  const t = tokens(header);

  let best: FuzzyCandidate | null = null;
  for (const f of CANONICAL_FIELDS) {
    if (f.type === 'address' || f.type === 'datetime') continue; // sub-part mapped only
    const aliases = [f.key.replace(/_/g, ' '), f.label, ...(SYNONYMS[f.key] ?? [])];
    let fieldBest: FuzzyCandidate | null = null;
    for (const alias of aliases) {
      const at = tokens(alias);
      if (at.length < 2) continue; // single generic tokens are left to the strict pass
      if (synonymSubset(at, t)) {
        const cand: FuzzyCandidate = {
          field: f.key,
          matched: at.length,
          contig: isContiguous(at, t) ? 1 : 0,
          extra: Math.max(0, t.length - at.length),
        };
        if (better(cand, fieldBest)) fieldBest = cand;
      }
    }
    if (fieldBest && better(fieldBest, best)) best = fieldBest;
  }
  return best;
}

/**
 * Suggest a canonical mapping target for each source header.
 *
 * Two passes: a confident strict pass (exact / full-token-set equality, address
 * and datetime sub-parts) runs first in header order (first header wins a target).
 * Then an aggressive fuzzy pass assigns the remaining headers by best score —
 * a field's synonym matches when all its tokens appear in the header (allowing a
 * one-character typo on tokens ≥4 chars), so noisy real-world headers like
 * "Member's First Name" or "Number of Additional Passengers" still map. Each
 * canonical target is suggested at most once.
 */
export function suggestMapping(headers: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  const taken = new Set<string>();

  // Pass A — strict, order-sensitive, first header wins.
  for (const h of headers) {
    if (h in result) continue; // ignore duplicate header strings
    const target = matchHeaderStrict(h, (tgt) => taken.has(tgt));
    if (target) {
      result[h] = target;
      taken.add(target);
    }
  }

  // Pass B — fuzzy, globally assigned by best score so the strongest header wins
  // each remaining target (not merely the first one encountered).
  const cands = headers
    .map((h, idx) => ({ h, idx, cand: h in result ? null : fuzzyCandidate(h) }))
    .filter((c): c is { h: string; idx: number; cand: FuzzyCandidate } => c.cand !== null)
    .sort((a, b) =>
      b.cand.matched - a.cand.matched ||
      b.cand.contig - a.cand.contig ||
      a.cand.extra - b.cand.extra ||
      a.idx - b.idx);

  const usedHeaders = new Set<string>();
  for (const { h, cand } of cands) {
    if (usedHeaders.has(h) || h in result) continue;
    if (taken.has(cand.field)) continue;
    result[h] = cand.field;
    taken.add(cand.field);
    usedHeaders.add(h);
  }

  return result;
}
