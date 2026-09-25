# Import Column Auto-Match — Design

**Date:** 2026-09-25
**Status:** Approved (design), pending implementation plan
**Area:** Trip CSV import wizard (`apps/web/src/pages/ImportTrips`, `apps/api/src/services/importEngine`)

## Problem

On the trip import mapping step, every source column defaults to "— ignore —".
Unless a saved vendor profile pre-fills the mapping, the user must manually map
every field for each new file. This is slow and error-prone, especially for
first-time / new-vendor imports (the profileless flow).

## Goal

Automatically suggest a canonical field for each source header (based on name
similarity + synonyms), prepopulate the mapping dropdowns, and keep every
selection editable. Auto-suggestions must never override a chosen vendor
profile's saved mapping.

## Decisions (agreed)

1. **Match aggressiveness:** confident matches only. Prefill exact / synonym /
   full-token-set matches. Ambiguous or weak matches stay "— ignore —" (no
   fuzzy edit-distance guessing).
2. **Profile interaction:** auto-match fills only the columns a selected profile
   does not already map. Precedence is **user edits › saved profile mapping ›
   auto-suggest**.
3. **Where the logic lives (Approach A):** server-side in the import engine,
   folded into the existing upload response (no extra round-trip, single source
   of truth for field vocabulary).

## Architecture

### 1. Matcher — `apps/api/src/services/importEngine/suggest.ts` (new)

Pure, deterministic function:

```ts
export function suggestMapping(headers: string[]): Record<string, string>
```

Returns a map of `sourceHeader -> canonicalTarget` (e.g. `"DOB" ->
"date_of_birth"`, `"PU City" -> "pickup_address.city"`). Targets use the same
grammar the UI already understands: a canonical key, or `key.part` for address
(`street|city|state|zip`) and datetime (`date|time`) sub-parts.

**Alias table.** For each field in `CANONICAL_FIELDS`, aliases are built from:
- the `key` with underscores split into words,
- the human `label`,
- a curated **synonyms** dictionary keyed by canonical key.

Initial synonyms (extendable):

| Canonical key | Synonyms (examples) |
|---|---|
| external_trip_id | trip id, trip #, confirmation, conf #, reservation, res id, leg id, vendor trip id |
| will_call | will call, willcall, wc, on demand |
| appointment_at | appointment, appt, appt time, appointment time |
| pickup_at | pickup, pu time, pickup time, pickup date/time, scheduled pickup |
| passenger_first_name | first name, fname, first, patient first, member first, rider first |
| passenger_last_name | last name, lname, last, surname, patient last, member last |
| date_of_birth | dob, d.o.b, birth date, birthdate |
| medical_id | member id, medicaid id, mrn, medical record, insurance id, patient id |
| primary_phone | phone, phone number, primary phone, home phone, tel, mobile, cell, contact number |
| alternate_phone | alt phone, secondary phone, phone 2, other phone, emergency phone |
| pickup_address | pickup address, pu address, origin, from address, pickup location |
| dropoff_address | dropoff address, do address, destination, dest, to address, dropoff location |
| level_of_service | los, level of service, service level, mode, space type |
| additional_passengers | additional passengers, extra passengers, escorts, companions, guests |
| assistance_needs | assistance, assistance needs, special needs, accommodations |
| trip_type | trip type, trip leg, direction, trip kind |
| status | status, trip status, state |
| distance_miles | distance, miles, mileage, trip miles |
| notes | notes, comments, remarks, special instructions, driver notes |

**Normalization.** `normalizeHeader(h)`: NFKC → lowercase → replace
non-alphanumerics with spaces → collapse whitespace → trim. Applied to both the
header and every alias before comparison. (Reuses the engine's existing
normalization philosophy; a small local helper is fine.)

**Confident match rule.** A header matches a target only when the normalized
header is **exactly equal** to an alias OR its **token set is exactly equal** to
an alias's token set (order-independent). No Levenshtein / partial scoring.

**Guardrails.**
- *One-to-one:* each canonical target is suggested at most once. If multiple
  headers match the same target, the first (by header order) wins; the rest stay
  unmapped.
- *Location-qualified sub-parts:* address and datetime sub-part targets are only
  suggested when the header identifies **both** the location (pickup: `pickup`,
  `pu`, `origin`, `from`; dropoff: `dropoff`, `do`, `dest`, `destination`, `to`)
  **and** the part (`street/address`, `city`, `state`, `zip`, or `date`/`time`).
  A bare "city" or "date" stays unmapped — pickup vs dropoff is ambiguous.
- A header that names only the location for an address (e.g. "Pickup Address")
  with no part qualifier maps to `pickup_address.street` (best-effort single
  column). Same pattern for dropoff.

### 2. Data flow

The upload endpoint in `apps/api/src/routes/importTrips.ts` already parses
headers and runs `detectProfile`. It additionally calls `suggestMapping(headers)`
and includes the result as `suggestedMap` on the upload response.

`UploadInfo` in `apps/web/src/pages/ImportTrips/types.ts` gains:

```ts
suggestedMap: Record<string, string>;
```

### 3. Precedence (MapStep)

`MapStep.tsx` currently computes:

```ts
const effective = { ...savedMap, ...state.mappingOverrides };
```

It becomes:

```ts
const suggestedMap = state.upload?.suggestedMap ?? {};
const effective = { ...suggestedMap, ...savedMap, ...state.mappingOverrides };
```

This yields the agreed precedence: user edits › profile › auto-suggest. No other
mapping logic changes — `cleanedMap(effective)` already flows accepted
suggestions into inline configs and saved profiles.

### 4. UI

- **"auto" pill:** each dropdown whose current value came from a suggestion
  (present in `suggestedMap`, absent from `savedMap` and `mappingOverrides`)
  shows a small muted "auto" badge, distinguishing guessed mappings from profile
  or manual ones.
- **"Reset auto-matches" link:** clears `state.mappingOverrides`, reverting to
  suggestions + profile. Subtle, near the mapping table.
- Nothing is removed; all dropdowns remain fully editable, including setting any
  back to "— ignore —".

### 5. Error handling

`suggestMapping` is pure and total: empty/duplicate headers return `{}` or a
partial map; never throws. If `suggestedMap` is absent from an older upload
response, the client falls back to `{}` (current behavior).

## Testing

Unit tests for `suggestMapping` (API engine):
- ModivCare-style headers → expected targets.
- MTM-style headers → expected targets.
- Generic clinic export (First Name, Last Name, DOB, Phone, Pickup Address, …).
- Synonyms resolve (DOB, LOS, MRN, Tel).
- One-to-one enforced when two headers collide on a target.
- Ambiguous headers ("city", "date", "phone2" vs unknown) stay unmapped where
  appropriate.
- Pickup/dropoff sub-part detection ("PU City" → `pickup_address.city`,
  "Dropoff Zip" → `dropoff_address.zip`).

Manual check: upload a file with no matching profile → dropdowns prepopulate with
confident matches, "auto" pills visible, required-field warning reflects
suggestions, edits and Reset behave.

## Out of scope (YAGNI)

- Fuzzy / edit-distance matching and confidence scoring in the UI.
- Learning from user corrections over time.
- Auto-matching for the riders CSV import (`CSVImport.tsx`) — trips only for now.
- Changing profile detection to use the new matcher (possible future reuse).

## Affected files

- **New:** `apps/api/src/services/importEngine/suggest.ts`
- **New:** `apps/api/src/services/importEngine/suggest.test.ts` (or existing test location)
- **Edit:** `apps/api/src/routes/importTrips.ts` (upload response includes `suggestedMap`)
- **Edit:** `apps/web/src/pages/ImportTrips/types.ts` (`UploadInfo.suggestedMap`)
- **Edit:** `apps/web/src/pages/ImportTrips/MapStep.tsx` (precedence layer, "auto" pill, Reset link)
