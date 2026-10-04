# CSV Trip Import — Smarter Mapping + Requested Vehicle Type

**Date:** 2026-10-04  ·  **Status:** Approved → implementation

## Problem

Real broker exports (e.g. the Dayton-area Medicaid `9-21-26.csv`) auto-map
poorly in the Trip Import wizard. Root causes in `suggest.ts`:

- Matching requires **exact or full token-set equality** against curated
  synonyms. Any extra/missing token breaks it: `Member's First Name` tokenizes to
  `[member, s, first, name]` (the possessive `'s`) and never equals `first name`;
  `Will Call Flag`, `Trip Mileage`, `Number of Additional Passengers`,
  `Medicaid Number` all miss for the same reason.
- Drop-off columns are labeled **`Delivery …`**, which `detectLocation` doesn't
  recognize, so Delivery Address/City/State/Zip don't map.
- There is **no field** for the broker's `Passenger Type`
  (Ambulatory / Manual Wheelchair / Electric Wheelchair / Scooter).

## Decisions (approved)

1. **Requested Vehicle Type** = new **free-text** canonical field, stored in a new
   `trips.requested_vehicle_type` column (lossless; no controlled list for now).
2. **Aggressive fuzzy** auto-mapping (substring/subset + typo tolerance), with
   guards to avoid junk matches.
3. **Do not** pre-seed a broker-specific profile; improve the engine + field and
   rely on the existing Save-as-Profile (admin-only).

## Design

### 1. `suggest.ts` — smarter matching
- **Normalize possessives:** strip `'s` / `s'` before tokenizing so apostrophes
  don't create stray tokens.
- **Broaden location detection:** `delivery`, `destination`, `drop`, `dropoff`,
  `do` → **dropoff**; `pickup`, `pick up`, `pu`, `origin`, `from`, `residence` →
  **pickup**.
- **Scored fuzzy pass** (after the existing strict pass): a canonical field's
  name/label/synonym matches a header when **all** of its tokens are contained in
  the header's tokens (subset), or each token is within Levenshtein ≤1 of a header
  token (only for tokens ≥4 chars). Score rewards longer/more-specific synonyms;
  a lone generic token (`type`, `number`, `date`, `name`) cannot match on its own.
- **Global one-to-one assignment:** rank all (header → field) candidates by score
  and assign greedily so the *best* header wins each target (not "first header
  wins"). Address/datetime sub-part logic runs first and is preserved.
- Add `pickup_at.time` synonym so a bare **`Time`** column maps to pickup time.
- New synonyms for `requested_vehicle_type`: `passenger type`, `vehicle type`,
  `space type`, `mobility type`, `requested vehicle type`.

**Expected mapping for `9-21-26.csv`:** Member's First/Last Name → passenger
first/last; Member's Phone Number → primary phone; Member's Alt Phone → alternate
phone; Medicaid Number → medical id; Trip Number → external trip id; Trip Mileage
→ distance; Will Call Flag → will call; Number of Additional Passengers →
additional passengers; Special Needs → assistance needs; Driver Notes → notes;
Trip Status → status; Pickup Address/City/State/Zip → pickup address parts;
Delivery Address/City/State/Zip → drop-off address parts; Date of Birth → DOB;
Passenger Type → requested vehicle type; Time → pickup time. (Pickup **date**:
this broker supplies `Appointment Date` + `Time`; the user maps Appointment Date →
pickup date in the Map step, and the saved profile remembers it.)

### 2. `requested_vehicle_type` — end to end
- `canonical.ts`: add field `{ key:'requested_vehicle_type', label:'Requested
  Vehicle Type', type:'text', required:false }`.
- `packages/shared`: add `requestedVehicleType: string | null` to `CanonicalTrip`.
- `normalize.ts`: populate it (sanitized free text).
- `validate.ts`: optional; sanitize + cap length (e.g. 100 chars). No controlled
  validation.
- `importRunner` execute: write to `trips.requested_vehicle_type` on insert and
  update.
- `migrate.ts`: `ALTER TABLE trips ADD COLUMN IF NOT EXISTS requested_vehicle_type
  VARCHAR(100)` (idempotent); add to `schema.sql` for fresh installs.
- Web: Map step reads canonical fields from `/canonical-fields`, so the new field
  appears automatically as a mappable target.

### 3. Save-as-profile
Already implemented (`SaveAsNewProfileButton` / `SaveVersionButton` →
`POST /api/import/profiles`, admin-only). `validateConfig` accepts any canonical
target via `isValidMappingTarget`, so the new field is savable with no change.
Verify the full column map + value translations persist.

## Testing (TDD)
- `suggest` test using the exact `9-21-26.csv` header list → assert each expected
  target above; assert generic lone tokens don't mis-map.
- `normalize` / `validate` tests for `requested_vehicle_type`.
- `importRunner` execute test → value lands in `trips.requested_vehicle_type`.
- Run the existing `importEngine` suite — no regressions.

## Rollout
Local verify (upload `9-21-26.csv`) → commit to
`feat/driver-app-mediroutes-parity` → deploy to Lightsail (pull + rebuild +
migrate) → re-test the upload headless.

## Out of scope
Controlled-list translation for vehicle type; broker-specific seeded profile;
auto-mapping the pickup date when only an appointment date + time exist.
