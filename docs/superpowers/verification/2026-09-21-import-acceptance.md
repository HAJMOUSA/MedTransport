# Trip Import — Acceptance-Criteria Verification

- **Date:** 2026-09-23
- **Branch:** `trip-import`
- **Spec:** `docs/superpowers/specs/2026-09-21-trip-import-design.md` §10 (criteria quoted verbatim)
- **Environment caveat:** Docker is not available in the verification environment (daemon not running), so the live-stack walkthrough with the real vendor files could not be executed here. Each criterion below therefore has two parts: **(a) Verified here** — what is proven by the automated suite/builds, with evidence; **(b) Remaining live-stack steps** — exact steps for the user on a running local stack.
- **Privacy:** real vendor CSVs contain PII. They were never copied into the repo or this document; file names are referenced only. Synthetic fixtures (`apps/api/tests/fixtures/vendor-a.csv`, `vendor-b.csv`) are hand-authored fakes matching the two vendor layouts.

## Final verification run (this environment, 2026-09-23)

| Command | Result |
|---|---|
| `corepack pnpm --filter @midtransport/api test` | **100/100 tests green** (16 files, vitest run, ~4s) |
| `corepack pnpm --filter @midtransport/api build` | green (`tsc`, no errors) |
| `corepack pnpm --filter @midtransport/web build` | green (vite, built in ~8s; chunk-size warning only) |
| Mobile per-file typecheck: `apps\mobile\node_modules\.bin\tsc.cmd --noEmit --jsx react-native --esModuleInterop --skipLibCheck --moduleResolution node --target es2022 --module esnext apps\mobile\src\screens\ActiveTrip.tsx apps\mobile\src\screens\TripList.tsx` | green (exit 0). Note: required a minimal type-only fix in `TripList.tsx` (pre-existing TS2352 on `main`: `id: String(t.id)` in the FlatList item made `item as Trip` incomparable; fixed by keeping `id` numeric and using `keyExtractor={item => String(item.id)}` — no runtime change). `OTPEntry.tsx` was excluded per its known pre-existing expo-camera error, tracked separately. |

---

## AC 1 — Both supplied CSV structures parse through separate saved profiles without editing source headings

**Status: VERIFIED-BY-TESTS** (live confirmation with the real vendor files still required)

**(a) Verified here:**
- `apps/api/tests/importEngine/pipeline.test.ts` — describe `vendor A pipeline`: `parses 3 rows`; `row 1 valid with trimmed whitespace and correct UTC time`; `row 2 invalid: untranslated LOS`; `row 3 invalid: missing phone + duplicate trip ID in file`. Describe `vendor B pipeline`: `both rows resolve, ISO datetimes converted to UTC`. Describe `profile auto-detection`: `detects each vendor by headers`. Both fixtures are parsed through their own saved profile configs (`apps/api/tests/fixtures/profiles.ts`) with the vendor header rows verbatim — no heading edits.
- `apps/api/tests/importEngine/profiles.test.ts` — describe `detectProfile`: `exact match → confidence 1`; `high partial match wins`; `returns null below threshold`.

**(b) Remaining live-stack steps:**
1. `docker compose up`; log in as a dispatcher/admin.
2. Open `/import/profiles`; confirm (or create) the two vendor profiles — each with a versioned column mapping and header signature.
3. Open `/import`; upload the real Vendor A file (kept local, never committed) → confirm its profile is auto-detected and all rows parse without editing source headings.
4. Repeat with the real Vendor B file through its own profile.

## AC 2 — Windows-1252 and UTF-8-with-BOM files import after conversion to UTF-8, no replacement-character corruption

**Status: VERIFIED-BY-TESTS** (live confirmation with the real MTM file still required)

**(a) Verified here:**
- `apps/api/tests/importEngine/encoding.test.ts` — describe `encoding`: `detects UTF-8 BOM`; `detects plain UTF-8 with multibyte chars`; `falls back to windows-1252 for non-UTF-8 bytes`. Decoded output is asserted to contain the intended characters (no U+FFFD).
- Upload route records `detected_encoding` per upload (`apps/api/src/routes/importTrips.ts`, `POST /api/import/trips/upload`).

**(b) Remaining live-stack steps:**
1. On the live stack, upload the real MTM file (Windows-1252) at `/import`.
2. In the masked preview (wizard step 3), confirm accented/smart-quote characters render correctly — no `�` replacement characters.
3. After import, spot-check the same characters in the trips table / trip board.

## AC 3 — Outer whitespace and unsupported control characters removed; meaningful punctuation in names/addresses intact

**Status: VERIFIED-BY-TESTS** (preview inspection on real files remains)

**(a) Verified here:**
- `apps/api/tests/importEngine/normalize.test.ts` — describe `normalizeText`: `trims, collapses whitespace, strips control/zero-width chars`; `converts curly quotes to stable equivalents`; `preserves newlines only when asked`. Describe `normalizeName`: `preserves apostrophes, hyphens, periods`; `flags digits/symbols as suspicious without altering`. Also `normalizePhone`, `normalizeZip`, `normalizeNumeric` cases.
- `apps/api/tests/importEngine/pipeline.test.ts` — `row 1 valid with trimmed whitespace and correct UTC time` proves normalization inside the end-to-end pipeline on the fixture.

**(b) Remaining live-stack steps:**
1. Import a real file on the live stack; in wizard step 3 (masked preview), inspect rows whose names contain apostrophes/hyphens/periods and addresses with meaningful punctuation — confirm intact.
2. Confirm outer whitespace/control characters from the source file do not appear in previewed values.

## AC 4 — User can preview normalized data and correct mapping/value errors before any trip is created

**Status: NEEDS-LIVE-STACK** (UI walkthrough; there are no automated web tests. Server-side prerequisites are verified.)

**(a) Verified here (partial — server side only):**
- `apps/api/tests/importRunner.test.ts` — describe `runAnalysis`: `runs full pipeline: counts, masked sample, recognized/unmapped headers` (the analyze endpoint returns the masked preview + mapping summary before anything is executed); `applies mapping overrides to config and recognized headers` (user corrections are re-applied server-side).
- Web build green: wizard components for all five steps (upload → map → masked preview → validate/execute → results) compile (`apps/web/src/pages/import/`, routes `/import`, `/import/profiles` in `apps/web/src/App.tsx`).

**(b) Remaining live-stack steps:**
1. `docker compose up`; open `/import`.
2. Upload a fixture; on the mapping step deliberately change one column mapping and one value translation.
3. Advance to the masked preview: confirm the correction is reflected and PII masking (phone/medical ID) is applied.
4. Advance through validation; before clicking Import, confirm in the DB that no trips exist yet for the file's external IDs; then click Import and confirm trips are created only now.

## AC 5 — Duplicate detection uses org + vendor + external trip ID, with explicit skip / reject / authorized-update policy

**Status: VERIFIED-BY-TESTS** (live re-import walkthrough remains)

**(a) Verified here:**
- `apps/api/tests/importEngine/validate.test.ts` — `detects in-file and in-DB duplicates` (dedupe key scoped by org + vendor profile + external trip ID).
- `apps/api/tests/importRunner.test.ts` — `flags duplicates already in DB`.
- `apps/api/tests/importRunner.execute.test.ts` — describe `executeImport`: `duplicate policy skip skips the duplicate and counts it`; `duplicate policy reject fails the duplicate row`; `duplicate policy update updates the existing trip instead of inserting`; plus `valid_rows_only inserts only the valid row and reports counts`, `all_or_nothing fails the job when invalid rows exist (no inserts)`, and `valid_rows_only recovers past a single-row insert failure via per-row savepoint`.

**(b) Remaining live-stack steps:**
1. Import a fixture once on the live stack.
2. Re-import the identical file with policy **skip** → duplicates counted/skipped, no new trips.
3. Re-import with **reject** → duplicate rows fail with the duplicate error code; download the error CSV.
4. Re-import with **update** (admin) → existing trips updated in place (trip IDs unchanged, changed fields reflected).

## AC 6 — Every rejected row returns a stable error code and corrective message without exposing another rider's information

**Status: VERIFIED-BY-TESTS** (live error-CSV review on real data remains)

**(a) Verified here:**
- `apps/api/tests/importEngine/errors.test.ts` — describe `error registry`: `has guidance and severity for every code`; `makeIssue stamps severity from the registry` (stable codes + corrective guidance enforced for the whole registry).
- `apps/api/tests/routes/importJobsCsv.test.ts` — describe `GET /api/import/trips/jobs/:id/errors.csv`: `neutralizes spreadsheet-formula prefixes in vendor-controlled cells`; `keeps commas and quotes inside one fully quoted cell`; `emits E_INSERT message in the guidance column`; `returns 404 for an unknown job`. The error CSV contains only the importing file's own source row values plus code/guidance — no data about other riders is included in any issue payload.

**(b) Remaining live-stack steps:**
1. On the live stack, import a file containing deliberate bad rows; open the results step and download the error CSV.
2. Verify each rejected row has a stable `E_*` code and a plain-language corrective message.
3. Verify the CSV contains only that file's own rows (no other rider's information) and that cells are formula-neutralized.

## AC 7 — Manual entry and both CSV methods call the same validation rules and create the same canonical trip model

**Status: VERIFIED-BY-TESTS** (live both-ways comparison remains)

**(a) Verified here:**
- `apps/api/tests/routes/tripsCanonical.test.ts` — describe `POST /api/trips/validate-canonical`: `rejects unauthenticated`; `accepts a fully valid trip`; `flags a bad phone with E_PHONE_INVALID` (the same stable error code the import engine emits); `returns a duplicate warning when a matching trip exists`. Describe `POST /api/trips (extended)`: `requires riderId when no newRider is supplied`; `keeps the existing riderId path working`; `accepts a will-call trip with no scheduledPickupAt and stores will_call=true`; `still requires scheduledPickupAt when willCall is not set`; `creates an inline new rider and a return leg with swapped addresses`.
- The manual-entry endpoint and the import engine share the same canonical validation module and canonical trip shape (single validation entry point, per spec §9/§10).

**(b) Remaining live-stack steps:**
1. On the live stack, import one trip via CSV (either vendor profile).
2. Create the identical trip via the Add Trip modal (guided manual entry) on the trip board.
3. Compare the two trip records (rider linkage, addresses, times in UTC, LOS, status) — confirm the same canonical model.

## AC 8 — Import permissions, audit records, file retention, and sensitive-data access follow the application's role and privacy controls

**Status: VERIFIED-BY-TESTS** (mechanisms; live DB audit query + real 2-hour expiry check remain)

**(a) Verified here:**
- Permissions: `apps/api/tests/routes/importPermissions.test.ts` — describe `import route permissions`: `rejects unauthenticated`; `rejects driver role on upload`; `rejects non-admin execute with all_or_nothing`; `rejects non-admin profile creation`; `canonical-fields is reachable by dispatcher`.
- Audit: `apps/api/tests/importRunner.execute.test.ts` — inside `valid_rows_only inserts only the valid row and reports counts`, the `INSERT INTO audit_log` call is asserted with the acting org/user/role (`audit row written with acting role`, `[1, 9, 'admin', JOB_ID]`). Implementation: `apps/api/src/services/importRunner.ts` writes `entity_type='import_job'`, `action='import_executed'`, details = mode/counts/generated trip IDs only — no sensitive field values; `import_jobs` records uploader, timestamp, filename, sha256, profile+version, mode, counts. General mutating-request auditing: `apps/api/src/middleware/audit.ts`.
- Retention: uploads staged with `expires_at = NOW() + INTERVAL '2 hours'`, lazy purge on each upload, and every read guarded by `expires_at > NOW()` (`apps/api/src/routes/importTrips.ts`, `apps/api/src/services/importRunner.ts`). Test: `apps/api/tests/importRunner.test.ts` — `404s when upload is missing or expired`.
- Sensitive-data access: masked preview masks phone/medical ID while leaving names/addresses visible to authorized dispatchers only (`runAnalysis` masked-sample test, above).

**(b) Remaining live-stack steps:**
1. Run a real import on the live stack, then query: `SELECT org_id, user_id, user_role, entity_type, entity_id, action, details, created_at FROM audit_log WHERE entity_type = 'import_job' ORDER BY created_at DESC LIMIT 5;` — confirm the `import_executed` row with counts/trip IDs and no sensitive values.
2. Query `import_jobs` for the run — confirm filename, sha256, profile+version, mode, counts, uploader.
3. Upload expiry: stage an upload, wait past 2 hours (or `UPDATE import_uploads SET expires_at = NOW() - INTERVAL '1 minute' WHERE id = <id>;`), then re-run analyze against that uploadId → expect 404.
4. Log in as a driver and confirm the import routes/pages are unreachable (API 403s per the permission tests).

---

## Summary

| # | Criterion (short) | Status |
|---|---|---|
| 1 | Both CSV structures parse via separate saved profiles | VERIFIED-BY-TESTS |
| 2 | Windows-1252 + UTF-8-BOM import cleanly | VERIFIED-BY-TESTS |
| 3 | Whitespace/control chars removed, punctuation preserved | VERIFIED-BY-TESTS |
| 4 | Preview + correct before import | NEEDS-LIVE-STACK (server prerequisites verified) |
| 5 | Dedupe key + skip/reject/update policies | VERIFIED-BY-TESTS |
| 6 | Stable error codes, no cross-rider exposure | VERIFIED-BY-TESTS |
| 7 | Manual entry + CSV share validation/model | VERIFIED-BY-TESTS |
| 8 | Permissions, audit, retention, privacy | VERIFIED-BY-TESTS (live audit/expiry checks remain) |

All 8 criteria have their mechanisms proven by the 100-test API suite and green builds; AC 4 requires the live wizard walkthrough, and ACs 1, 2, 5, 6, 7, 8 list exact live-stack confirmation steps above to run with the real vendor files (which stay local and are never committed).

## Known limitations

- **Execute is synchronous within one request.** `POST /api/import/trips/execute` runs the whole import before responding (it now honestly returns `200` with the final job `status`, not `202`). A 10,000-row file can take minutes.
- **Proxy ceiling.** The nginx `/api/` proxy allows up to 300s (`proxy_read_timeout`/`proxy_send_timeout`). Imports exceeding that limit still complete server-side — the connection may drop, but the job keeps running; re-check `GET /api/import/trips/jobs/:id` (`statusUrl` in the execute response) for the final state.
- **Background queue is future work.** Moving execution to a real async job queue (with progress reporting) is deliberately out of scope for this branch.
