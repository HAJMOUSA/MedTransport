# Import Column Auto-Match Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-suggest a canonical field for each source column on the trip-import mapping step, prepopulate the dropdowns (confident matches only), and keep every selection editable without overriding a chosen vendor profile.

**Architecture:** A pure server-side matcher (`suggestMapping`) in the import engine builds an alias table from each canonical field's key, label, and a curated synonym dictionary, then matches normalized headers by exact or full-token-set equality. The upload endpoint returns the resulting `suggestedMap`; the web MapStep layers it beneath profile mappings and user edits (`{ ...suggestedMap, ...savedMap, ...overrides }`).

**Tech Stack:** TypeScript, Node/Express (API), Vitest (tests), React + @tanstack/react-query (web).

**Spec:** `docs/superpowers/specs/2026-09-25-import-column-auto-match-design.md`

---

## File Structure

- **Create** `apps/api/src/services/importEngine/suggest.ts` — the `suggestMapping` matcher (pure, no I/O).
- **Create** `apps/api/tests/importEngine/suggest.test.ts` — unit tests for the matcher.
- **Modify** `apps/api/src/routes/importTrips.ts` — call `suggestMapping` in the upload handler; add `suggestedMap` to the response.
- **Modify** `apps/web/src/pages/ImportTrips/types.ts` — add `suggestedMap` to `UploadInfo`.
- **Modify** `apps/web/src/pages/ImportTrips/MapStep.tsx` — layer suggestions into `effective`, add the "auto" pill and "Reset auto-matches" link.

---

## Task 1: The matcher (`suggestMapping`)

**Files:**
- Create: `apps/api/src/services/importEngine/suggest.ts`
- Test: `apps/api/tests/importEngine/suggest.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/tests/importEngine/suggest.test.ts`:

```ts
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

  it('leaves ambiguous or unknown headers unmapped', () => {
    const m = suggestMapping(['City', 'State', 'Date', 'Name', 'Widget Count']);
    expect(m).toEqual({});
  });

  it('returns an empty map for no headers', () => {
    expect(suggestMapping([])).toEqual({});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx vitest run tests/importEngine/suggest.test.ts`
Expected: FAIL — cannot find module `../../src/services/importEngine/suggest`.

- [ ] **Step 3: Write the implementation**

Create `apps/api/src/services/importEngine/suggest.ts`:

```ts
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
  appointment_at: ['appointment', 'appt', 'appointment time', 'appt time', 'appointment date', 'appt date'],
  pickup_at: ['pickup', 'pick up', 'pu', 'pickup time', 'pick up time', 'scheduled pickup', 'requested pickup', 'pickup datetime'],
  passenger_first_name: ['first name', 'fname', 'first', 'patient first name', 'member first name', 'rider first name', 'passenger first'],
  passenger_last_name: ['last name', 'lname', 'last', 'surname', 'patient last name', 'member last name', 'rider last name', 'passenger last'],
  date_of_birth: ['dob', 'birth date', 'birthdate', 'date of birth'],
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
        return isTaken(f.key) ? null : f.key;
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npx vitest run tests/importEngine/suggest.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Run the full engine suite to check for regressions**

Run: `cd apps/api && npx vitest run tests/importEngine`
Expected: PASS (all engine tests green).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/importEngine/suggest.ts apps/api/tests/importEngine/suggest.test.ts
git commit -m "feat(import): add confident-only column auto-match (suggestMapping)"
```

---

## Task 2: Return `suggestedMap` from the upload endpoint

**Files:**
- Modify: `apps/api/src/routes/importTrips.ts` (import at line 11-13 area; upload handler lines 84-105)

- [ ] **Step 1: Add the import**

In `apps/api/src/routes/importTrips.ts`, below the existing engine imports (near line 13, after the `CANONICAL_FIELDS` import), add:

```ts
import { suggestMapping } from '../services/importEngine/suggest';
```

- [ ] **Step 2: Compute and return the suggestion**

In the `/upload` handler, the block currently reads (lines ~94-105):

```ts
    const detection = detectProfile(parsed.headers, candidates);

    res.status(201).json({
      uploadId: staged!.id,
      filename: req.file.originalname,
      sha256,
      encoding,
      delimiter: ',',
      headers: parsed.headers,
      rowCount: parsed.rows.length,
      detectedProfile: detection,
    });
```

Replace it with:

```ts
    const detection = detectProfile(parsed.headers, candidates);
    const suggestedMap = suggestMapping(parsed.headers);

    res.status(201).json({
      uploadId: staged!.id,
      filename: req.file.originalname,
      sha256,
      encoding,
      delimiter: ',',
      headers: parsed.headers,
      rowCount: parsed.rows.length,
      detectedProfile: detection,
      suggestedMap,
    });
```

- [ ] **Step 3: Verify the API type-checks**

Run: `cd apps/api && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Run the route test suite (no regressions)**

Run: `cd apps/api && npx vitest run tests/routes`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/importTrips.ts
git commit -m "feat(import): return suggestedMap from trips upload endpoint"
```

---

## Task 3: Prepopulate the mapping UI (web)

**Files:**
- Modify: `apps/web/src/pages/ImportTrips/types.ts` (`UploadInfo`, lines 1-5)
- Modify: `apps/web/src/pages/ImportTrips/MapStep.tsx` (`effective` memo line 39; mapping row lines 116-130; actions/table area)

- [ ] **Step 1: Add `suggestedMap` to `UploadInfo`**

In `apps/web/src/pages/ImportTrips/types.ts`, the interface currently is:

```ts
export interface UploadInfo {
  uploadId: number; filename: string; sha256: string; encoding: string;
  delimiter: string; headers: string[]; rowCount: number;
  detectedProfile: { profileId: number; versionId: number; name: string; confidence: number } | null;
}
```

Replace it with:

```ts
export interface UploadInfo {
  uploadId: number; filename: string; sha256: string; encoding: string;
  delimiter: string; headers: string[]; rowCount: number;
  detectedProfile: { profileId: number; versionId: number; name: string; confidence: number } | null;
  suggestedMap: Record<string, string>;
}
```

- [ ] **Step 2: Layer suggestions into the effective mapping**

In `apps/web/src/pages/ImportTrips/MapStep.tsx`, the `savedMap`/`effective` block currently reads (lines 35-39):

```ts
  const savedMap: Record<string, string> = useMemo(
    () => profileDetail?.latestConfig?.columnMap ?? {},
    [profileDetail]
  );
  const effective = useMemo(() => ({ ...savedMap, ...state.mappingOverrides }), [savedMap, state.mappingOverrides]);
```

Replace it with:

```ts
  const savedMap: Record<string, string> = useMemo(
    () => profileDetail?.latestConfig?.columnMap ?? {},
    [profileDetail]
  );
  const suggestedMap: Record<string, string> = useMemo(
    () => state.upload?.suggestedMap ?? {},
    [state.upload]
  );
  // Precedence: user edits > saved profile mapping > auto-suggested
  const effective = useMemo(
    () => ({ ...suggestedMap, ...savedMap, ...state.mappingOverrides }),
    [suggestedMap, savedMap, state.mappingOverrides]
  );
```

- [ ] **Step 3: Show an "auto" pill on suggested rows and add a Reset link**

In `MapStep.tsx`, the column-mapping table block currently reads (lines 106-133):

```tsx
      {/* Column mapping table */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100">
              <th className="text-left px-4 py-3 font-medium text-gray-600">Source column ({state.upload?.headers.length ?? 0})</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Maps to canonical field</th>
            </tr>
          </thead>
          <tbody>
            {state.upload?.headers.map(h => (
              <tr key={h} className="border-b border-gray-50">
                <td className="px-4 py-2 font-mono text-xs text-gray-800">{h}</td>
                <td className="px-4 py-2">
                  <select
                    value={effective[h] ?? ''}
                    onChange={e => update({ mappingOverrides: { ...state.mappingOverrides, [h]: e.target.value } })}
                    className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm w-full max-w-xs"
                  >
                    <option value="">— ignore —</option>
                    {mappingOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
```

Replace it with:

```tsx
      {/* Column mapping table */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2 bg-gray-50 border-b border-gray-100">
          <span className="text-xs text-gray-500">
            Fields are auto-matched where confident — review and adjust as needed.
          </span>
          {Object.keys(state.mappingOverrides).length > 0 && (
            <button
              onClick={() => update({ mappingOverrides: {} })}
              className="text-xs text-blue-600 hover:underline"
            >
              Reset auto-matches
            </button>
          )}
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100">
              <th className="text-left px-4 py-3 font-medium text-gray-600">Source column ({state.upload?.headers.length ?? 0})</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Maps to canonical field</th>
            </tr>
          </thead>
          <tbody>
            {state.upload?.headers.map(h => {
              const val = effective[h] ?? '';
              const isAuto = val !== '' && !(h in savedMap) && !(h in state.mappingOverrides) && suggestedMap[h] === val;
              return (
                <tr key={h} className="border-b border-gray-50">
                  <td className="px-4 py-2 font-mono text-xs text-gray-800">{h}</td>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2">
                      <select
                        value={val}
                        onChange={e => update({ mappingOverrides: { ...state.mappingOverrides, [h]: e.target.value } })}
                        className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm w-full max-w-xs"
                      >
                        <option value="">— ignore —</option>
                        {mappingOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                      {isAuto && (
                        <span className="text-[10px] uppercase tracking-wide text-gray-400 border border-gray-200 rounded px-1.5 py-0.5">
                          auto
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
```

- [ ] **Step 4: Verify the web app type-checks**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Manual verification**

Run the app (or use the deployed instance), start a trip import, and upload a CSV with **no matching vendor profile**. Confirm:
- Dropdowns are prepopulated for confidently-matched columns; ambiguous ones stay "— ignore —".
- Matched-by-suggestion rows show a muted **"auto"** pill; profile-sourced rows do not.
- The required-fields warning reflects the suggested mappings.
- Editing a dropdown works, the "auto" pill disappears for that row, and **Reset auto-matches** clears manual edits back to suggestions.
- Selecting a vendor profile still applies its saved mapping, with suggestions only filling columns the profile leaves unmapped.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/ImportTrips/types.ts apps/web/src/pages/ImportTrips/MapStep.tsx
git commit -m "feat(import): prepopulate mapping with auto-matches + reset control"
```

---

## Self-Review

**Spec coverage:**
- Matcher `suggestMapping` with alias table (key/label/synonyms), normalization, confident-only rule, one-to-one, location-qualified sub-parts → Task 1.
- Folded into upload response (`suggestedMap`) → Task 2.
- Precedence `{ ...suggestedMap, ...savedMap, ...overrides }` → Task 3 Step 2.
- "auto" pill + Reset link, nothing removed → Task 3 Step 3.
- Tests (ModivCare/MTM-style, synonyms, one-to-one, ambiguous unmapped, sub-parts) → Task 1 Step 1.
- Error handling (empty headers → `{}`; missing `suggestedMap` → `{}` fallback) → Task 1 (empty test) + Task 3 Step 2 (`?? {}`).

**Placeholder scan:** none — every step has full code and exact commands.

**Type consistency:** `suggestMapping(headers: string[]): Record<string, string>` used identically in Task 1, Task 2 (route), and consumed as `UploadInfo.suggestedMap: Record<string, string>` in Task 3. `isValidMappingTarget` and `CANONICAL_FIELDS` imported from `./canonical` (verified to exist and be exported). Mapping-target grammar (`key`, `key.street|city|state|zip`, `key.date|time`) matches `mappingOptions` in MapStep and `isValidMappingTarget`.

**Note on datetime sub-parts:** "Pickup Time" → `pickup_at.time`; the required-field check in MapStep uses `target.split('.')[0]`, so `pickup_at.time` still satisfies the `pickup_at` requirement.
