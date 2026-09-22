# Trip Import & Data Entry Improvements — Design Spec

- **Date:** 2026-09-21
- **Status:** Approved (design approved by user 2026-09-21)
- **Source requirement:** `Documentation/MediRoutes_Current_State_Admin_Documentation.docx`, section "Import and Data Entry Improvements" (the only future-state, actionable spec in that document)
- **Scope decision:** Implement the Import & Data Entry feature only, plus stabilization bug fixes. Full MediRoutes parity (Users & Roles, Fleet, Funding Sources, WMR, Notifications, Inspections, Reports, Settings) is explicitly **out of scope** for this round.

---

## 1. Background

MidTransport's Phase 1 MVP exists and works (auth/RBAC, riders, drivers, trips kanban, live GPS map, geofence→OTP pipeline, rider CSV import, audit log, Docker deployment). The requirements document specifies a future-state trip intake system with three methods:

1. **Standard CSV import** — upload, validate, preview, import in one guided flow
2. **Vendor-mapped CSV import** — saved, versioned vendor profiles with auto-detection; review only exceptions
3. **Simplified manual entry** — short guided form sharing the same validation service

Two real vendor CSV layouts were supplied and analyzed (Vendor A: MTM/MTMlink, 41 human-readable columns, Windows-1252; Vendor B: ModivCare-style, 29 camelCase columns, UTF-8 with BOM). Neither is the universal contract — a canonical trip model plus reusable vendor mapping profiles is the core design decision.

### Decisions already made (user-approved)

| Decision | Choice |
|---|---|
| Rebuild vs. modify | **Modify** existing codebase; gaps are absent features, not wrong architecture |
| Implementation approach | **Option 1**: pure, unit-tested import engine inside `apps/api/src/services/importEngine/` + thin API layer + web wizard |
| Unmatched passengers on import | **Match, else auto-create** (normalized first+last+DOB, phone fallback); preview shows "N new passengers will be created" |
| `medical_id` (Medicaid number) | **Include as optional text** on riders (consistent with existing `insurance_id`); never coerce to number, never drop leading zeroes |

## 2. Goals / Non-goals

**Goals**
- All 8 developer acceptance criteria from the source document (Section 10)
- Both supplied vendor CSV layouts parse via separate saved profiles without editing source headings
- Windows-1252 and UTF-8-with-BOM import cleanly after conversion to UTF-8
- Manual entry and CSV import call the same validation rules and produce the same canonical trip model (AC #7)
- Role-gated import permissions + audit trail (AC #8)

**Non-goals (this round)**
- Users & Roles permission-matrix module (import permissions use existing hardcoded RBAC)
- Funding Sources / Fleet / WMR / Notifications / Inspections / Reports / Settings modules
- Broker API integrations (Phase 2 per PROPOSAL.md) — though the engine is designed to be reusable for it
- Migrating the existing rider CSV import onto the new engine (it works; can be revisited later)

## 3. Stabilization prerequisite (Phase 0)

Existing wiring bugs discovered during gap analysis must be fixed first; the import feature builds on the same API contracts:

1. **Mobile `driver:location-update`** emits `latitude`/`longitude`; server expects `lat`/`lng` + `driverId` → GPS silently dropped. Fix mobile to match server contract; server is the authority.
2. **Mobile OTP verify** posts `{ otp }`; server expects `{ code }` → always 400. Fix mobile.
3. **Mobile `driver:start-shift`** emits no payload; server expects `{ driverId }`. Fix mobile + hydrate shift state from `drivers.on_shift` instead of local `useState`.
4. **Web Reports page** reads fields the API doesn't return (`trips.total`, `completion_rate`, `otp.verification_rate`…). Align to actual `/api/reports/summary` response.
5. **`TripDetailModal`** initializes `dispatcherNotes` to empty, wiping notes on edit. Initialize from trip.

Also in Phase 0: introduce **Vitest** in `apps/api` (no test infrastructure exists anywhere in the repo).

## 4. Architecture

```
apps/api/src/services/importEngine/     ← pure functions; no Express/DB imports
  encoding.ts     BOM + Windows-1252/UTF-8 detection; decode everything to UTF-8
  csvParse.ts     RFC 4180 parse via papaparse (existing dep); skip blank rows;
                  reject duplicate or blank header names
  normalize.ts    Unicode NFKC; strip BOM/null/control/zero-width chars; trim;
                  collapse internal whitespace; per-category cleanup (§7)
  canonical.ts    canonical field registry: key, type, required-by-workflow, description
  profiles.ts     header-signature auto-detect (exact + scored match)
  mapping.ts      apply profile column map + controlled-value translations → canonical rows
  validate.ts     required fields, dates, phones, ZIPs, controlled values,
                  in-file + DB duplicates → stable error codes (§8)
  errors.ts       error-code registry with corrective-guidance messages
apps/api/src/routes/importTrips.ts      ← thin HTTP layer over the engine
apps/api/src/routes/vendorProfiles.ts   ← profile CRUD + detect
apps/api/src/routes/geocode.ts          ← Nominatim search proxy (address autocomplete)
apps/web/src/pages/ImportTrips/         ← wizard page (§9)
apps/web/src/pages/ImportProfiles/      ← vendor profile manager
packages/shared/src/types/import.ts     ← canonical trip types shared API↔web
```

Engine purity rule: `importEngine/*` must not import Express, `pg`, Redis, or network modules. DB access (duplicate checks, rider matching, geocoding) happens in the route/service layer via injected callbacks — this keeps the engine unit-testable and reusable for Phase 2 broker APIs.

## 5. Data model (additive migration only — no destructive changes)

### New tables

```sql
vendor_profiles (
  id SERIAL PK, org_id INT NOT NULL → organizations,
  name VARCHAR(200) NOT NULL, is_active BOOLEAN DEFAULT TRUE,
  created_by INT → users, created_at, updated_at,
  UNIQUE (org_id, name)
)

vendor_profile_versions (              -- immutable; never updated in place
  id SERIAL PK, profile_id INT NOT NULL → vendor_profiles ON DELETE CASCADE,
  version INT NOT NULL,                -- 1, 2, 3… per profile
  config JSONB NOT NULL,               -- see below
  created_by INT → users, created_at,
  UNIQUE (profile_id, version)
)
-- config JSONB: { headerSignature: string[], columnMap: { sourceHeader → canonicalKey },
--   encoding, delimiter, dateFormat, timeFormat, timezone,
--   valueTranslations: { canonicalKey → { sourceValue → targetValue } },
--   defaults: { canonicalKey → value }, requiredOverrides: string[] }

levels_of_service (
  id SERIAL PK, org_id INT NOT NULL → organizations,
  code VARCHAR(20) NOT NULL,           -- e.g. AMB, STR, WCH
  label VARCHAR(100) NOT NULL, is_active BOOLEAN DEFAULT TRUE,
  UNIQUE (org_id, code)
)
-- Seeded per org: AMB (Ambulatory), STR (Stretcher), WCH (Wheelchair)

import_uploads (                       -- staged raw file so preview/validate/execute are separate calls
  id SERIAL PK, org_id INT NOT NULL → organizations,
  uploaded_by INT → users, filename VARCHAR(255), sha256 CHAR(64) NOT NULL,
  content BYTEA NOT NULL, detected_encoding VARCHAR(20), row_count INT,
  expires_at TIMESTAMPTZ NOT NULL,     -- now + 2 hours; cleaned lazily on insert
  created_at TIMESTAMPTZ DEFAULT NOW()
)
```

### Extended tables

```sql
ALTER TABLE trips ADD COLUMN external_trip_id VARCHAR(100);
ALTER TABLE trips ADD COLUMN appointment_at TIMESTAMPTZ;
ALTER TABLE trips ADD COLUMN level_of_service VARCHAR(20);
ALTER TABLE trips ADD COLUMN additional_passengers INTEGER DEFAULT 0;
ALTER TABLE trips ADD COLUMN assistance_needs TEXT;
ALTER TABLE trips ADD COLUMN trip_type VARCHAR(50);
ALTER TABLE trips ADD COLUMN source_vendor_profile_id INTEGER REFERENCES vendor_profiles(id);
ALTER TABLE trips ADD COLUMN import_job_id INTEGER REFERENCES import_jobs(id);
CREATE UNIQUE INDEX trips_external_id_unique ON trips (org_id, source_vendor_profile_id, external_trip_id)
  WHERE external_trip_id IS NOT NULL;

ALTER TABLE riders ADD COLUMN first_name VARCHAR(100);
ALTER TABLE riders ADD COLUMN last_name VARCHAR(100);
ALTER TABLE riders ADD COLUMN date_of_birth DATE;
ALTER TABLE riders ADD COLUMN medical_id VARCHAR(50);   -- optional; text only; leading zeroes preserved

ALTER TABLE import_jobs ADD COLUMN mode VARCHAR(20);                  -- test | all_or_nothing | valid_rows_only
ALTER TABLE import_jobs ADD COLUMN file_hash CHAR(64);
ALTER TABLE import_jobs ADD COLUMN vendor_profile_version_id INTEGER REFERENCES vendor_profile_versions(id);
ALTER TABLE import_jobs ADD COLUMN updated_rows INTEGER DEFAULT 0;
ALTER TABLE import_jobs ADD COLUMN duplicate_rows INTEGER DEFAULT 0;
ALTER TABLE import_jobs ADD COLUMN duplicate_policy VARCHAR(20);      -- skip | reject | update
```

`trips.rider_id` stays NOT NULL — import matches or creates a rider per row (§1 decisions). New rider records get `name = first_name + ' ' + last_name` (existing `name` column preserved for compatibility).

## 6. Canonical import fields

Per the source document's canonical field table; canonical keys are stable strings used in profile `columnMap` values:

| Canonical key | Type | Required | Notes |
|---|---|---|---|
| `external_trip_id` | text | yes | unique within (org, vendor) |
| `will_call` | boolean | no | default false; when true, `pickup_at` may be null. Mapped from vendor flag columns (e.g. Vendor A `Will Call Flag`) via profile yes/no translation |
| `appointment_at` | datetime | conditional | optional when pickup time supplied; org timezone applied |
| `pickup_at` | datetime | yes unless `will_call` | timezone-aware |
| `passenger_first_name` | text | yes | trimmed Unicode |
| `passenger_last_name` | text | yes | trimmed Unicode |
| `date_of_birth` | date | no | stored YYYY-MM-DD |
| `medical_id` | text | no | never numeric; preserve leading zeroes |
| `primary_phone` | phone | per org policy (default: yes) | digits + optional leading `+` |
| `alternate_phone` | phone | no | same normalization |
| `pickup_address` | structured address | yes | street/city/state/zip assembled |
| `dropoff_address` | structured address | yes | street/city/state/zip assembled |
| `level_of_service` | controlled | yes | translated via profile → `levels_of_service` code |
| `additional_passengers` | int | no | default 0, non-negative |
| `assistance_needs` | text | no | free text |
| `trip_type` | controlled | yes | translated via profile to org controlled list |
| `status` | controlled | no | recognized values only, else flag for review; maps onto existing `trip_status` enum |
| `distance_miles` | decimal | no | non-negative; not authoritative routing distance |
| `notes` | text | no | sanitized; never parsed as phone/identifier |

Will Call is represented by the canonical `will_call` boolean (table above), not inferred from missing times.

Manual-entry trips with an optional external reference but no vendor profile (`source_vendor_profile_id` NULL) are **not** covered by the dedupe unique index (Postgres treats NULLs as distinct) and are not deduplicated against vendor imports; their duplicate safety net is the passenger+date warning in the review step.

## 7. Normalization & cleanup rules

**All text:** NFKC; remove BOMs, null bytes, control chars, zero-width formatting chars; trim outer whitespace; collapse repeated internal spaces; curly quotes/full-width forms → stable equivalents.

| Category | Rule |
|---|---|
| Names | Preserve letters, spaces, apostrophes, hyphens, periods (e.g. `O'Name`, hyphenated). Digits/unsupported symbols → review warning, never silently altered |
| Addresses | Preserve letters, digits, spaces, `-`, `'`, `.`, `,`, `#`, unit markers (`Apt #4`, `Unit B`) |
| Phones | Strip spaces/parens/periods/hyphens; keep one leading `+`; validate digit count (7–15) |
| ZIP | Trim; accept 5 digits or ZIP+4; preserve leading zeroes; reject alphabetic for US ZIP |
| Numerics | Strip currency symbols/thousands separators only in fields mapped numeric; invariant decimal; never apply to IDs |
| Notes | Strip control chars; neutralize spreadsheet-formula prefixes (`=`, `+`, `-`, `@` at start → prefix with `'`) on export; preserve meaningful punctuation |

## 8. Error codes (stable, with corrective guidance)

| Code | Meaning |
|---|---|
| `E_REQUIRED_FIELD` | Required canonical field empty after mapping |
| `E_UNMAPPED_REQUIRED` | Profile lacks mapping for a required canonical field |
| `E_DATE_PARSE` / `E_TIME_PARSE` | Source value unparseable under profile date/time format |
| `E_PHONE_INVALID` | Fails digit-count validation after normalization |
| `E_ZIP_INVALID` | Fails US ZIP validation |
| `E_CONTROLLED_VALUE` | Value missing from profile's controlled-value translation |
| `E_DUPLICATE_IN_FILE` | Same `external_trip_id` twice in one file |
| `E_DUPLICATE_IN_DB` | Trip already imported for (org, vendor, external_trip_id); resolution per duplicate policy |
| `E_NUMERIC_PARSE` | Non-numeric value in numeric field |
| `W_NAME_SUSPICIOUS` | Digits/symbols in name field (review, not rejected) |
| `W_STATUS_UNKNOWN` | Unrecognized status value; imported as `scheduled`, flagged |

Every rejected row returns `{ rowNumber, sourceTripId, field, code, guidance }`. Guidance text lives in `errors.ts`. No error row may expose another rider's data (AC #6).

## 9. Import workflow & UI

Wizard at `/import/trips`, steps per the source document:

1. **Upload** — `.csv` only, limits displayed (20 MB / 10,000 rows); server detects encoding+delimiter, rejects non-CSV before processing rider data; file staged in `import_uploads`
2. **Map** — auto-detected profile shown (always displayed even on high confidence); recognized / unmapped / duplicate source columns; all required canonical fields must be mapped to continue; admin can save mapping as new profile version here
3. **Preview** — masked sample (first 10 rows, phones/IDs partially masked) + transformation notices + valid/warning/invalid counts
4. **Validate** — full-file validation report grouped by error code
5. **Import** — confirmation; mode selector: `test` (parse+validate only), `all_or_nothing` (admin only), `valid_rows_only`; duplicate policy: skip / reject / update (update = admin only)
6. **Results** — created / updated / skipped / duplicate / failed counts + downloadable error CSV
7. **Audit** — `import_jobs` row records uploader, timestamp, filename, sha256, profile+version, mode, counts; `audit_log` entries; generated trip IDs recorded; no sensitive field values logged

**Vendor profile manager** at `/import/profiles`: list, create-from-sample-upload (map headings → canonical fields), view version history. Create/edit = admin.

**Manual entry revamp** (`AddTripModal` → guided form):
- Passenger: search existing first; else capture first/last name, DOB or medical ID (per org config — default DOB), primary phone, assistance needs
- Trip: service date, pickup time or Will Call, trip type, level of service, optional external reference
- Addresses: autocomplete via `/api/geocode/search` (Nominatim proxy) + editable street/city/state/ZIP
- Return leg: one toggle — copies passenger + locations, reverses endpoints, captures return timing
- Review: plain-language summary, duplicate warning (same passenger + date), field-level validation messages
- Efficiency: save draft (localStorage), duplicate prior trip, keyboard-friendly order
- **Must call the same `/api/import/trips/validate` logic** (single canonical validation entry point) — AC #7

## 10. Acceptance criteria (from source document — the definition of done)

1. Both supplied CSV structures parse through separate saved profiles without editing source headings
2. Windows-1252 and UTF-8-with-BOM files import after conversion to UTF-8, no replacement-character corruption
3. Outer whitespace and unsupported control characters removed; meaningful punctuation in names/addresses intact
4. User can preview normalized data and correct mapping/value errors before any trip is created
5. Duplicate detection uses org + vendor + external trip ID, with explicit skip / reject / authorized-update policy
6. Every rejected row returns a stable error code and corrective message without exposing another rider's information
7. Manual entry and both CSV methods call the same validation rules and create the same canonical trip model
8. Import permissions, audit records, file retention, and sensitive-data access follow the application's role and privacy controls

## 11. Testing strategy

- **Vitest** in `apps/api` (new); engine unit tests: encoding detection, parsing edge cases (quoted commas/line breaks/embedded quotes), normalization per category, mapping + translations, all validation rules, dedupe logic
- **Synthetic fixtures only**: hand-authored fake CSVs matching Vendor A and Vendor B layouts. The real supplied CSVs contain PII and must NOT be committed (mirrors the document's own privacy boundary)
- Route-level tests for permission gating and workflow state transitions
- Manual verification pass against all 8 acceptance criteria with the real vendor files on a local/dev instance (not committed)

## 12. Phasing

| Phase | Content | Verification gate |
|---|---|---|
| 0 | Stabilization fixes + Vitest setup | Bugs verified fixed; `npm test` runs |
| 1 | Schema migration + seeds + shared types | Migration applies cleanly on fresh + existing DB |
| 2 | Import engine + unit tests + fixtures | Engine tests green |
| 3 | API layer: endpoints, profiles, permissions, audit, geocode proxy | Route tests green; manual curl checks |
| 4 | Web wizard + profile manager | Wizard walkthrough with both fixtures |
| 5 | Manual entry revamp | Creates identical canonical trip as CSV path |
| 6 | Acceptance-criteria checklist + README/AGENTS.md updates | All 8 ACs pass |
