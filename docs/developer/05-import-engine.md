# 05 — Import Engine

The trip CSV import is a staged, review-before-commit wizard backed by a pure, testable engine. Rider import is a simpler one-shot version.

- **Engine (pure):** `apps/api/src/services/importEngine/`
- **Orchestration (I/O + DB):** `apps/api/src/services/importRunner.ts`
- **HTTP:** `apps/api/src/routes/importTrips.ts` (trips), `import.ts` (riders), `vendorProfiles.ts` (profiles)
- **Web UI:** `apps/web/src/pages/ImportTrips/` (wizard) and `ImportProfiles/` (profile manager)

## Engine modules

| Module | Responsibility |
|---|---|
| `canonical.ts` | `CANONICAL_FIELDS` (the 19 target fields), `isValidMappingTarget`, `requiredKeys`. |
| `normalize.ts` | Value normalization: `normalizeText`, `normalizeName`, `normalizePhone`, `normalizeZip`, `normalizeNumeric` (NFKC, smart-char folding, control-char stripping). |
| `encoding.ts` | Byte→text decode with encoding detection. |
| `csvParse.ts` | CSV parse (papaparse) with structural validation (`CsvStructureError`). |
| `datetime.ts` | Parse dates/times using the profile's format tokens + timezone (luxon). |
| `mapping.ts` | Apply a `columnMap` to a raw row → a canonical trip object (handles address sub-parts and datetime `.date`/`.time` composition, value translations). |
| `validate.ts` | Validate canonical trips (required fields, phone/zip formats, LOS/status vocab) → issues with severity. |
| `profiles.ts` | `detectProfile(headers, candidates)` — header-signature match to auto-select a saved vendor profile (threshold 0.6). |
| `suggest.ts` | `suggestMapping(headers)` — **column auto-match** (see below). |
| `pipeline.ts` | Composes decode → parse → map → validate for analysis. |

## Canonical fields

Defined in `canonical.ts`. Each has `{ key, label, type, required, description }`. Types: `text, date, datetime, phone, zip, integer, decimal, boolean, address, controlled`.

Required: `external_trip_id`, `pickup_at` (unless will-call), `passenger_first_name`, `passenger_last_name`, `primary_phone`, `pickup_address`, `dropoff_address`, `level_of_service`, `trip_type`. (`appointment_at` can satisfy `pickup_at` via an engine fallback.)

**Mapping-target grammar** (values stored in a `columnMap`):
- Base field: `pickup_at`, `primary_phone`, …
- Address sub-part: `pickup_address.street|city|state|zip`, `dropoff_address.street|city|state|zip`
- Datetime sub-part: `pickup_at.date|time`, `appointment_at.date|time`

`isValidMappingTarget(target)` validates this grammar.

## Vendor profile config (`VendorProfileConfig`)

Stored as JSONB in `vendor_profile_versions.config` (typed in `packages/shared`). Fields:

| Field | Meaning |
|---|---|
| `headerSignature` | The source file's header list — used by `detectProfile`. |
| `columnMap` | `{ sourceHeader: canonicalTarget }`. |
| `encoding`, `delimiter` | Parse hints (`auto` / `,`). |
| `dateFormat`, `timeFormat`, `dateTimeFormat` | luxon tokens (e.g. `M/d/yyyy`, `H:mm`, `iso`). |
| `timezone` | IANA tz used to interpret naive date/times. |
| `valueTranslations` | Per-field value maps (e.g. LOS `AMB → ambulatory`). |
| `defaults` | Default values for unmapped fields. |
| `requiredOverrides` | Canonical keys to treat as not-required for this vendor. |

Profiles are **versioned**: saving a new mapping creates a new `vendor_profile_versions` row; imports pin to a specific `vendor_profile_version_id` for reproducibility.

## Column auto-match (`suggest.ts`)

`suggestMapping(headers: string[]): Record<string, string>` suggests a canonical target for each source header. **Confident matches only** — no fuzzy scoring.

Algorithm (per header):
1. **Normalize** — NFKC → lowercase → non-alphanumerics to spaces → collapse.
2. **Address sub-parts** — only when the header names *both* a location (`pickup/pu/origin/from` vs `dropoff/do/dest/destination/to`) and a part (`street/address`, `city`, `state`, `zip`). A bare "city" stays unmapped. "Pickup Address" → `pickup_address.street`.
3. **Datetime sub-parts** — `pickup`/`appointment` + `date`/`time` → `*_at.date`/`*_at.time`; both present → the base key.
4. **Base fields** — exact-normalized or full **token-set** equality against each field's key, label, or a curated **synonyms** table (e.g. `DOB→date_of_birth`, `LOS→level_of_service`, `MRN→medical_id`, `Tel→primary_phone`).

Guarantees: each canonical target is suggested at most once (first header wins); ambiguous/unknown headers are omitted. Extend matching by editing the `SYNONYMS` table in `suggest.ts`.

`suggestMapping` runs in `POST /api/import/trips/upload` and returns `suggestedMap` on the response. In the wizard, precedence is **user edits › saved profile mapping › auto-suggest**:

```
effective = { ...suggestedMap, ...savedProfileMap, ...userOverrides }
```

Design/plan docs: `docs/superpowers/specs/2026-09-25-import-column-auto-match-design.md`, `docs/superpowers/plans/2026-09-25-import-column-auto-match.md`.

## Trip import wizard flow

1. **Upload** (`POST /upload`) — file staged in `import_uploads` (2h TTL, SHA-256), headers parsed, `detectProfile` + `suggestMapping` run. Response drives the map step.
2. **Map** (`MapStep.tsx`) — per-column dropdowns prepopulated from `effective`. Suggestions show an "auto" pill; profile mappings win; user edits win over both. Admins can save the mapping as a new profile or new version.
3. **Preview** (`PreviewStep.tsx`) — masked sample of mapped rows.
4. **Validate** (`POST /analyze`) — dry run: counts (valid/warning/invalid/duplicates/new vs matched riders), notices, and per-row issues. No writes.
5. **Execute** (`POST /execute`):
   - `mode`: `test` (validate only), `all_or_nothing` (commit only if all valid), `valid_rows_only` (commit valid, skip invalid).
   - `duplicatePolicy`: `skip`, `reject`, or `update` — matched against the `trips_external_id_unique` index `(org_id, source_vendor_profile_id, external_trip_id)`.
6. **Results** (`ResultsStep.tsx`) — imported/updated/skipped/duplicate/error counts; rejected rows downloadable via `/jobs/:id/errors.csv`.

**Profileless imports:** the wizard can carry an unsaved inline config (`inlineConfig`) so a one-off file can be imported without persisting a profile; such imports dedupe only against other profileless imports (`source_vendor_profile_id = NULL`).

## Testing the engine

Pure engine modules are unit-tested in `apps/api/tests/importEngine/*.test.ts` (e.g. `suggest.test.ts`, `mapping.test.ts`, `validate.test.ts`, `profiles.test.ts`, `pipeline.test.ts`). Route behavior is tested in `apps/api/tests/routes/`. See [11 — Testing](11-testing.md).
