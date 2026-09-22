# Trip Import & Data Entry — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the spec'd three-method trip intake system (standard CSV import, vendor-mapped CSV import, simplified manual entry) to MidTransport, after fixing the existing mobile↔API and Reports wiring bugs.

**Architecture:** Pure, unit-tested import engine in `apps/api/src/services/importEngine/` (no Express/DB/network imports — DB access injected via callbacks), thin HTTP layer in `apps/api/src/routes/`, React wizard in `apps/web/src/pages/ImportTrips/`. Spec: `docs/superpowers/specs/2026-09-21-trip-import-design.md`.

**Tech Stack:** Node.js + Express 4 + TypeScript (CommonJS, `tsc` build), PostgreSQL 16, React 18 + Vite + Tailwind + TanStack Query, Vitest (new), luxon (new, for timezone-correct date parsing), papaparse (existing).

## Global Constraints

- Engine purity: files under `apps/api/src/services/importEngine/` MUST NOT import `express`, `pg`, `ioredis`, `../db/*`, or perform network I/O.
- Upload limits: **20 MB / 10,000 rows**; reject non-`.csv` before processing (spec step 1).
- Identifiers, phones, medical IDs, ZIPs are always **text** — never coerce to number, never drop leading zeroes.
- Duplicate detection key: `(org_id, source_vendor_profile_id, external_trip_id)` (AC #5).
- Permissions: import + test mode = `admin`/`dispatcher`; `all_or_nothing` mode, `update` duplicate policy, and vendor profile create/edit = `admin` only (AC #8).
- All datetimes stored as UTC `TIMESTAMPTZ`; source times interpreted in the profile's IANA timezone (default = org timezone).
- Synthetic test fixtures only — the real CSVs in `Documentation/` and `docs/` contain PII and MUST NOT be copied into the repo or test fixtures.
- New API routes live under `/api/import/trips/*`, `/api/import/profiles*` and are registered in `apps/api/src/index.ts`.
- Code style: follow existing patterns — raw SQL via `query`/`queryOne` from `db/pool.ts`, `AppError` from `middleware/errorHandler.ts`, express-validator for input, 2-space indent, single quotes.
- Every task ends with a commit. Commit messages: `feat:`, `fix:`, `test:`, `refactor:` prefixes (repo convention from git log).

---

## Phase 0 — Stabilization

### Task 1: Vitest setup in apps/api

**Files:**
- Modify: `apps/api/package.json`
- Create: `apps/api/vitest.config.ts`
- Create: `apps/api/tests/sanity.test.ts`

**Interfaces:**
- Produces: `npm test` script in `apps/api`, used by every later engine task.

- [ ] **Step 1: Add devDependency + script**

In `apps/api/package.json`, add to `devDependencies`: `"vitest": "^2.1.9"`. Add to `scripts`: `"test": "vitest run"`.

- [ ] **Step 2: Create vitest config**

```ts
// apps/api/vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
```

- [ ] **Step 3: Sanity test**

```ts
// apps/api/tests/sanity.test.ts
import { describe, it, expect } from 'vitest';

describe('vitest setup', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 4: Install and run**

Run: `npm install --workspace=apps/api` then `npm test --workspace=apps/api`
Expected: 1 test passes.

- [ ] **Step 5: Commit**

```bash
git add apps/api/package.json apps/api/vitest.config.ts apps/api/tests/sanity.test.ts package-lock.json
git commit -m "test: add vitest to apps/api"
```

### Task 2: Fix mobile OTP verify payload

The server (`apps/api/src/routes/otp.ts:30`) validates `body('code')` — a 6-char numeric string. Mobile sends `{ otp }`, so verification always 400s.

**Files:**
- Modify: `apps/mobile/src/screens/OTPEntry.tsx:53`

- [ ] **Step 1: Apply fix**

In `apps/mobile/src/screens/OTPEntry.tsx`, change the verify mutation body field from `otp` to `code`:

```ts
// before
api.post(`/api/otp/${tripId}/verify`, { otp, eventType }).then(r => r.data),
// after
api.post(`/api/otp/${tripId}/verify`, { code: otp, eventType }).then(r => r.data),
```

- [ ] **Step 2: Typecheck mobile**

Run: `npx tsc --noEmit` in `apps/mobile`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/src/screens/OTPEntry.tsx
git commit -m "fix(mobile): send OTP code field expected by API"
```

### Task 3: Fix mobile shift + GPS payload contract

Server `locationHandler.ts` requires `{ driverId, lat, lng }` for `driver:location-update` and `{ driverId }` for `driver:start-shift`/`driver:end-shift`. Mobile sends neither `driverId` nor `lat`/`lng`, and never resolves its own driver ID. Also `TripList` shift state is local `useState` (resets on reload).

**Files:**
- Modify: `apps/api/src/routes/drivers.ts` (add `GET /me`)
- Create: `apps/mobile/src/hooks/useDriverProfile.ts`
- Modify: `apps/mobile/src/screens/TripList.tsx`
- Modify: `apps/mobile/src/screens/ActiveTrip.tsx`

**Interfaces:**
- Produces: `GET /api/drivers/me` → `{ id: number; on_shift: boolean; shift_started_at: string | null; vehicle_id: number | null }` (driver role only; 404 if the user has no driver profile).
- Produces: `useDriverProfile()` hook returning `{ driverId: number | undefined; onShift: boolean; isLoading: boolean }` (TanStack Query, `queryKey: ['driver-me']`).

- [ ] **Step 1: Add `GET /api/drivers/me` to `apps/api/src/routes/drivers.ts`**, placed immediately after `router.use(authenticate);`:

```ts
// ─── GET /api/drivers/me (current driver's own profile) ─────────────────────
router.get('/me', requireRole('driver'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const driver = await queryOne(
        `SELECT d.id, d.on_shift, d.shift_started_at, d.vehicle_id
         FROM drivers d WHERE d.user_id = $1 AND d.org_id = $2`,
        [req.user!.userId, req.user!.orgId]
      );
      if (!driver) return next(new AppError('Driver profile not found', 404));
      res.json(driver);
    } catch (err) { next(err); }
  }
);
```

NOTE: this route must be registered before any future `GET /:id` route; add a comment `// must precede /:id routes` above it.

- [ ] **Step 2: Create the hook**

```ts
// apps/mobile/src/hooks/useDriverProfile.ts
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

interface DriverProfile {
  id: number;
  on_shift: boolean;
  shift_started_at: string | null;
  vehicle_id: number | null;
}

export function useDriverProfile() {
  const { data, isLoading } = useQuery<DriverProfile>({
    queryKey: ['driver-me'],
    queryFn: () => api.get('/api/drivers/me').then(r => r.data),
    staleTime: 60_000,
  });
  return { driverId: data?.id, onShift: data?.on_shift ?? false, isLoading };
}
```

- [ ] **Step 3: Fix `TripList.tsx` shift toggle**

Replace `const [onShift, setOnShift] = useState(false);` with server-hydrated state and send `driverId`:

```ts
// remove: const [onShift, setOnShift] = useState(false);
// add near other hooks:
import { useDriverProfile } from '../hooks/useDriverProfile';
// inside component:
const { driverId, onShift } = useDriverProfile();

const toggleShift = useCallback(async () => {
  const socket = socketRef.current;
  if (!socket || !driverId) return;
  setShiftLoading(true);
  socket.emit(onShift ? 'driver:end-shift' : 'driver:start-shift', { driverId });
  // server updates DB; refetch profile to reflect truth
  setTimeout(() => {
    queryClient.invalidateQueries({ queryKey: ['driver-me'] });
    setShiftLoading(false);
  }, 500);
}, [onShift, driverId, socketRef, queryClient]);
```

- [ ] **Step 4: Fix `ActiveTrip.tsx` location payload**

Replace the `socket.emit('driver:location-update', { tripId, latitude: ..., longitude: ... })` block with the server contract. Add `import { useDriverProfile } from '../hooks/useDriverProfile';` and `const { driverId } = useDriverProfile();` in the component, then:

```ts
socket.emit('driver:location-update', {
  driverId,
  tripId,
  lat: loc.coords.latitude,
  lng: loc.coords.longitude,
  speedMph: loc.coords.speed ? loc.coords.speed * 2.237 : 0,
  headingDeg: loc.coords.heading ?? 0,
  accuracyM: Math.round(loc.coords.accuracy ?? 0),
});
```

Also guard the emit with `if (!socket?.connected || !driverId) return;`.

- [ ] **Step 5: Verify**

Run `npx tsc --noEmit` in `apps/mobile` (expect clean) and `npm run build --workspace=apps/api` (expect clean).
Manual check (if Docker env available): `docker compose up -d`, log in on web as admin, start shift on mobile → driver appears on live map.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/drivers.ts apps/mobile/src
git commit -m "fix(mobile): align shift/location socket payloads with server contract"
```

### Task 4: Fix Reports page ↔ API mismatch

`/api/reports/summary` returns `trips: { total_trips, completed, cancelled, no_shows, avg_delay_minutes, total_miles }`, `otp: { total_otp_events, verified, fallback_photos, expired }`, `drivers: [{ driver_name, completed, on_time_pct }]`. `pg` returns `COUNT`/`ROUND` aggregates as **strings**, so coerce with `Number()` client-side.

**Files:**
- Modify: `apps/web/src/pages/Reports.tsx`

- [ ] **Step 1: Replace the `ReportSummary` interface and derive computed values**

```ts
interface ReportSummary {
  period: { start: string; end: string };
  trips: {
    total_trips: string; completed: string; cancelled: string;
    no_shows: string; avg_delay_minutes: string | null; total_miles: string | null;
  };
  otp: {
    total_otp_events: string; verified: string; fallback_photos: string; expired: string;
  };
  drivers: Array<{ driver_name: string; completed: string; on_time_pct: string | null }>;
}
```

Inside the component, after the query, derive:

```ts
const totalTrips = Number(data?.trips.total_trips ?? 0);
const completed = Number(data?.trips.completed ?? 0);
const completionRate = totalTrips > 0 ? Math.round((completed / totalTrips) * 1000) / 10 : 0;
const otpTotal = Number(data?.otp.total_otp_events ?? 0);
const otpVerified = Number(data?.otp.verified ?? 0);
const verificationRate = otpTotal > 0 ? Math.round((otpVerified / otpTotal) * 1000) / 10 : 0;
const avgDelay = data?.trips.avg_delay_minutes != null ? Number(data.trips.avg_delay_minutes) : null;
```

- [ ] **Step 2: Update JSX bindings**

- `data.trips.total` → `totalTrips`
- `data.trips.completion_rate` → `completionRate`; `${data.trips.completed} completed` → `${completed} completed`
- On-Time card: `data.performance.on_time_percent` → per-driver avg is not returned; replace value with `avgDelay != null ? \`${avgDelay} min\`` and label `"Avg Pickup Delay"`, sub `"across completed trips"`. Delete the `performance` card's old sub.
- `data.otp.verification_rate` → `verificationRate`; `${data.otp.verified} / ${data.otp.total_verifications} trips` → `${otpVerified} / ${otpTotal} events`
- `data.trips.no_show` → `Number(data.trips.no_shows)`; `data.otp.fallback_photo` → `Number(data.otp.fallback_photos)`
- Driver table: `key={d.driver_id}` → `key={d.driver_name}`; `d.trips_completed` → `Number(d.completed)`; `d.on_time_percent` → `d.on_time_pct != null ? Number(d.on_time_pct) : '—'` (guard comparisons: `Number(d.on_time_pct) >= 80` etc.); `d.total_miles` → remove that column and its `<th>` (API doesn't return per-driver miles).
- CSV export rows: `[d.driver_name, Number(d.completed), d.on_time_pct ?? '', '']` — drop the miles column from the header too: `['Driver', 'Trips Completed', 'On-Time %']`.

- [ ] **Step 3: Verify**

Run: `npm run build --workspace=apps/web`
Expected: clean build. Manual: load `/reports` against a dev API and confirm cards render numbers (not `undefined`/`NaN`).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/Reports.tsx
git commit -m "fix(web): align Reports page with /api/reports/summary response shape"
```

### Task 5: Fix TripDetailModal wiping dispatcher notes

**Files:**
- Modify: `apps/web/src/components/TripBoard/TripDetailModal.tsx:25`

- [ ] **Step 1: Apply fix** — change `dispatcherNotes: '',` to initialize from the trip (verify the `Trip` type in `TripBoard.tsx` exposes `dispatcher_notes: string | null` first; if missing, add it):

```ts
dispatcherNotes: trip.dispatcher_notes ?? '',
```

- [ ] **Step 2: Verify** — `npm run build --workspace=apps/web` clean.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/TripBoard/
git commit -m "fix(web): preserve dispatcher notes when editing a trip"
```

---

## Phase 1 — Schema migration & shared types

### Task 6: Database migration (additive)

**Files:**
- Modify: `apps/api/src/db/schema.sql` (append new DDL so fresh installs get it via initdb)
- Modify: `apps/api/src/db/migrate.ts` (incremental block for existing installs)
- Modify: `.env.example`

**Interfaces:**
- Produces: tables `vendor_profiles`, `vendor_profile_versions`, `levels_of_service`, `import_uploads`; new columns on `trips`, `riders`, `import_jobs`, `organizations` exactly as specced (spec §5).

- [ ] **Step 1: Append to `schema.sql`** (before the SEED section; all statements idempotent where possible):

```sql
-- ─── TRIP IMPORT: org timezone, vendor profiles, LOS, staged uploads ────────
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS timezone VARCHAR(50) NOT NULL DEFAULT 'America/New_York';

ALTER TABLE riders
  ADD COLUMN IF NOT EXISTS first_name VARCHAR(100),
  ADD COLUMN IF NOT EXISTS last_name  VARCHAR(100),
  ADD COLUMN IF NOT EXISTS date_of_birth DATE,
  ADD COLUMN IF NOT EXISTS medical_id VARCHAR(50);

ALTER TABLE trips
  ADD COLUMN IF NOT EXISTS external_trip_id VARCHAR(100),
  ADD COLUMN IF NOT EXISTS appointment_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS level_of_service VARCHAR(20),
  ADD COLUMN IF NOT EXISTS additional_passengers INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS assistance_needs TEXT,
  ADD COLUMN IF NOT EXISTS trip_type VARCHAR(50),
  ADD COLUMN IF NOT EXISTS source_vendor_profile_id INTEGER,
  ADD COLUMN IF NOT EXISTS import_job_id INTEGER;

CREATE TABLE IF NOT EXISTS vendor_profiles (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(200) NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE (org_id, name)
);

CREATE TABLE IF NOT EXISTS vendor_profile_versions (
  id SERIAL PRIMARY KEY,
  profile_id INTEGER NOT NULL REFERENCES vendor_profiles(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  config JSONB NOT NULL,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE (profile_id, version)
);

ALTER TABLE trips
  ADD CONSTRAINT trips_vendor_profile_fk
  FOREIGN KEY (source_vendor_profile_id) REFERENCES vendor_profiles(id);

CREATE TABLE IF NOT EXISTS levels_of_service (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code VARCHAR(20) NOT NULL,
  label VARCHAR(100) NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  UNIQUE (org_id, code)
);

CREATE TABLE IF NOT EXISTS import_uploads (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  uploaded_by INTEGER REFERENCES users(id),
  filename VARCHAR(255),
  sha256 CHAR(64) NOT NULL,
  content BYTEA NOT NULL,
  detected_encoding VARCHAR(20),
  row_count INTEGER,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_import_uploads_org ON import_uploads(org_id, created_at DESC);

ALTER TABLE import_jobs
  ADD COLUMN IF NOT EXISTS mode VARCHAR(20),
  ADD COLUMN IF NOT EXISTS file_hash CHAR(64),
  ADD COLUMN IF NOT EXISTS vendor_profile_version_id INTEGER REFERENCES vendor_profile_versions(id),
  ADD COLUMN IF NOT EXISTS updated_rows INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS duplicate_rows INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS duplicate_policy VARCHAR(20),
  ADD COLUMN IF NOT EXISTS result_trip_ids INTEGER[];

CREATE UNIQUE INDEX IF NOT EXISTS trips_external_id_unique
  ON trips (org_id, source_vendor_profile_id, external_trip_id)
  WHERE external_trip_id IS NOT NULL;
```

NOTE on the FK: `schema.sql` runs on fresh DBs; `ADD CONSTRAINT trips_vendor_profile_fk` is not idempotent, so guard it in `schema.sql` with a DO block:

```sql
DO $$ BEGIN
  ALTER TABLE trips ADD CONSTRAINT trips_vendor_profile_fk
    FOREIGN KEY (source_vendor_profile_id) REFERENCES vendor_profiles(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
```

- [ ] **Step 2: Append incremental block to `migrate.ts`** (after the existing insurance-fields block): the same SQL as Step 1 (it is idempotent), plus LOS seed and org timezone from env:

```ts
// Trip import feature: canonical trip fields + vendor profiles + LOS + uploads
await db.query(`/* the full SQL block from Step 1, verbatim */`);

await db.query(
  `UPDATE organizations SET timezone = $1 WHERE slug = 'default' AND timezone = 'America/New_York'`,
  [process.env.ORG_TIMEZONE || 'America/New_York']
);

await db.query(
  `INSERT INTO levels_of_service (org_id, code, label)
   SELECT o.id, x.code, x.label FROM organizations o
   CROSS JOIN (VALUES ('AMB','Ambulatory'), ('STR','Stretcher'), ('WCH','Wheelchair')) AS x(code, label)
   WHERE NOT EXISTS (SELECT 1 FROM levels_of_service l WHERE l.org_id = o.id)`
);
logger.info('Trip import schema applied');
```

- [ ] **Step 3: Add to `.env.example`**: `ORG_TIMEZONE=America/New_York` with comment `# IANA timezone used to interpret imported trip times`.

- [ ] **Step 4: Verify**

```bash
docker compose down -v && docker compose up -d db && docker compose up -d
docker compose exec db psql -U midtransport -d midtransport -c "\d vendor_profile_versions" -c "SELECT code,label FROM levels_of_service"
```

Expected: table exists; 3 LOS rows seeded. (If Docker is unavailable in the dev environment, verify with `npm run build --workspace=apps/api` for syntax and defer DB verification to the user's next `docker compose up`.)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/db/schema.sql apps/api/src/db/migrate.ts .env.example
git commit -m "feat(db): trip import schema — vendor profiles, LOS, uploads, canonical trip fields"
```

### Task 7: Shared types package (types-only)

A types-only workspace package — no build step. Both apps consume it with `import type` only (erased at compile time; tsc/vite resolve via workspace symlink).

**Files:**
- Create: `packages/shared/package.json`
- Create: `packages/shared/src/index.ts`
- Modify: root `package.json` (workspaces)
- Modify: `apps/api/package.json` + `apps/web/package.json` (add dependency)

**Interfaces:**
- Produces: `CanonicalTrip`, `StructuredAddress`, `VendorProfileConfig`, `ImportIssue`, `ImportErrorCode`, `ImportMode`, `DuplicatePolicy` — consumed by API routes and web wizard via `import type { ... } from '@midtransport/shared'`.

- [ ] **Step 1: Create `packages/shared/package.json`**

```json
{
  "name": "@midtransport/shared",
  "version": "1.0.0",
  "private": true,
  "description": "Shared TypeScript types (type-only package — no runtime code)",
  "main": "src/index.ts",
  "types": "src/index.ts"
}
```

- [ ] **Step 2: Create `packages/shared/src/index.ts`**

```ts
// Canonical trip import types — shared between API and web (type-only).
export interface StructuredAddress {
  street: string;
  city: string;
  state: string;
  zip: string;
}

export interface CanonicalTrip {
  externalTripId: string | null;
  willCall: boolean;
  appointmentAt: string | null;      // ISO 8601 with offset
  pickupAt: string | null;           // ISO 8601 with offset; null allowed when willCall
  passengerFirstName: string | null;
  passengerLastName: string | null;
  dateOfBirth: string | null;        // YYYY-MM-DD
  medicalId: string | null;
  primaryPhone: string | null;       // digits + optional leading +
  alternatePhone: string | null;
  pickupAddress: StructuredAddress | null;
  dropoffAddress: StructuredAddress | null;
  levelOfService: string | null;     // org levels_of_service.code
  additionalPassengers: number;
  assistanceNeeds: string | null;
  tripType: string | null;
  status: string | null;             // maps onto trip_status enum subset
  distanceMiles: number | null;
  notes: string | null;
}

export interface VendorProfileConfig {
  headerSignature: string[];                          // exact source headers, order as uploaded
  columnMap: Record<string, string>;                  // source header → canonical key (datetime: '.date'/'.time' suffix; addresses: '.street'/'.city'/'.state'/'.zip' suffix)
  encoding: 'utf-8' | 'windows-1252' | 'auto';
  delimiter: string;                                  // ',' supported
  dateFormat: string;                                 // luxon tokens, e.g. 'M/d/yyyy'
  timeFormat: string;                                 // e.g. 'H:mm' or 'h:mm a'
  dateTimeFormat: string;                             // e.g. "yyyy-MM-dd'T'HH:mm:ss" or 'iso'
  timezone: string;                                   // IANA, e.g. 'America/New_York'
  valueTranslations: Record<string, Record<string, string>>; // canonicalKey → { sourceValue → targetValue }
  defaults: Record<string, string>;                   // canonicalKey → literal default
  requiredOverrides: string[];                        // canonical keys forced optional
}

export type ImportErrorCode =
  | 'E_REQUIRED_FIELD' | 'E_UNMAPPED_REQUIRED' | 'E_DATE_PARSE' | 'E_TIME_PARSE'
  | 'E_PHONE_INVALID' | 'E_ZIP_INVALID' | 'E_CONTROLLED_VALUE'
  | 'E_DUPLICATE_IN_FILE' | 'E_DUPLICATE_IN_DB' | 'E_NUMERIC_PARSE'
  | 'W_NAME_SUSPICIOUS' | 'W_STATUS_UNKNOWN';

export interface ImportIssue {
  row: number;                       // 1-based data row (header = row 0 conceptually; first data row = 2 in file terms — see engine note)
  sourceTripId: string | null;
  field: string | null;              // canonical key
  code: ImportErrorCode;
  guidance: string;
  severity: 'error' | 'warning';
}

export type ImportMode = 'test' | 'all_or_nothing' | 'valid_rows_only';
export type DuplicatePolicy = 'skip' | 'reject' | 'update';
```

Row-number convention (used everywhere): **row = line number in the source file, 1-based, header = 1, so first data row = 2** (matches the existing rider importer's `i + 2` convention and what users see in Excel).

- [ ] **Step 3: Wire workspaces** — root `package.json`: `"workspaces": ["apps/api", "apps/web", "packages/shared"]`. Add `"@midtransport/shared": "*"` to `dependencies` of both `apps/api/package.json` and `apps/web/package.json`.

- [ ] **Step 4: Install + verify**

Run: `npm install` (root), then `npm run build --workspace=apps/api` and `npm run build --workspace=apps/web`
Expected: both compile. Sanity: temporarily add `import type { CanonicalTrip } from '@midtransport/shared';` to any file — build stays green (revert after check).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json packages/shared apps/api/package.json apps/web/package.json
git commit -m "feat(shared): types-only workspace package with canonical trip import types"
```

---

## Phase 2 — Import engine (pure functions, TDD)

All engine files live in `apps/api/src/services/importEngine/`. All tests in `apps/api/tests/importEngine/`. No Express/DB/network imports in engine files — enforced by a dependency test in Task 17.

### Task 8: Error registry (`errors.ts`)

**Files:**
- Create: `apps/api/src/services/importEngine/errors.ts`
- Test: `apps/api/tests/importEngine/errors.test.ts`

**Interfaces:**
- Produces: `ERROR_GUIDANCE: Record<ImportErrorCode, string>`, `ERROR_SEVERITY: Record<ImportErrorCode, 'error'|'warning'>`, `makeIssue(row: number, sourceTripId: string|null, field: string|null, code: ImportErrorCode): ImportIssue`.

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from 'vitest';
import { ERROR_GUIDANCE, ERROR_SEVERITY, makeIssue } from '../../src/services/importEngine/errors';
import type { ImportErrorCode } from '@midtransport/shared';

const ALL_CODES: ImportErrorCode[] = [
  'E_REQUIRED_FIELD','E_UNMAPPED_REQUIRED','E_DATE_PARSE','E_TIME_PARSE','E_PHONE_INVALID',
  'E_ZIP_INVALID','E_CONTROLLED_VALUE','E_DUPLICATE_IN_FILE','E_DUPLICATE_IN_DB',
  'E_NUMERIC_PARSE','W_NAME_SUSPICIOUS','W_STATUS_UNKNOWN',
];

describe('error registry', () => {
  it('has guidance and severity for every code', () => {
    for (const c of ALL_CODES) {
      expect(ERROR_GUIDANCE[c].length).toBeGreaterThan(10);
      expect(['error','warning']).toContain(ERROR_SEVERITY[c]);
    }
  });
  it('makeIssue stamps severity from the registry', () => {
    const issue = makeIssue(5, 'T-1', 'primary_phone', 'E_PHONE_INVALID');
    expect(issue).toMatchObject({ row: 5, sourceTripId: 'T-1', field: 'primary_phone', severity: 'error' });
    expect(issue.guidance).toBe(ERROR_GUIDANCE.E_PHONE_INVALID);
  });
});
```

- [ ] **Step 2: Run, verify fail** — `npm test --workspace=apps/api` → module not found.

- [ ] **Step 3: Implement `errors.ts`**

```ts
import type { ImportErrorCode, ImportIssue } from '@midtransport/shared';

export const ERROR_GUIDANCE: Record<ImportErrorCode, string> = {
  E_REQUIRED_FIELD: 'This field is required. Add a value in the source file or map a column that provides it.',
  E_UNMAPPED_REQUIRED: 'A required field has no mapped source column. Update the vendor profile mapping.',
  E_DATE_PARSE: 'Date could not be parsed with the profile date format. Fix the value or adjust the profile.',
  E_TIME_PARSE: 'Time could not be parsed with the profile time format. Fix the value or adjust the profile.',
  E_PHONE_INVALID: 'Phone number must contain 7-15 digits, optionally starting with +. Check the source value.',
  E_ZIP_INVALID: 'ZIP code must be 5 digits or ZIP+4 (e.g. 62701 or 62701-1234).',
  E_CONTROLLED_VALUE: 'Value is not in the profile translation table. Add a translation or fix the source value.',
  E_DUPLICATE_IN_FILE: 'This external trip ID appears more than once in the file. Remove the duplicate row.',
  E_DUPLICATE_IN_DB: 'A trip with this vendor trip ID was already imported. Choose a skip, reject, or update policy.',
  E_NUMERIC_PARSE: 'Expected a non-negative number. Remove non-numeric text from the value.',
  W_NAME_SUSPICIOUS: 'Name contains digits or unusual symbols. Verify it was not corrupted during export.',
  W_STATUS_UNKNOWN: 'Status value not recognized; the trip will import as Scheduled. Add a translation to map it.',
};

export const ERROR_SEVERITY: Record<ImportErrorCode, 'error' | 'warning'> = {
  E_REQUIRED_FIELD: 'error', E_UNMAPPED_REQUIRED: 'error', E_DATE_PARSE: 'error',
  E_TIME_PARSE: 'error', E_PHONE_INVALID: 'error', E_ZIP_INVALID: 'error',
  E_CONTROLLED_VALUE: 'error', E_DUPLICATE_IN_FILE: 'error', E_DUPLICATE_IN_DB: 'error',
  E_NUMERIC_PARSE: 'error', W_NAME_SUSPICIOUS: 'warning', W_STATUS_UNKNOWN: 'warning',
};

export function makeIssue(
  row: number, sourceTripId: string | null, field: string | null, code: ImportErrorCode
): ImportIssue {
  return { row, sourceTripId, field, code, guidance: ERROR_GUIDANCE[code], severity: ERROR_SEVERITY[code] };
}
```

- [ ] **Step 4: Run, verify pass** — `npm test --workspace=apps/api`
- [ ] **Step 5: Commit** — `git add apps/api/src/services/importEngine apps/api/tests/importEngine && git commit -m "feat(import): stable error-code registry"`

### Task 9: Encoding detection (`encoding.ts`)

**Files:**
- Create: `apps/api/src/services/importEngine/encoding.ts`
- Test: `apps/api/tests/importEngine/encoding.test.ts`

**Interfaces:**
- Produces: `type CsvEncoding = 'utf-8' | 'windows-1252'`; `detectEncoding(buf: Buffer): CsvEncoding`; `decodeCsv(buf: Buffer): { text: string; encoding: CsvEncoding }` (strips BOM). Consumed by Task 10 and the upload route.

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from 'vitest';
import { detectEncoding, decodeCsv } from '../../src/services/importEngine/encoding';

describe('encoding', () => {
  it('detects UTF-8 BOM', () => {
    const buf = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('a,b\n1,2')]);
    expect(detectEncoding(buf)).toBe('utf-8');
    expect(decodeCsv(buf).text.startsWith('a,b')).toBe(true); // BOM stripped
  });
  it('detects plain UTF-8 with multibyte chars', () => {
    const buf = Buffer.from('name\nJosé', 'utf-8');
    expect(detectEncoding(buf)).toBe('utf-8');
    expect(decodeCsv(buf).text).toContain('José');
  });
  it('falls back to windows-1252 for non-UTF-8 bytes', () => {
    // 0x93/0x94 = curly quotes in cp1252, invalid in UTF-8
    const buf = Buffer.from([0x6e, 0x61, 0x6d, 0x65, 0x0a, 0x93, 0x48, 0x69, 0x94]);
    expect(detectEncoding(buf)).toBe('windows-1252');
    expect(decodeCsv(buf).text).toBe('name\n\u201CHi\u201D'); // no U+FFFD corruption
  });
});
```

- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement**

```ts
export type CsvEncoding = 'utf-8' | 'windows-1252';

export function detectEncoding(buf: Buffer): CsvEncoding {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return 'utf-8';
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buf);
    return 'utf-8';
  } catch {
    return 'windows-1252';
  }
}

export function decodeCsv(buf: Buffer): { text: string; encoding: CsvEncoding } {
  const encoding = detectEncoding(buf);
  const text = new TextDecoder(encoding).decode(buf);
  return { text: text.replace(/^﻿/, ''), encoding };
}
```

(`TextDecoder` with the `windows-1252` label is built into Node 20 full-ICU — no new dependency. The `replace` strips a decoded BOM U+FEFF.)

- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat(import): CSV encoding detection (UTF-8 BOM / windows-1252)"`

### Task 10: CSV parsing (`csvParse.ts`)

**Files:**
- Create: `apps/api/src/services/importEngine/csvParse.ts`
- Test: `apps/api/tests/importEngine/csvParse.test.ts`

**Interfaces:**
- Produces: `class CsvStructureError extends Error`; `parseCsv(text: string, maxRows?: number): { headers: string[]; rows: Record<string,string>[]; rowNumbers: number[] }`. `rowNumbers[i]` = source-file line of `rows[i]` (header = 1, first data row = 2).

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from 'vitest';
import { parseCsv, CsvStructureError } from '../../src/services/importEngine/csvParse';

describe('parseCsv', () => {
  it('parses RFC 4180 quoting: commas, quotes, line breaks', () => {
    const { rows } = parseCsv('name,note\n"Doe, Jane","said ""hi""\nbye"\nSmith,plain');
    expect(rows[0].name).toBe('Doe, Jane');
    expect(rows[0].note).toBe('said "hi"\nbye');
    expect(rows[1].name).toBe('Smith');
  });
  it('skips blank rows and tracks source line numbers', () => {
    const { rows, rowNumbers } = parseCsv('a,b\n1,2\n\n3,4\n');
    expect(rows).toHaveLength(2);
    expect(rowNumbers).toEqual([2, 4]);
  });
  it('rejects duplicate headers', () => {
    expect(() => parseCsv('a,a\n1,2')).toThrow(CsvStructureError);
  });
  it('rejects blank header names', () => {
    expect(() => parseCsv('a,,c\n1,2,3')).toThrow(CsvStructureError);
  });
  it('enforces the row limit', () => {
    const big = 'a\n' + Array(10001).fill('x').join('\n');
    expect(() => parseCsv(big)).toThrow(/10,000/);
  });
});
```

- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement**

```ts
import Papa from 'papaparse';

export class CsvStructureError extends Error {
  constructor(message: string) { super(message); this.name = 'CsvStructureError'; }
}

export interface ParsedCsv {
  headers: string[];
  rows: Record<string, string>[];
  rowNumbers: number[];
}

export function parseCsv(text: string, maxRows = 10_000): ParsedCsv {
  const parsed = Papa.parse<string[]>(text, { header: false, skipEmptyLines: 'greedy' });
  const records = parsed.data;
  if (records.length < 1) throw new CsvStructureError('File is empty');

  const headers = records[0].map(h => h.trim());
  if (headers.some(h => h === '')) throw new CsvStructureError('File has blank column header names');
  const seen = new Set<string>();
  for (const h of headers) {
    if (seen.has(h)) throw new CsvStructureError(`Duplicate column header: "${h}"`);
    seen.add(h);
  }

  const dataRecords = records.slice(1);
  if (dataRecords.length > maxRows) {
    throw new CsvStructureError(`File has ${dataRecords.length} rows; the limit is 10,000 rows`);
  }

  const rows: Record<string, string>[] = [];
  const rowNumbers: number[] = [];
  dataRecords.forEach((rec, i) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, j) => { obj[h] = rec[j] ?? ''; });
    rows.push(obj);
    rowNumbers.push(i + 2); // header = line 1
  });
  return { headers, rows, rowNumbers };
}
```

NOTE: `skipEmptyLines: 'greedy'` removes fully blank lines, so line numbers stay accurate for well-formed files; a file with blank lines interleaved may shift numbers — acceptable (documented) since blank lines are ignored per the CSV contract.

- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat(import): RFC 4180 CSV parser with header validation and row limits"`

### Task 11: Normalization (`normalize.ts`)

**Files:**
- Create: `apps/api/src/services/importEngine/normalize.ts`
- Test: `apps/api/tests/importEngine/normalize.test.ts`

**Interfaces:**
- Produces: `normalizeText(v: string, opts?: { preserveNewlines?: boolean }): string`; `normalizeName(v): { value: string; suspicious: boolean }`; `normalizePhone(v): { value: string; valid: boolean }`; `normalizeZip(v): { value: string; valid: boolean }`; `normalizeNumeric(v): { value: number | null; ok: boolean }`.

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from 'vitest';
import { normalizeText, normalizeName, normalizePhone, normalizeZip, normalizeNumeric } from '../../src/services/importEngine/normalize';

describe('normalizeText', () => {
  it('trims, collapses whitespace, strips control/zero-width chars', () => {
    expect(normalizeText('  hello   world ')).toBe('hello world');
    expect(normalizeText('a​b﻿c')).toBe('abc'); // zero-width space + BOM char
  });
  it('converts curly quotes to stable equivalents', () => {
    expect(normalizeText('O’Brien “ok”')).toBe(`O'Brien "ok"`);
  });
  it('preserves newlines only when asked', () => {
    expect(normalizeText('a\nb')).toBe('a b');
    expect(normalizeText('a\nb', { preserveNewlines: true })).toBe('a\nb');
  });
});
describe('normalizeName', () => {
  it('preserves apostrophes, hyphens, periods', () => {
    expect(normalizeName("O'Brien-Smith Jr.")).toEqual({ value: "O'Brien-Smith Jr.", suspicious: false });
  });
  it('flags digits/symbols as suspicious without altering', () => {
    const r = normalizeName('Mary123');
    expect(r).toEqual({ value: 'Mary123', suspicious: true });
  });
});
describe('normalizePhone', () => {
  it('strips punctuation, keeps one leading +', () => {
    expect(normalizePhone('(313) 555-1234')).toEqual({ value: '3135551234', valid: true });
    expect(normalizePhone('+1 (313) 555-1234')).toEqual({ value: '+13135551234', valid: true });
  });
  it('rejects too-short and letter values', () => {
    expect(normalizePhone('123').valid).toBe(false);
    expect(normalizePhone('call me').valid).toBe(false);
  });
});
describe('normalizeZip', () => {
  it('accepts 5 and ZIP+4, preserves leading zeroes', () => {
    expect(normalizeZip(' 02134 ')).toEqual({ value: '02134', valid: true });
    expect(normalizeZip('62701-1234').valid).toBe(true);
    expect(normalizeZip('6270').valid).toBe(false);
    expect(normalizeZip('6270A').valid).toBe(false);
  });
});
describe('normalizeNumeric', () => {
  it('strips currency and thousands separators', () => {
    expect(normalizeNumeric('$1,234.50')).toEqual({ value: 1234.5, ok: true });
    expect(normalizeNumeric('0')).toEqual({ value: 0, ok: true });
  });
  it('rejects non-numeric and negative', () => {
    expect(normalizeNumeric('abc').ok).toBe(false);
    expect(normalizeNumeric('-3').ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement**

```ts
const CONTROL_CHARS = /[--­​-‏﻿]/g;
const SMART_CHARS: Record<string, string> = {
  '‘': "'", '’': "'", '‚': "'", '“': '"', '”': '"', '„': '"',
  '‐': '-', '‑': '-', '–': '-', '—': '-',
};

export function normalizeText(value: string, opts?: { preserveNewlines?: boolean }): string {
  let v = value.normalize('NFKC');
  v = v.replace(/[‘’‚“”„‐‑–—]/g, (ch) => SMART_CHARS[ch] ?? ch);
  v = v.replace(CONTROL_CHARS, (ch) =>
    opts?.preserveNewlines && ch === '\n' ? '\n' : ' ');
  if (!opts?.preserveNewlines) v = v.replace(/\n/g, ' ');
  return v.replace(/ {2,}/g, ' ').trim();
}

export function normalizeName(value: string): { value: string; suspicious: boolean } {
  const v = normalizeText(value);
  const suspicious = v !== '' && /[^\p{L}\p{M} .'\-]/u.test(v);
  return { value: v, suspicious };
}

export function normalizePhone(value: string): { value: string; valid: boolean } {
  let v = normalizeText(value).replace(/[\s().\-]/g, '');
  const hasPlus = v.startsWith('+');
  v = v.replace(/\+/g, '');
  if (hasPlus) v = '+' + v;
  return { value: v, valid: /^\+?\d{7,15}$/.test(v) };
}

export function normalizeZip(value: string): { value: string; valid: boolean } {
  const v = normalizeText(value).replace(/\s+/g, '');
  return { value: v, valid: /^\d{5}(-\d{4})?$/.test(v) };
}

export function normalizeNumeric(value: string): { value: number | null; ok: boolean } {
  const cleaned = normalizeText(value).replace(/[$,\s]/g, '');
  if (cleaned === '') return { value: null, ok: false };
  const n = Number(cleaned);
  return Number.isFinite(n) && n >= 0 ? { value: n, ok: true } : { value: null, ok: false };
}
```

NOTE: the `CONTROL_CHARS` regex literal contains invisible ranges — write it with escapes: `/[--­​-‏﻿]/g` covering C0 (keep \n handled separately), DEL+C1, soft hyphen, zero-width chars, line/paragraph separators, BOM.

- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat(import): field-aware normalization (names, phones, ZIPs, numerics)"`

### Task 12: Canonical field registry (`canonical.ts`)

**Files:**
- Create: `apps/api/src/services/importEngine/canonical.ts`
- Test: `apps/api/tests/importEngine/canonical.test.ts`

**Interfaces:**
- Produces: `CANONICAL_FIELDS: CanonicalFieldDef[]` (19 entries, table below); `isValidMappingTarget(target: string): boolean` (accepts a field key, or `.date`/`.time` suffix for datetime fields, or `.street`/`.city`/`.state`/`.zip` for address fields); `requiredKeys(overrides: string[]): Set<string>`. Consumed by mapping, validate, and the `/canonical-fields` endpoint.

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from 'vitest';
import { CANONICAL_FIELDS, isValidMappingTarget, requiredKeys } from '../../src/services/importEngine/canonical';

describe('canonical registry', () => {
  it('has 19 unique fields with required flags', () => {
    expect(CANONICAL_FIELDS).toHaveLength(19);
    expect(new Set(CANONICAL_FIELDS.map(f => f.key)).size).toBe(19);
    const required = CANONICAL_FIELDS.filter(f => f.required).map(f => f.key);
    expect(required).toEqual(expect.arrayContaining([
      'external_trip_id','pickup_at','passenger_first_name','passenger_last_name',
      'primary_phone','pickup_address','dropoff_address','level_of_service','trip_type',
    ]));
  });
  it('validates mapping targets with suffixes', () => {
    expect(isValidMappingTarget('pickup_at')).toBe(true);
    expect(isValidMappingTarget('pickup_at.date')).toBe(true);
    expect(isValidMappingTarget('pickup_at.time')).toBe(true);
    expect(isValidMappingTarget('pickup_at.street')).toBe(false);   // not an address
    expect(isValidMappingTarget('pickup_address.street')).toBe(true);
    expect(isValidMappingTarget('notes.date')).toBe(false);
    expect(isValidMappingTarget('bogus')).toBe(false);
  });
  it('requiredKeys honors overrides', () => {
    expect(requiredKeys(['primary_phone']).has('primary_phone')).toBe(false);
    expect(requiredKeys([]).has('primary_phone')).toBe(true);
  });
});
```

- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** — full registry matching spec §6:

```ts
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
```

- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat(import): canonical field registry"`

### Task 13: Date/time parsing (`datetime.ts`)

Add `luxon` (`^3.5.0`) + `@types/luxon` to `apps/api` first. Timezone-correct conversion of vendor local times → UTC ISO.

**Files:**
- Modify: `apps/api/package.json`
- Create: `apps/api/src/services/importEngine/datetime.ts`
- Test: `apps/api/tests/importEngine/datetime.test.ts`

**Interfaces:**
- Produces: `parseDate(value: string, format: string, tz: string): string | null` (→ `yyyy-MM-dd`); `parseDateTime(parts: { dateTime?: string; date?: string; time?: string }, config: Pick<VendorProfileConfig,'dateFormat'|'timeFormat'|'dateTimeFormat'|'timezone'>): string | null` (→ UTC ISO 8601). `dateTimeFormat` value `'iso'` means ISO-8601 autodetect.

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from 'vitest';
import { parseDate, parseDateTime } from '../../src/services/importEngine/datetime';

const CFG = { dateFormat: 'M/d/yyyy', timeFormat: 'H:mm', dateTimeFormat: 'iso', timezone: 'America/New_York' };

describe('parseDate', () => {
  it('parses US dates per profile format', () => {
    expect(parseDate('9/21/2026', CFG.dateFormat, CFG.timezone)).toBe('2026-09-21');
  });
  it('returns null on garbage', () => {
    expect(parseDate('not a date', CFG.dateFormat, CFG.timezone)).toBeNull();
  });
});
describe('parseDateTime', () => {
  it('combines separate date + time columns, converting to UTC (EDT = UTC-4)', () => {
    expect(parseDateTime({ date: '9/21/2026', time: '8:30' }, CFG)).toBe('2026-09-21T12:30:00.000Z');
  });
  it('respects DST (EST = UTC-5 in January)', () => {
    expect(parseDateTime({ date: '1/15/2026', time: '8:30' }, CFG)).toBe('2026-01-15T13:30:00.000Z');
  });
  it('parses single ISO datetime column', () => {
    expect(parseDateTime({ dateTime: '2026-09-21T08:30:00' }, CFG)).toBe('2026-09-21T12:30:00.000Z');
  });
  it('supports 12-hour time format', () => {
    expect(parseDateTime({ date: '9/21/2026', time: '8:30 AM' }, { ...CFG, timeFormat: 'h:mm a' })).toBe('2026-09-21T12:30:00.000Z');
  });
  it('returns null when date is missing/unparseable', () => {
    expect(parseDateTime({ time: '8:30' }, CFG)).toBeNull();
    expect(parseDateTime({ date: 'bogus', time: '8:30' }, CFG)).toBeNull();
  });
});
```

- [ ] **Step 2: Run, verify fail** (also run `npm install --workspace=apps/api` after adding luxon).
- [ ] **Step 3: Implement**

```ts
import { DateTime } from 'luxon';
import type { VendorProfileConfig } from '@midtransport/shared';

type Cfg = Pick<VendorProfileConfig, 'dateFormat' | 'timeFormat' | 'dateTimeFormat' | 'timezone'>;

export function parseDate(value: string, format: string, tz: string): string | null {
  const v = value.trim();
  if (!v) return null;
  const dt = format === 'iso'
    ? DateTime.fromISO(v, { zone: tz })
    : DateTime.fromFormat(v, format, { zone: tz });
  return dt.isValid ? dt.toISODate() : null;
}

export function parseDateTime(
  parts: { dateTime?: string; date?: string; time?: string },
  config: Cfg
): string | null {
  let dt: DateTime;
  if (parts.dateTime?.trim()) {
    const v = parts.dateTime.trim();
    dt = config.dateTimeFormat === 'iso'
      ? DateTime.fromISO(v, { zone: config.timezone })
      : DateTime.fromFormat(v, config.dateTimeFormat, { zone: config.timezone });
  } else {
    if (!parts.date?.trim()) return null;
    const datePart = DateTime.fromFormat(parts.date.trim(), config.dateFormat, { zone: config.timezone });
    if (!datePart.isValid) return null;
    let hour = 0, minute = 0;
    if (parts.time?.trim()) {
      const t = DateTime.fromFormat(parts.time.trim(), config.timeFormat, { zone: config.timezone });
      if (!t.isValid) return null;
      hour = t.hour; minute = t.minute;
    }
    dt = datePart.set({ hour, minute, second: 0, millisecond: 0 });
  }
  return dt.isValid ? dt.toUTC().toISO() : null;
}
```

- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat(import): timezone-aware vendor date/time parsing (luxon)"`

### Task 14: Mapping (`mapping.ts`)

Applies a profile to raw rows: column mapping (with `.date`/`.time`/`.street`/`.city`/`.state`/`.zip` suffixes), per-category normalization, controlled-value translations (exact then case-insensitive), defaults, datetime/address assembly, `pickup_at` fallback to `appointment_at`.

**Files:**
- Create: `apps/api/src/services/importEngine/mapping.ts`
- Test: `apps/api/tests/importEngine/mapping.test.ts`

**Interfaces:**
- Produces: `applyMapping(parsed: ParsedCsv, config: VendorProfileConfig, orgTimezone: string): { trips: CanonicalTrip[]; rowNumbers: number[]; issues: ImportIssue[]; notices: string[] }`. Emits issues: `E_DATE_PARSE`/`E_TIME_PARSE` (unparseable mapped datetime), `W_NAME_SUSPICIOUS`. Notices example: `"Trimmed outer whitespace in 5 fields"`.

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from 'vitest';
import type { VendorProfileConfig } from '@midtransport/shared';
import { applyMapping } from '../../src/services/importEngine/mapping';

const PROFILE: VendorProfileConfig = {
  headerSignature: ['Trip Number', 'Appointment Date', 'Time'],
  columnMap: {
    'Trip Number': 'external_trip_id',
    'Appointment Date': 'appointment_at.date',
    'Time': 'appointment_at.time',
    "Member's First Name": 'passenger_first_name',
    "Member's Last Name": 'passenger_last_name',
    "Member's Phone Number": 'primary_phone',
    'Pickup Address': 'pickup_address.street',
    'Pickup City': 'pickup_address.city',
    'Pickup State': 'pickup_address.state',
    'Pickup Zip Code': 'pickup_address.zip',
    'Level of Service': 'level_of_service',
    'Will Call Flag': 'will_call',
    'Trip Mileage': 'distance_miles',
  },
  encoding: 'auto', delimiter: ',',
  dateFormat: 'M/d/yyyy', timeFormat: 'H:mm', dateTimeFormat: 'iso',
  timezone: 'America/New_York',
  valueTranslations: {
    level_of_service: { 'Ambulatory': 'AMB', 'Wheelchair': 'WCH' },
    will_call: { 'Y': 'true', 'N': 'false' },
  },
  defaults: {}, requiredOverrides: [],
};

const ROW = {
  'Trip Number': ' T-100 ', 'Appointment Date': '9/21/2026', 'Time': '8:30',
  "Member's First Name": ' Mary ', "Member's Last Name": "O'Brien",
  "Member's Phone Number": '(313) 555-1234',
  'Pickup Address': '123 Main St', 'Pickup City': 'Detroit', 'Pickup State': 'MI', 'Pickup Zip Code': '48201',
  'Level of Service': 'Ambulatory', 'Will Call Flag': 'N', 'Trip Mileage': '4.5',
};

describe('applyMapping', () => {
  const parsed = { headers: Object.keys(ROW), rows: [ROW], rowNumbers: [2] };

  it('maps, normalizes, translates, assembles addresses and datetimes', () => {
    const { trips, issues } = applyMapping(parsed, PROFILE, 'America/New_York');
    const t = trips[0];
    expect(t.externalTripId).toBe('T-100');                       // trimmed
    expect(t.appointmentAt).toBe('2026-09-21T12:30:00.000Z');     // EDT → UTC
    expect(t.pickupAt).toBe('2026-09-21T12:30:00.000Z');          // fallback from appointment
    expect(t.passengerFirstName).toBe('Mary');
    expect(t.passengerLastName).toBe("O'Brien");
    expect(t.primaryPhone).toBe('3135551234');
    expect(t.pickupAddress).toEqual({ street: '123 Main St', city: 'Detroit', state: 'MI', zip: '48201' });
    expect(t.levelOfService).toBe('AMB');                         // translated
    expect(t.willCall).toBe(false);
    expect(t.distanceMiles).toBe(4.5);
    expect(issues).toHaveLength(0);
  });

  it('reports transformation notices', () => {
    const { notices } = applyMapping(parsed, PROFILE, 'America/New_York');
    expect(notices.some(n => /whitespace/i.test(n))).toBe(true);
  });

  it('flags unparseable dates with row context', () => {
    const bad = { ...ROW, 'Appointment Date': 'garbage' };
    const { trips, issues } = applyMapping({ ...parsed, rows: [bad] }, PROFILE, 'America/New_York');
    expect(trips[0].appointmentAt).toBeNull();
    expect(issues.some(i => i.code === 'E_DATE_PARSE' && i.row === 2 && i.sourceTripId === 'T-100')).toBe(true);
  });

  it('keeps untranslated controlled values raw for validation to flag', () => {
    const odd = { ...ROW, 'Level of Service': 'Helicopter' };
    const { trips } = applyMapping({ ...parsed, rows: [odd] }, PROFILE, 'America/New_York');
    expect(trips[0].levelOfService).toBe('Helicopter'); // validate.ts emits E_CONTROLLED_VALUE
  });

  it('applies defaults for unmapped fields', () => {
    const withDefaults = { ...PROFILE, defaults: { trip_type: 'One Way' } };
    const { trips } = applyMapping(parsed, withDefaults, 'America/New_York');
    expect(trips[0].tripType).toBe('One Way');
  });
});
```

- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement**

```ts
import type { CanonicalTrip, ImportIssue, StructuredAddress, VendorProfileConfig } from '@midtransport/shared';
import { CANONICAL_FIELDS } from './canonical';
import type { ParsedCsv } from './csvParse';
import { parseDate, parseDateTime } from './datetime';
import { makeIssue } from './errors';
import { normalizeName, normalizeNumeric, normalizePhone, normalizeText, normalizeZip } from './normalize';

export interface MappingResult {
  trips: CanonicalTrip[];
  rowNumbers: number[];
  issues: ImportIssue[];
  notices: string[];
}

function emptyTrip(): CanonicalTrip {
  return {
    externalTripId: null, willCall: false, appointmentAt: null, pickupAt: null,
    passengerFirstName: null, passengerLastName: null, dateOfBirth: null,
    medicalId: null, primaryPhone: null, alternatePhone: null,
    pickupAddress: null, dropoffAddress: null, levelOfService: null,
    additionalPassengers: 0, assistanceNeeds: null, tripType: null,
    status: null, distanceMiles: null, notes: null,
  };
}

const CAMEL: Record<string, keyof CanonicalTrip> = {
  external_trip_id: 'externalTripId', appointment_at: 'appointmentAt', pickup_at: 'pickupAt',
  passenger_first_name: 'passengerFirstName', passenger_last_name: 'passengerLastName',
  date_of_birth: 'dateOfBirth', medical_id: 'medicalId', primary_phone: 'primaryPhone',
  alternate_phone: 'alternatePhone', pickup_address: 'pickupAddress', dropoff_address: 'dropoffAddress',
  level_of_service: 'levelOfService', additional_passengers: 'additionalPassengers',
  assistance_needs: 'assistanceNeeds', trip_type: 'tripType', status: 'status',
  distance_miles: 'distanceMiles', notes: 'notes',
};

function translate(config: VendorProfileConfig, key: string, value: string): string {
  const table = config.valueTranslations[key];
  if (!table) return value;
  if (table[value] !== undefined) return table[value];
  const ci = Object.keys(table).find(k => k.toLowerCase() === value.toLowerCase());
  return ci !== undefined ? table[ci] : value; // unmatched → raw; validate flags it
}

export function applyMapping(parsed: ParsedCsv, config: VendorProfileConfig, orgTimezone: string): MappingResult {
  const issues: ImportIssue[] = [];
  let trimmedCount = 0;
  const tz = config.timezone || orgTimezone;

  const trips = parsed.rows.map((row, i) => {
    const rowNum = parsed.rowNumbers[i];
    const trip = emptyTrip();
    const dtParts: Record<string, { date?: string; time?: string; dateTime?: string }> = {};
    const addrParts: Record<string, Partial<StructuredAddress>> = {};

    for (const [source, target] of Object.entries(config.columnMap)) {
      const raw = row[source];
      if (raw === undefined || raw === '') continue;
      if (raw !== raw.trim()) trimmedCount++;
      const [key, suffix] = target.split('.');

      if (suffix === 'date' || suffix === 'time') {
        (dtParts[key] ??= {})[suffix] = raw;
        continue;
      }
      if (['street', 'city', 'state', 'zip'].includes(suffix ?? '')) {
        (addrParts[key] ??= {})[suffix as keyof StructuredAddress] = normalizeText(raw);
        continue;
      }
      if (!suffix && CANONICAL_FIELDS.find(f => f.key === key)?.type === 'datetime') {
        (dtParts[key] ??= {}).dateTime = raw;
        continue;
      }

      // plain mapped value — normalize per canonical type, then translate
      const field = CANONICAL_FIELDS.find(f => f.key === key);
      const prop = CAMEL[key] as keyof CanonicalTrip | undefined;
      if (!field || !prop) continue;
      const v = normalizeText(raw, { preserveNewlines: key === 'notes' });
      const translated = translate(config, key, v);

      switch (field.type) {
        case 'phone': {
          const r = normalizePhone(translated);
          (trip as unknown as Record<string, unknown>)[prop] = r.value || null;
          break;
        }
        case 'integer': case 'decimal': {
          const r = normalizeNumeric(translated);
          (trip as unknown as Record<string, unknown>)[prop] =
            r.ok ? (field.type === 'integer' ? Math.round(r.value!) : r.value) : (translated as unknown); // invalid numbers kept raw → E_NUMERIC_PARSE in validate
          break;
        }
        case 'boolean':
          (trip as unknown as Record<string, unknown>)[prop] = ['true', 'yes', 'y', '1'].includes(translated.toLowerCase());
          break;
        case 'date': {
          const iso = parseDate(translated, config.dateFormat, tz);
          if (iso === null) issues.push(makeIssue(rowNum, null, key, 'E_DATE_PARSE'));
          (trip as unknown as Record<string, unknown>)[prop] = iso;
          break;
        }
        case 'text': {
          if (key === 'passenger_first_name' || key === 'passenger_last_name') {
            const r = normalizeName(v);
            if (r.suspicious) issues.push(makeIssue(rowNum, null, key, 'W_NAME_SUSPICIOUS'));
            (trip as unknown as Record<string, unknown>)[prop] = r.value || null;
          } else {
            (trip as unknown as Record<string, unknown>)[prop] = (translated || null);
          }
          break;
        }
        default:
          (trip as unknown as Record<string, unknown>)[prop] = (translated || null);
      }
    }

    // defaults for unmapped/unset fields
    for (const [key, defVal] of Object.entries(config.defaults)) {
      const prop = CAMEL[key] as keyof CanonicalTrip | undefined;
      if (!prop) continue;
      const current = trip[prop];
      if (current === null || current === '' ) {
        (trip as unknown as Record<string, unknown>)[prop] = defVal;
      }
    }

    // assemble datetimes
    for (const [key, parts] of Object.entries(dtParts)) {
      const prop = CAMEL[key] as keyof CanonicalTrip;
      const iso = parseDateTime(parts, { ...config, timezone: tz });
      if (iso === null) {
        const badCode = parts.date && !parts.time ? 'E_TIME_PARSE' : 'E_DATE_PARSE';
        issues.push(makeIssue(rowNum, trip.externalTripId, key, badCode));
      }
      (trip as unknown as Record<string, unknown>)[prop] = iso;
    }

    // assemble addresses (empty → null)
    for (const [key, parts] of Object.entries(addrParts)) {
      const prop = CAMEL[key] as keyof CanonicalTrip;
      const addr = { street: parts.street ?? '', city: parts.city ?? '', state: parts.state ?? '', zip: parts.zip ?? '' };
      (trip as unknown as Record<string, unknown>)[prop] =
        (addr.street || addr.city || addr.state || addr.zip) ? addr : null;
    }

    // pickup falls back to appointment when not separately mapped
    if (!trip.pickupAt && trip.appointmentAt) trip.pickupAt = trip.appointmentAt;

    return trip;
  });

  // backfill sourceTripId on issues now that trips are built
  trips.forEach((t, i) => {
    const rowNum = parsed.rowNumbers[i];
    for (const issue of issues) {
      if (issue.row === rowNum && issue.sourceTripId === null) issue.sourceTripId = t.externalTripId;
    }
  });

  const notices: string[] = [];
  if (trimmedCount > 0) notices.push(`Trimmed outer whitespace in ${trimmedCount} field${trimmedCount === 1 ? '' : 's'}`);

  return { trips, rowNumbers: parsed.rowNumbers, issues, notices };
}
```

- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat(import): vendor profile mapping engine"`

### Task 15: Profile auto-detection (`profiles.ts`)

**Files:**
- Create: `apps/api/src/services/importEngine/profiles.ts`
- Test: `apps/api/tests/importEngine/profiles.test.ts`

**Interfaces:**
- Produces: `interface ProfileCandidate { profileId: number; versionId: number; name: string; headerSignature: string[] }`; `interface ProfileDetection extends ProfileCandidate { confidence: number }`; `detectProfile(headers: string[], candidates: ProfileCandidate[]): ProfileDetection | null` (threshold 0.6).

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from 'vitest';
import { detectProfile } from '../../src/services/importEngine/profiles';

const CANDS = [
  { profileId: 1, versionId: 10, name: 'MTM', headerSignature: ['Trip Number', 'Appointment Date', 'Time', 'Level of Service'] },
  { profileId: 2, versionId: 20, name: 'ModivCare', headerSignature: ['rideId', 'tripId', 'appointmentTime', 'patientFirstName'] },
];

describe('detectProfile', () => {
  it('exact match → confidence 1', () => {
    const d = detectProfile(['Trip Number', 'Appointment Date', 'Time', 'Level of Service'], CANDS);
    expect(d).toMatchObject({ profileId: 1, confidence: 1 });
  });
  it('high partial match wins', () => {
    const d = detectProfile(['Trip Number', 'Appointment Date', 'Time', 'Extra Col'], CANDS);
    expect(d!.profileId).toBe(1);
    expect(d!.confidence).toBeGreaterThanOrEqual(0.6);
  });
  it('returns null below threshold', () => {
    expect(detectProfile(['a', 'b', 'c'], CANDS)).toBeNull();
  });
  it('returns null for no candidates', () => {
    expect(detectProfile(['Trip Number'], [])).toBeNull();
  });
});
```

- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement**

```ts
export interface ProfileCandidate {
  profileId: number; versionId: number; name: string; headerSignature: string[];
}
export interface ProfileDetection extends ProfileCandidate { confidence: number }

export const DETECTION_THRESHOLD = 0.6;

export function detectProfile(headers: string[], candidates: ProfileCandidate[]): ProfileDetection | null {
  const headerSet = new Set(headers);
  let best: ProfileDetection | null = null;
  for (const c of candidates) {
    if (c.headerSignature.length === 0) continue;
    const matched = c.headerSignature.filter(h => headerSet.has(h)).length;
    const confidence = matched / c.headerSignature.length;
    if (confidence >= DETECTION_THRESHOLD && (best === null || confidence > best.confidence)) {
      best = { ...c, confidence };
    }
  }
  return best;
}
```

- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat(import): vendor profile header-signature auto-detection"`

### Task 16: Validation (`validate.ts`)

**Files:**
- Create: `apps/api/src/services/importEngine/validate.ts`
- Test: `apps/api/tests/importEngine/validate.test.ts`

**Interfaces:**
- Consumes: `MappingResult` from Task 14, `requiredKeys` from Task 12, `normalizeZip`/`normalizePhone` from Task 11 (for validity re-check on assembled data), `makeIssue` from Task 8.
- Produces: `interface ValidateContext { levelOfServiceCodes: string[]; existingExternalIds: Set<string> }`; `interface ValidatedRow { row: number; trip: CanonicalTrip; issues: ImportIssue[]; status: 'valid' | 'warning' | 'invalid' }`; `validateRows(mapping: MappingResult, required: Set<string>, ctx: ValidateContext): { results: ValidatedRow[]; counts: { total: number; valid: number; warning: number; invalid: number; duplicates: number }; issues: ImportIssue[] }`.

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from 'vitest';
import type { CanonicalTrip } from '@midtransport/shared';
import { validateRows } from '../../src/services/importEngine/validate';

function goodTrip(): CanonicalTrip {
  return {
    externalTripId: 'T-1', willCall: false,
    appointmentAt: '2026-09-21T12:30:00.000Z', pickupAt: '2026-09-21T12:30:00.000Z',
    passengerFirstName: 'Mary', passengerLastName: "O'Brien", dateOfBirth: '1950-01-15',
    medicalId: '0123456789A', primaryPhone: '3135551234', alternatePhone: null,
    pickupAddress: { street: '123 Main St', city: 'Detroit', state: 'MI', zip: '48201' },
    dropoffAddress: { street: '500 Woodward Ave', city: 'Detroit', state: 'MI', zip: '48226' },
    levelOfService: 'AMB', additionalPassengers: 0, assistanceNeeds: null,
    tripType: 'One Way', status: 'scheduled', distanceMiles: 4.5, notes: null,
  };
}

const REQUIRED = new Set(['external_trip_id','pickup_at','passenger_first_name','passenger_last_name','primary_phone','pickup_address','dropoff_address','level_of_service','trip_type']);
const CTX = { levelOfServiceCodes: ['AMB', 'STR', 'WCH'], existingExternalIds: new Set<string>() };
const map = (trips: CanonicalTrip[]) => ({ trips, rowNumbers: trips.map((_, i) => i + 2), issues: [], notices: [] });

describe('validateRows', () => {
  it('passes a good trip', () => {
    const { results, counts } = validateRows(map([goodTrip()]), REQUIRED, CTX);
    expect(results[0].status).toBe('valid');
    expect(counts).toMatchObject({ total: 1, valid: 1, invalid: 0 });
  });
  it('flags missing required fields', () => {
    const t = { ...goodTrip(), primaryPhone: null };
    const { results } = validateRows(map([t]), REQUIRED, CTX);
    expect(results[0].status).toBe('invalid');
    expect(results[0].issues.some(i => i.code === 'E_REQUIRED_FIELD' && i.field === 'primary_phone')).toBe(true);
  });
  it('requires pickup time unless will-call', () => {
    const t = { ...goodTrip(), pickupAt: null };
    expect(validateRows(map([t]), REQUIRED, CTX).results[0].status).toBe('invalid');
    const wc = { ...goodTrip(), pickupAt: null, willCall: true };
    expect(validateRows(map([wc]), REQUIRED, CTX).results[0].status).toBe('valid');
  });
  it('validates phones and zips', () => {
    const t = { ...goodTrip(), primaryPhone: '12', pickupAddress: { street: '1 Main', city: 'Detroit', state: 'MI', zip: '4820A' } };
    const codes = validateRows(map([t]), REQUIRED, CTX).results[0].issues.map(i => i.code);
    expect(codes).toContain('E_PHONE_INVALID');
    expect(codes).toContain('E_ZIP_INVALID');
  });
  it('flags unknown level-of-service codes', () => {
    const t = { ...goodTrip(), levelOfService: 'Helicopter' };
    const { results } = validateRows(map([t]), REQUIRED, CTX);
    expect(results[0].issues.some(i => i.code === 'E_CONTROLLED_VALUE' && i.field === 'level_of_service')).toBe(true);
  });
  it('detects in-file and in-DB duplicates', () => {
    const a = goodTrip();
    const b = { ...goodTrip() };
    const { results } = validateRows(map([a, b]), REQUIRED, CTX);
    expect(results[1].issues.some(i => i.code === 'E_DUPLICATE_IN_FILE')).toBe(true);
    const { results: dbResults } = validateRows(map([goodTrip()]), REQUIRED,
      { ...CTX, existingExternalIds: new Set(['T-1']) });
    expect(dbResults[0].issues.some(i => i.code === 'E_DUPLICATE_IN_DB')).toBe(true);
  });
  it('unknown status → warning and status nulled', () => {
    const t = { ...goodTrip(), status: 'In Orbit' };
    const { results } = validateRows(map([t]), REQUIRED, CTX);
    expect(results[0].status).toBe('warning');
    expect(results[0].trip.status).toBeNull();
  });
  it('flags non-numeric numeric fields left raw by mapping', () => {
    const t = { ...goodTrip(), distanceMiles: 'four' as unknown as number };
    expect(validateRows(map([t]), REQUIRED, CTX).results[0].issues.some(i => i.code === 'E_NUMERIC_PARSE')).toBe(true);
  });
});
```

- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement**

```ts
import type { CanonicalTrip, ImportIssue } from '@midtransport/shared';
import { makeIssue } from './errors';
import type { MappingResult } from './mapping';
import { normalizePhone, normalizeZip } from './normalize';

export interface ValidateContext {
  levelOfServiceCodes: string[];
  existingExternalIds: Set<string>;
}
export interface ValidatedRow {
  row: number;
  trip: CanonicalTrip;
  issues: ImportIssue[];
  status: 'valid' | 'warning' | 'invalid';
}

const RECOGNIZED_STATUSES = new Set(['scheduled', 'cancelled', 'completed', 'no_show']);

const REQUIRED_CHECK: Record<string, (t: CanonicalTrip) => boolean> = {
  external_trip_id: t => !!t.externalTripId,
  pickup_at: t => !!t.pickupAt,
  passenger_first_name: t => !!t.passengerFirstName,
  passenger_last_name: t => !!t.passengerLastName,
  primary_phone: t => !!t.primaryPhone,
  pickup_address: t => !!t.pickupAddress && !!t.pickupAddress.street,
  dropoff_address: t => !!t.dropoffAddress && !!t.dropoffAddress.street,
  level_of_service: t => !!t.levelOfService,
  trip_type: t => !!t.tripType,
};

export function validateRows(
  mapping: MappingResult,
  required: Set<string>,
  ctx: ValidateContext
): {
  results: ValidatedRow[];
  counts: { total: number; valid: number; warning: number; invalid: number; duplicates: number };
  issues: ImportIssue[];
} {
  const seenInFile = new Set<string>();
  const results: ValidatedRow[] = mapping.trips.map((trip, i) => {
    const row = mapping.rowNumbers[i];
    const issues: ImportIssue[] = mapping.issues.filter(is => is.row === row);

    // required fields
    for (const key of required) {
      const check = REQUIRED_CHECK[key];
      if (check && !check(trip)) issues.push(makeIssue(row, trip.externalTripId, key, 'E_REQUIRED_FIELD'));
    }
    // pickup required unless will-call (even if profile overrode required list, this rule stands)
    if (!trip.willCall && !trip.pickupAt && !issues.some(is => is.field === 'pickup_at')) {
      issues.push(makeIssue(row, trip.externalTripId, 'pickup_at', 'E_REQUIRED_FIELD'));
    }
    // phones
    if (trip.primaryPhone && !normalizePhone(trip.primaryPhone).valid) {
      issues.push(makeIssue(row, trip.externalTripId, 'primary_phone', 'E_PHONE_INVALID'));
    }
    if (trip.alternatePhone && !normalizePhone(trip.alternatePhone).valid) {
      issues.push(makeIssue(row, trip.externalTripId, 'alternate_phone', 'E_PHONE_INVALID'));
    }
    // zips
    if (trip.pickupAddress?.zip && !normalizeZip(trip.pickupAddress.zip).valid) {
      issues.push(makeIssue(row, trip.externalTripId, 'pickup_address', 'E_ZIP_INVALID'));
    }
    if (trip.dropoffAddress?.zip && !normalizeZip(trip.dropoffAddress.zip).valid) {
      issues.push(makeIssue(row, trip.externalTripId, 'dropoff_address', 'E_ZIP_INVALID'));
    }
    // numerics left raw by mapping (string where number expected)
    if (typeof trip.distanceMiles === 'string' || typeof trip.additionalPassengers === 'string') {
      const field = typeof trip.distanceMiles === 'string' ? 'distance_miles' : 'additional_passengers';
      issues.push(makeIssue(row, trip.externalTripId, field, 'E_NUMERIC_PARSE'));
      if (typeof trip.distanceMiles === 'string') trip.distanceMiles = null;
      if (typeof trip.additionalPassengers === 'string') trip.additionalPassengers = 0;
    }
    if (typeof trip.additionalPassengers === 'number' && trip.additionalPassengers < 0) {
      issues.push(makeIssue(row, trip.externalTripId, 'additional_passengers', 'E_NUMERIC_PARSE'));
      trip.additionalPassengers = 0;
    }
    // controlled values
    if (trip.levelOfService && !ctx.levelOfServiceCodes.includes(trip.levelOfService)) {
      issues.push(makeIssue(row, trip.externalTripId, 'level_of_service', 'E_CONTROLLED_VALUE'));
    }
    // status: recognized subset, else warning + null (imports as scheduled)
    if (trip.status && !RECOGNIZED_STATUSES.has(trip.status)) {
      issues.push(makeIssue(row, trip.externalTripId, 'status', 'W_STATUS_UNKNOWN'));
      trip.status = null;
    }
    // duplicates
    if (trip.externalTripId) {
      if (seenInFile.has(trip.externalTripId)) {
        issues.push(makeIssue(row, trip.externalTripId, 'external_trip_id', 'E_DUPLICATE_IN_FILE'));
      }
      seenInFile.add(trip.externalTripId);
      if (ctx.existingExternalIds.has(trip.externalTripId)) {
        issues.push(makeIssue(row, trip.externalTripId, 'external_trip_id', 'E_DUPLICATE_IN_DB'));
      }
    }

    const hasError = issues.some(is => is.severity === 'error');
    const status: ValidatedRow['status'] = hasError ? 'invalid' : issues.length > 0 ? 'warning' : 'valid';
    return { row, trip, issues, status };
  });

  const issues = results.flatMap(r => r.issues);
  return {
    results,
    issues,
    counts: {
      total: results.length,
      valid: results.filter(r => r.status === 'valid').length,
      warning: results.filter(r => r.status === 'warning').length,
      invalid: results.filter(r => r.status === 'invalid').length,
      duplicates: results.filter(r => r.issues.some(i => i.code === 'E_DUPLICATE_IN_FILE' || i.code === 'E_DUPLICATE_IN_DB')).length,
    },
  };
}
```

- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat(import): canonical trip validation with stable error codes"`

### Task 17: Synthetic fixtures + end-to-end engine test

**Files:**
- Create: `apps/api/tests/fixtures/vendor-a.csv`, `apps/api/tests/fixtures/vendor-b.csv`
- Create: `apps/api/tests/fixtures/profiles.ts` (profile configs for both vendors)
- Create: `apps/api/tests/importEngine/pipeline.test.ts`

**Interfaces:**
- Produces: `VENDOR_A_PROFILE: VendorProfileConfig`, `VENDOR_B_PROFILE: VendorProfileConfig` exported from `tests/fixtures/profiles.ts` — reused by route tests in Phase 3.

- [ ] **Step 1: Write fixtures (synthetic data only — never copy real rows)**

`vendor-a.csv` — real 41-column MTM-style header, 3 fake rows (clean row; row with outer whitespace + untranslated LOS; row missing phone + duplicate trip number):

```csv
Additional Passengers With Appointments,Appointment Date,Appointment Day of Week,Attendant Flag,Car Seats Required,Delivery Address,Delivery City,Delivery Name,Delivery Phone Number,Delivery State,Delivery Zip Code,Driver Name,Driver Notes,Level of Service,Manifest Number,Medicaid Number,Member's Age,Member's Alt Phone,Member's First Name,Member's Last Name,Member's Phone Number,Number of Additional Passengers,Passenger Type,Pickup Address,Pickup City,Pickup State,Pickup Zip Code,Pregnant Flag,Special Needs,Time,Trip Cost,Trip Mileage,Trip Number,Trip Reason,Trip Status,Trip Type,Vehicle,Vehicle Type,Will Call Flag,Date of Birth,Last Edit Date
,9/21/2026,Monday,N,N,500 Woodward Ave,Detroit,Clinic Main,(313) 555-9000,MI,48226,,Dialysis - bring chart,Wheelchair,,0011223344A,76,, FakeFirst , FakeLast ,(313) 555-0001,0,,123 Main St,Detroit,MI,48201,N,Walker assistance,8:30,25.00,4.5,FAKE-A-001,Dialysis,Scheduled,One Way,,Wheelchair Van,N,1/15/1950,
,9/21/2026,Monday,N,N,200 Park St,Detroit,,,MI,48207,,,Helicopter,,,70,,Jane,Doe,(313) 555-0002,0,,456 Oak Ave,Detroit,MI,48202,N,,10:00,,6.2,FAKE-A-002,Checkup,Scheduled,Round Trip,,Sedan,N,3/3/1956,
,9/21/2026,Monday,N,N,200 Park St,Detroit,,,MI,48207,,,Ambulatory,,,65,,No,Phone,,0,,789 Pine Rd,Detroit,MI,48203,N,,11:30,,2.1,FAKE-A-001,Checkup,Scheduled,One Way,,Sedan,N,7/7/1961,
```

`vendor-b.csv` — camelCase layout, 2 fake rows:

```csv
rideId,tripId,appointmentTime,patientFirstName,patientLastName,fromStreet,fromcity,fromstate,fromzip,patientPhoneNumber,tostreet,tocity,tostate,tozip,requestedVehicleType,additionalPassengers,additionalPassengersCount,arrivedDate,distance,pickupTime,status,confirmationStatus,additionalNotes,patientMedicalId,alternativePhoneNumber,assistanceNeeds,dateOfBirth,treatment,tripType
R-9001,T-B-001,2026-09-21T09:00:00,Alice,Sampleton,10 Elm St,Dearborn,MI,48124,3135551001,600 Gratiot Ave,Detroit,MI,48226,WCH,0,0,,3.2,2026-09-21T08:15:00,confirmed,confirmed,,0099887766B,,None,2/20/1948,,OneWay
R-9002,T-B-002,2026-09-21T13:00:00,Bob,Testman,20 Elm St,Dearborn,MI,48124,3135551002,600 Gratiot Ave,Detroit,MI,48226,AMB,1,1,,1.1,,confirmed,pending,Side door,1122334455C,,Needs help with steps,6/10/1960,,RoundTrip
```

`profiles.ts`:

```ts
import type { VendorProfileConfig } from '@midtransport/shared';

export const VENDOR_A_PROFILE: VendorProfileConfig = {
  headerSignature: [/* all 41 headers, copy from fixture line 1 */],
  columnMap: {
    'Trip Number': 'external_trip_id',
    'Appointment Date': 'appointment_at.date',
    'Time': 'appointment_at.time',
    "Member's First Name": 'passenger_first_name',
    "Member's Last Name": 'passenger_last_name',
    'Date of Birth': 'date_of_birth',
    'Medicaid Number': 'medical_id',
    "Member's Phone Number": 'primary_phone',
    "Member's Alt Phone": 'alternate_phone',
    'Pickup Address': 'pickup_address.street',
    'Pickup City': 'pickup_address.city',
    'Pickup State': 'pickup_address.state',
    'Pickup Zip Code': 'pickup_address.zip',
    'Delivery Address': 'dropoff_address.street',
    'Delivery City': 'dropoff_address.city',
    'Delivery State': 'dropoff_address.state',
    'Delivery Zip Code': 'dropoff_address.zip',
    'Level of Service': 'level_of_service',
    'Number of Additional Passengers': 'additional_passengers',
    'Special Needs': 'assistance_needs',
    'Trip Type': 'trip_type',
    'Trip Status': 'status',
    'Trip Mileage': 'distance_miles',
    'Driver Notes': 'notes',
    'Will Call Flag': 'will_call',
  },
  encoding: 'auto', delimiter: ',',
  dateFormat: 'M/d/yyyy', timeFormat: 'H:mm', dateTimeFormat: 'iso',
  timezone: 'America/New_York',
  valueTranslations: {
    level_of_service: { Ambulatory: 'AMB', Wheelchair: 'WCH', Stretcher: 'STR' },
    will_call: { Y: 'true', N: 'false' },
    trip_type: { 'One Way': 'one_way', 'Round Trip': 'round_trip' },
    status: { Scheduled: 'scheduled', Cancelled: 'cancelled', Completed: 'completed' },
  },
  defaults: {}, requiredOverrides: [],
};

export const VENDOR_B_PROFILE: VendorProfileConfig = {
  headerSignature: [/* all 29 headers */],
  columnMap: {
    tripId: 'external_trip_id',
    appointmentTime: 'appointment_at',
    pickupTime: 'pickup_at',
    patientFirstName: 'passenger_first_name',
    patientLastName: 'passenger_last_name',
    dateOfBirth: 'date_of_birth',
    patientMedicalId: 'medical_id',
    patientPhoneNumber: 'primary_phone',
    alternativePhoneNumber: 'alternate_phone',
    fromStreet: 'pickup_address.street',
    fromcity: 'pickup_address.city',
    fromstate: 'pickup_address.state',
    fromzip: 'pickup_address.zip',
    tostreet: 'dropoff_address.street',
    tocity: 'dropoff_address.city',
    tostate: 'dropoff_address.state',
    tozip: 'dropoff_address.zip',
    requestedVehicleType: 'level_of_service',
    additionalPassengersCount: 'additional_passengers',
    assistanceNeeds: 'assistance_needs',
    tripType: 'trip_type',
    status: 'status',
    distance: 'distance_miles',
    additionalNotes: 'notes',
  },
  encoding: 'auto', delimiter: ',',
  dateFormat: 'yyyy-MM-dd', timeFormat: 'H:mm', dateTimeFormat: 'iso',
  timezone: 'America/New_York',
  valueTranslations: {
    level_of_service: { WCH: 'WCH', AMB: 'AMB', STR: 'STR' },
    trip_type: { OneWay: 'one_way', RoundTrip: 'round_trip' },
    status: { confirmed: 'scheduled', cancelled: 'cancelled', completed: 'completed' },
  },
  defaults: {}, requiredOverrides: [],
};
```

- [ ] **Step 2: Failing pipeline test**

```ts
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { decodeCsv } from '../../src/services/importEngine/encoding';
import { parseCsv } from '../../src/services/importEngine/csvParse';
import { applyMapping } from '../../src/services/importEngine/mapping';
import { validateRows } from '../../src/services/importEngine/validate';
import { requiredKeys, CANONICAL_FIELDS } from '../../src/services/importEngine/canonical';
import { detectProfile } from '../../src/services/importEngine/profiles';
import { VENDOR_A_PROFILE, VENDOR_B_PROFILE } from '../fixtures/profiles';

const CTX = { levelOfServiceCodes: ['AMB', 'STR', 'WCH'], existingExternalIds: new Set<string>() };
const REQ = requiredKeys([]);

function run(file: string, profile: typeof VENDOR_A_PROFILE) {
  const buf = fs.readFileSync(path.join(__dirname, '../fixtures', file));
  const { text } = decodeCsv(buf);
  const parsed = parseCsv(text);
  const mapped = applyMapping(parsed, profile, 'America/New_York');
  return { parsed, mapped, validated: validateRows(mapped, REQ, CTX) };
}

describe('vendor A pipeline', () => {
  const { mapped, validated } = run('vendor-a.csv', VENDOR_A_PROFILE);
  it('parses 3 rows', () => expect(validated.counts.total).toBe(3));
  it('row 1 valid with trimmed whitespace and correct UTC time', () => {
    const r1 = validated.results[0];
    expect(r1.status).toBe('valid');
    expect(r1.trip.passengerFirstName).toBe('FakeFirst');
    expect(r1.trip.pickupAt).toBe('2026-09-21T12:30:00.000Z');
    expect(r1.trip.medicalId).toBe('0011223344A'); // leading zeroes preserved
    expect(mapped.notices.some(n => /whitespace/i.test(n))).toBe(true);
  });
  it('row 2 invalid: untranslated LOS', () => {
    expect(validated.results[1].issues.some(i => i.code === 'E_CONTROLLED_VALUE')).toBe(true);
  });
  it('row 3 invalid: missing phone + duplicate trip ID in file', () => {
    const codes = validated.results[2].issues.map(i => i.code);
    expect(codes).toContain('E_REQUIRED_FIELD');
    expect(codes).toContain('E_DUPLICATE_IN_FILE');
  });
});

describe('vendor B pipeline', () => {
  const { validated } = run('vendor-b.csv', VENDOR_B_PROFILE);
  it('both rows resolve, ISO datetimes converted to UTC', () => {
    expect(validated.counts.total).toBe(2);
    expect(validated.results[0].trip.pickupAt).toBe('2026-09-21T12:15:00.000Z');
    expect(validated.results[0].trip.levelOfService).toBe('WCH');
  });
});

describe('profile auto-detection', () => {
  it('detects each vendor by headers', () => {
    const candidates = [
      { profileId: 1, versionId: 11, name: 'VendorA', headerSignature: VENDOR_A_PROFILE.headerSignature },
      { profileId: 2, versionId: 21, name: 'VendorB', headerSignature: VENDOR_B_PROFILE.headerSignature },
    ];
    const a = run('vendor-a.csv', VENDOR_A_PROFILE);
    expect(detectProfile(a.parsed.headers, candidates)!.profileId).toBe(1);
    const b = run('vendor-b.csv', VENDOR_B_PROFILE);
    expect(detectProfile(b.parsed.headers, candidates)!.profileId).toBe(2);
  });
});

describe('engine purity', () => {
  it('engine files import no express/pg/redis modules', () => {
    const dir = path.join(__dirname, '../../src/services/importEngine');
    for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.ts'))) {
      const src = fs.readFileSync(path.join(dir, f), 'utf8');
      expect(src, f).not.toMatch(/from '(express|pg|ioredis|\.\.\/\.\.\/db)/);
    }
  });
  it('canonical registry has 19 fields', () => expect(CANONICAL_FIELDS).toHaveLength(19));
});
```

- [ ] **Step 3: Run** — `npm test --workspace=apps/api`. Fix any pipeline bugs the test exposes (that's the point of TDD); do not weaken assertions to pass.

- [ ] **Step 4: Commit**

```bash
git add apps/api/tests
git commit -m "test(import): synthetic vendor fixtures + end-to-end engine pipeline tests"
```

---

## Phase 3 — API layer

### Task 18: Extract geocode helper + address-search proxy

The Nominatim helper currently lives inside `routes/trips.ts`. Extract for reuse (import execution geocodes; the new search endpoint powers manual-entry autocomplete).

**Files:**
- Create: `apps/api/src/lib/geocode.ts`
- Modify: `apps/api/src/routes/trips.ts` (use the shared helper)
- Create: `apps/api/src/routes/geocode.ts`
- Modify: `apps/api/src/index.ts` (mount route)

**Interfaces:**
- Produces: `geocodeAddress(address: string): Promise<{ lat: number; lng: number } | null>` and `searchAddresses(q: string, limit?: number): Promise<Array<{ display: string; lat: number; lng: number; street: string; city: string; state: string; zip: string }>>` from `lib/geocode.ts`.
- Produces: `GET /api/geocode/search?q=...` → `{ results: [...] }` (any authenticated role).

- [ ] **Step 1: Create `lib/geocode.ts`** — move `geocodeAddress` verbatim from `trips.ts`, add:

```ts
export interface AddressSuggestion {
  display: string; lat: number; lng: number;
  street: string; city: string; state: string; zip: string;
}

export async function searchAddresses(q: string, limit = 5): Promise<AddressSuggestion[]> {
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&addressdetails=1&countrycodes=us&limit=${limit}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'MidTransport/1.0 (nemt-dispatch)' },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return [];
    const results = await res.json() as Array<{
      display_name: string; lat: string; lon: string;
      address?: { house_number?: string; road?: string; city?: string; town?: string; village?: string; state?: string; postcode?: string };
    }>;
    return results.map(r => ({
      display: r.display_name,
      lat: parseFloat(r.lat),
      lng: parseFloat(r.lon),
      street: [r.address?.house_number, r.address?.road].filter(Boolean).join(' '),
      city: r.address?.city ?? r.address?.town ?? r.address?.village ?? '',
      state: r.address?.state ?? '',
      zip: r.address?.postcode ?? '',
    }));
  } catch {
    return [];
  }
}
```

- [ ] **Step 2: Update `trips.ts`** — delete the local `geocodeAddress` function; add `import { geocodeAddress } from '../lib/geocode';`.

- [ ] **Step 3: Create `routes/geocode.ts`**

```ts
import { Router, Request, Response, NextFunction } from 'express';
import { query as qv, validationResult } from 'express-validator';
import { authenticate } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { searchAddresses } from '../lib/geocode';

const router = Router();
router.use(authenticate);

router.get('/search',
  qv('q').trim().isLength({ min: 3, max: 200 }),
  async (req: Request, res: Response, next: NextFunction) => {
    if (!validationResult(req).isEmpty()) return next(new AppError('Query must be 3-200 characters', 400));
    try {
      res.json({ results: await searchAddresses(req.query.q as string) });
    } catch (err) { next(err); }
  }
);

export default router;
```

- [ ] **Step 4: Mount in `index.ts`** — `import geocodeRoutes from './routes/geocode';` + `app.use('/api/geocode', geocodeRoutes);` after the reports mount.

- [ ] **Step 5: Verify** — `npm run build --workspace=apps/api` clean; `npm test --workspace=apps/api` still green.
- [ ] **Step 6: Commit** — `git commit -m "refactor(api): extract geocode helper; add address autocomplete endpoint"`

### Task 19: Testability refactor — `app.ts` + io holder

Routes import `{ io } from '../index'`, and `index.ts` listens on import — untestable with supertest. Extract the app; break the circular import via an io holder.

**Files:**
- Create: `apps/api/src/lib/io.ts`
- Create: `apps/api/src/app.ts`
- Modify: `apps/api/src/index.ts` (becomes bootstrap only)
- Modify: `apps/api/src/routes/trips.ts`, `apps/api/src/routes/otp.ts` (import io from `../lib/io`)

**Interfaces:**
- Produces: `import { app } from '../src/app'` usable in tests without opening a port or socket server. `getIo(): Server` for routes (throws if called before init).

- [ ] **Step 1: Create `src/lib/io.ts`**

```ts
import type { Server } from 'socket.io';

let ioInstance: Server | null = null;

export function setIo(io: Server): void { ioInstance = io; }

export function getIo(): Server {
  if (!ioInstance) throw new Error('Socket.io not initialized');
  return ioInstance;
}
```

- [ ] **Step 2: Create `src/app.ts`** — move from `index.ts`: all express middleware, rate limiters, audit middleware, route mounts, health check, and `app.use(errorHandler)`. Do NOT create the http server, socket server, or call `listen`/`registerLocationHandlers` here. End with `export { app };`. Route imports stay the same.

- [ ] **Step 3: Rewrite `src/index.ts` as bootstrap**

```ts
import 'dotenv/config';
import { createServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import { app } from './app';
import { setIo } from './lib/io';
import { registerLocationHandlers } from './sockets/locationHandler';
import { logger } from './lib/logger';

const httpServer = createServer(app);
const corsOrigin = process.env.APP_BASE_URL || 'http://localhost:3000';

export const io = new SocketServer(httpServer, {
  cors: { origin: corsOrigin, methods: ['GET', 'POST'], credentials: true },
  transports: ['websocket', 'polling'],
});
setIo(io);
registerLocationHandlers(io);

const PORT = parseInt(process.env.PORT || '3001', 10);
httpServer.listen(PORT, () => {
  logger.info(`MidTransport API running on port ${PORT}`);
  logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

export { httpServer };
```

- [ ] **Step 4: Update routes importing io** — in `trips.ts` and `otp.ts` replace `import { io } from '../index';` with `import { getIo } from '../lib/io';` and each `io.to(...)` call with `getIo().to(...)`. (`tracking.ts` doesn't import io; verify with grep — fix the same way if it does.)

- [ ] **Step 5: Verify** — `npm run build --workspace=apps/api` clean; `npm run dev` boots; `curl http://localhost:3001/api/health` → ok (or via Docker).
- [ ] **Step 6: Commit** — `git commit -m "refactor(api): extract express app for testability; decouple socket.io via holder"`

### Task 20: Trip import upload endpoint

**Files:**
- Create: `apps/api/src/routes/importTrips.ts`
- Modify: `apps/api/src/index.ts` → `src/app.ts` (mount `/api/import/trips`)
- Test: `apps/api/tests/routes/importTrips.upload.test.ts` (added in Task 25; manual curl verifies here)

**Interfaces:**
- Produces: `POST /api/import/trips/upload` (multipart `file`) → `{ uploadId, filename, sha256, encoding, delimiter, headers, rowCount, detectedProfile: { profileId, versionId, name, confidence } | null }`. Errors: 400 non-CSV/empty/dup headers/over limit (from `CsvStructureError`); 401/403 via existing middleware.

- [ ] **Step 1: Implement `routes/importTrips.ts`** (upload portion; analyze/execute/jobs added by later tasks in the same file)

```ts
import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import crypto from 'crypto';
import { body, validationResult } from 'express-validator';
import { authenticate, requireRole } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { query, queryOne } from '../db/pool';
import { decodeCsv } from '../services/importEngine/encoding';
import { parseCsv, CsvStructureError } from '../services/importEngine/csvParse';
import { detectProfile, ProfileCandidate } from '../services/importEngine/profiles';

const router = Router();
router.use(authenticate, requireRole('admin', 'dispatcher'));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.originalname.toLowerCase().endsWith('.csv')) {
      return cb(new AppError('Only .csv files are accepted', 400) as unknown as null, false);
    }
    cb(null, true);
  },
});

// Lazy cleanup of expired uploads (no cron needed)
async function purgeExpiredUploads(): Promise<void> {
  await query('DELETE FROM import_uploads WHERE expires_at < NOW()');
}

// ─── POST /api/import/trips/upload ───────────────────────────────────────────
router.post('/upload', upload.single('file'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.file) return next(new AppError('CSV file is required', 400));

    const { text, encoding } = decodeCsv(req.file.buffer);
    let parsed;
    try {
      parsed = parseCsv(text);
    } catch (err) {
      if (err instanceof CsvStructureError) return next(new AppError(err.message, 400));
      throw err;
    }

    const sha256 = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
    await purgeExpiredUploads();
    const staged = await queryOne<{ id: number }>(
      `INSERT INTO import_uploads (org_id, uploaded_by, filename, sha256, content, detected_encoding, row_count, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW() + INTERVAL '2 hours') RETURNING id`,
      [req.user!.orgId, req.user!.userId, req.file.originalname, sha256, req.file.buffer, encoding, parsed.rows.length]
    );

    // Auto-detect vendor profile by header signature
    const candidates = await query<ProfileCandidate & { config: unknown }>(
      `SELECT p.id AS "profileId", v.id AS "versionId", p.name,
              v.config->'headerSignature' AS "headerSignature"
       FROM vendor_profiles p
       JOIN vendor_profile_versions v ON v.profile_id = p.id
       WHERE p.org_id = $1 AND p.is_active = true
         AND v.version = (SELECT MAX(version) FROM vendor_profile_versions WHERE profile_id = p.id)`,
      [req.user!.orgId]
    );
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
  } catch (err) { next(err); }
});

export default router;
```

Multer's `fileFilter` signature: call `cb(null, false)` for rejection and handle the missing file afterward, OR pass the error: `cb(new AppError(...) as any)`. Use the simpler reliable form:

```ts
fileFilter: (_req, file, cb) => {
  if (!file.originalname.toLowerCase().endsWith('.csv')) return cb(null, false);
  cb(null, true);
},
```
then the `if (!req.file)` check returns the 400 with message 'CSV file is required (.csv only)'.

- [ ] **Step 2: Mount** in `src/app.ts`: `import importTripRoutes from './routes/importTrips';` + `app.use('/api/import/trips', importTripRoutes);` before `app.use(errorHandler)`.

- [ ] **Step 3: Verify** — build clean; manual curl against dev API:

```bash
TOKEN=$(curl -s localhost:3001/api/auth/login -H 'Content-Type: application/json' -d '{"email":"admin@example.com","password":"Admin1234!"}' | jq -r .accessToken)
curl -s localhost:3001/api/import/trips/upload -H "Authorization: Bearer $TOKEN" -F "file=@apps/api/tests/fixtures/vendor-a.csv"
```

Expected: 201 with `headers`, `rowCount: 3`, `detectedProfile: null` (no profiles saved yet).

- [ ] **Step 4: Commit** — `git commit -m "feat(api): trip import upload endpoint with encoding detection and profile auto-detect"`

### Task 21: Analyze endpoint (preview + validate)

One idempotent endpoint serving wizard steps 3 (Preview) and 4 (Validate).

**Files:**
- Modify: `apps/api/src/routes/importTrips.ts`
- Create: `apps/api/src/services/importRunner.ts` (shared pipeline: load upload → decode → parse → map → validate + DB context)

**Interfaces:**
- Produces: `runAnalysis(orgId: number, uploadId: number, profileVersionId: number, mappingOverrides?: Record<string,string>): Promise<AnalysisResult>` in `importRunner.ts`.
- `AnalysisResult = { counts: { total, valid, warning, invalid, duplicates, newRiders, matchedRiders }; sample: MaskedSample[]; notices: string[]; issues: ImportIssue[]; headers: string[]; recognized: string[]; unmapped: string[] }`
- `MaskedSample = { row: number; status: 'valid'|'warning'|'invalid'; externalTripId: string|null; passengerName: string; primaryPhone: string; medicalId: string|null; pickupAt: string|null; pickupAddress: string; dropoffAddress: string }` — phones masked to last 4 (`••••••1234`), medical ID to last 2.
- Endpoint: `POST /api/import/trips/analyze` body `{ uploadId, profileVersionId, mappingOverrides? }` → `AnalysisResult`.

- [ ] **Step 1: Create `services/importRunner.ts`**

```ts
import type { CanonicalTrip, ImportIssue, VendorProfileConfig } from '@midtransport/shared';
import { query, queryOne } from '../db/pool';
import { AppError } from '../middleware/errorHandler';
import { decodeCsv } from './importEngine/encoding';
import { parseCsv } from './importEngine/csvParse';
import { applyMapping } from './importEngine/mapping';
import { validateRows, ValidateContext } from './importEngine/validate';
import { requiredKeys } from './importEngine/canonical';

export interface MaskedSample {
  row: number; status: 'valid' | 'warning' | 'invalid';
  externalTripId: string | null; passengerName: string;
  primaryPhone: string; medicalId: string | null;
  pickupAt: string | null; pickupAddress: string; dropoffAddress: string;
}

export interface AnalysisResult {
  counts: { total: number; valid: number; warning: number; invalid: number; duplicates: number; newRiders: number; matchedRiders: number };
  sample: MaskedSample[];
  notices: string[];
  issues: ImportIssue[];          // capped at 500
  headers: string[];
  recognized: string[];
  unmapped: string[];
  config: VendorProfileConfig;    // effective config (for execute reuse)
  validated: ReturnType<typeof validateRows>['results']; // internal — execute reuses
}

export async function loadProfileConfig(orgId: number, versionId: number): Promise<VendorProfileConfig> {
  const row = await queryOne<{ config: VendorProfileConfig }>(
    `SELECT v.config FROM vendor_profile_versions v
     JOIN vendor_profiles p ON p.id = v.profile_id
     WHERE v.id = $1 AND p.org_id = $2 AND p.is_active = true`,
    [versionId, orgId]
  );
  if (!row) throw new AppError('Vendor profile version not found', 404);
  return row.config;
}

export async function runAnalysis(
  orgId: number, uploadId: number, profileVersionId: number,
  mappingOverrides?: Record<string, string>
): Promise<AnalysisResult> {
  const uploadRow = await queryOne<{ content: Buffer; filename: string }>(
    'SELECT content, filename FROM import_uploads WHERE id = $1 AND org_id = $2 AND expires_at > NOW()',
    [uploadId, orgId]
  );
  if (!uploadRow) throw new AppError('Upload not found or expired — re-upload the file', 404);

  const config = await loadProfileConfig(orgId, profileVersionId);
  if (mappingOverrides) config.columnMap = { ...config.columnMap, ...mappingOverrides };

  const org = await queryOne<{ timezone: string }>('SELECT timezone FROM organizations WHERE id = $1', [orgId]);
  const { text } = decodeCsv(uploadRow.content);
  const parsed = parseCsv(text);
  const mapped = applyMapping(parsed, config, org?.timezone || 'America/New_York');

  // DB context: LOS codes + existing external IDs for this vendor
  const losRows = await query<{ code: string }>(
    'SELECT code FROM levels_of_service WHERE org_id = $1 AND is_active = true', [orgId]);
  const extIds = mapped.trips.map(t => t.externalTripId).filter((x): x is string => !!x);
  const dupRows = extIds.length > 0
    ? await query<{ external_trip_id: string }>(
        `SELECT external_trip_id FROM trips
         WHERE org_id = $1 AND external_trip_id = ANY($2)`,
        [orgId, extIds])
    : [];
  const ctx: ValidateContext = {
    levelOfServiceCodes: losRows.map(r => r.code),
    existingExternalIds: new Set(dupRows.map(r => r.external_trip_id)),
  };

  const validated = validateRows(mapped, requiredKeys(config.requiredOverrides), ctx);

  // Rider match estimate (read-only): match on lower(first)+lower(last)+dob, else phone
  const riders = await query<{ id: number; first_name: string | null; last_name: string | null; name: string; date_of_birth: string | null; phone: string }>(
    'SELECT id, first_name, last_name, name, date_of_birth, phone FROM riders WHERE org_id = $1 AND is_active = true', [orgId]);
  let matchedRiders = 0, newRiders = 0;
  for (const r of validated.results) {
    if (r.status === 'invalid') continue;
    const m = matchRider(riders, r.trip);
    if (m) matchedRiders++; else newRiders++;
  }

  const maskPhone = (p: string | null) => p ? `••••••${p.slice(-4)}` : '';
  const maskId = (m: string | null) => m ? `••••${m.slice(-2)}` : null;
  const fmtAddr = (a: { street: string; city: string; state: string; zip: string } | null) =>
    a ? [a.street, a.city, a.state, a.zip].filter(Boolean).join(', ') : '';

  const sample: MaskedSample[] = validated.results.slice(0, 10).map(r => ({
    row: r.row, status: r.status,
    externalTripId: r.trip.externalTripId,
    passengerName: [r.trip.passengerFirstName, r.trip.passengerLastName].filter(Boolean).join(' '),
    primaryPhone: maskPhone(r.trip.primaryPhone),
    medicalId: maskId(r.trip.medicalId),
    pickupAt: r.trip.pickupAt,
    pickupAddress: fmtAddr(r.trip.pickupAddress),
    dropoffAddress: fmtAddr(r.trip.dropoffAddress),
  }));

  const mappedSources = new Set(Object.keys(config.columnMap));
  return {
    counts: { ...validated.counts, matchedRiders, newRiders },
    sample,
    notices: mapped.notices,
    issues: validated.issues.slice(0, 500),
    headers: parsed.headers,
    recognized: parsed.headers.filter(h => mappedSources.has(h)),
    unmapped: parsed.headers.filter(h => !mappedSources.has(h)),
    config,
    validated: validated.results,
  };
}

export interface RiderRow {
  id: number; first_name: string | null; last_name: string | null;
  name: string; date_of_birth: string | null; phone: string;
}

export function matchRider(riders: RiderRow[], trip: CanonicalTrip): RiderRow | null {
  const first = (trip.passengerFirstName || '').toLowerCase();
  const last = (trip.passengerLastName || '').toLowerCase();
  const dob = trip.dateOfBirth;
  const phone = trip.primaryPhone?.replace(/\D/g, '');
  return riders.find(r => {
    const rFirst = (r.first_name || r.name.split(' ')[0] || '').toLowerCase();
    const rLast = (r.last_name || r.name.split(' ').slice(1).join(' ') || '').toLowerCase();
    if (first && last && rFirst === first && rLast === last) {
      if (dob && r.date_of_birth) return String(r.date_of_birth).slice(0, 10) === dob;
      return true;
    }
    return !!phone && r.phone.replace(/\D/g, '') === phone;
  }) ?? null;
}
```

- [ ] **Step 2: Add analyze route to `importTrips.ts`**

```ts
router.post('/analyze',
  body('uploadId').isInt(), body('profileVersionId').isInt(),
  body('mappingOverrides').optional().isObject(),
  async (req: Request, res: Response, next: NextFunction) => {
    if (!validationResult(req).isEmpty()) return next(new AppError('uploadId and profileVersionId are required', 400));
    try {
      const { uploadId, profileVersionId, mappingOverrides } = req.body;
      const result = await runAnalysis(req.user!.orgId, uploadId, profileVersionId, mappingOverrides);
      const { validated, config, ...publicResult } = result; // don't leak full trips in preview
      res.json(publicResult);
    } catch (err) { next(err); }
  }
);
```

- [ ] **Step 3: Verify** — build clean. Manual: create a profile row in psql (or wait for Task 24's profile API), then POST analyze with the vendor-a fixture → expect `counts.total = 3`, `invalid = 2`, sample masked.
- [ ] **Step 4: Commit** — `git commit -m "feat(api): trip import analyze endpoint (preview + validation)"`

### Task 22: Execute endpoint

**Files:**
- Modify: `apps/api/src/routes/importTrips.ts`
- Modify: `apps/api/src/services/importRunner.ts` (add `executeImport`)

**Interfaces:**
- Produces: `POST /api/import/trips/execute` body `{ uploadId, profileVersionId, mappingOverrides?, mode: ImportMode, duplicatePolicy: DuplicatePolicy }` → `{ jobId }` (202). Modes: `test` (no writes), `valid_rows_only`, `all_or_nothing` (admin). Policies: `skip`, `reject`, `update` (admin).

- [ ] **Step 1: Add `executeImport` to `importRunner.ts`**

```ts
import type { DuplicatePolicy, ImportMode } from '@midtransport/shared';
import { db } from '../db/pool';
import { geocodeAddress } from '../lib/geocode';
import { logger } from '../lib/logger';

export interface ExecuteOptions {
  orgId: number; userId: number; userRole: string; uploadId: number; profileVersionId: number;
  profileId: number; mappingOverrides?: Record<string, string>;
  mode: ImportMode; duplicatePolicy: DuplicatePolicy;
  filename: string; fileHash: string;
}

export async function executeImport(opts: ExecuteOptions): Promise<number> {
  const analysis = await runAnalysis(opts.orgId, opts.uploadId, opts.profileVersionId, opts.mappingOverrides);
  const { validated } = analysis;

  const job = await queryOne<{ id: number }>(
    `INSERT INTO import_jobs (org_id, imported_by, import_type, filename, status, mode, file_hash, vendor_profile_version_id, duplicate_policy, total_rows)
     VALUES ($1, $2, 'trips', $3, 'processing', $4, $5, $6, $7, $8) RETURNING id`,
    [opts.orgId, opts.userId, opts.filename, opts.mode, opts.fileHash, opts.profileVersionId, opts.duplicatePolicy, analysis.counts.total]
  );
  const jobId = job!.id;

  if (opts.mode === 'test') {
    await finalizeJob(jobId, analysis, []);
    return jobId;
  }

  if (opts.mode === 'all_or_nothing' && analysis.counts.invalid > 0) {
    await query(
      `UPDATE import_jobs SET status = 'failed', error_rows = $1, errors = $2, completed_at = NOW() WHERE id = $3`,
      [analysis.counts.invalid, JSON.stringify(analysis.issues), jobId]
    );
    return jobId; // caller surfaces failed job with issues
  }

  const client = await db.connect();
  const tripIds: number[] = [];
  let created = 0, updated = 0, skipped = 0, duplicates = 0, failed = 0;
  const errors: unknown[] = [];

  try {
    await client.query('BEGIN');
    const riders = (await client.query(
      'SELECT id, first_name, last_name, name, date_of_birth, phone FROM riders WHERE org_id = $1 AND is_active = true', [opts.orgId])).rows;

    for (const row of validated) {
      const hasDupIssue = row.issues.some(i => i.code === 'E_DUPLICATE_IN_DB');
      const otherErrors = row.issues.filter(i => i.severity === 'error' && i.code !== 'E_DUPLICATE_IN_DB');

      if (otherErrors.length > 0) { failed++; errors.push(...otherErrors); continue; }

      if (hasDupIssue) {
        duplicates++;
        if (opts.duplicatePolicy === 'skip') { skipped++; continue; }
        if (opts.duplicatePolicy === 'reject') { failed++; errors.push(...row.issues.filter(i => i.code === 'E_DUPLICATE_IN_DB')); continue; }
        // 'update' falls through to UPDATE branch below
      }

      try {
        const rider = matchRider(riders, row.trip) ?? await createRider(client, opts.orgId, row.trip, riders);
        const t = row.trip;
        const pickupStr = fmtAddr(t.pickupAddress);
        const dropoffStr = fmtAddr(t.dropoffAddress);

        if (hasDupIssue && opts.duplicatePolicy === 'update') {
          await client.query(
            `UPDATE trips SET rider_id=$1, pickup_address=$2, dropoff_address=$3,
               scheduled_pickup_at=$4, appointment_at=$5, level_of_service=$6,
               additional_passengers=$7, assistance_needs=$8, trip_type=$9,
               distance_miles=$10, dispatcher_notes=$11, updated_at=NOW()
             WHERE org_id=$12 AND source_vendor_profile_id=$13 AND external_trip_id=$14`,
            [rider.id, pickupStr, dropoffStr, t.pickupAt, t.appointmentAt, t.levelOfService,
             t.additionalPassengers, t.assistanceNeeds, t.tripType, t.distanceMiles, t.notes,
             opts.orgId, opts.profileId, t.externalTripId]
          );
          updated++;
          continue;
        }

        const inserted = await client.query(
          `INSERT INTO trips (org_id, rider_id, pickup_address, dropoff_address,
             scheduled_pickup_at, appointment_at, status, mobility_type,
             external_trip_id, level_of_service, additional_passengers, assistance_needs,
             trip_type, distance_miles, dispatcher_notes, source_vendor_profile_id,
             import_job_id, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7::trip_status,'standard',$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
           RETURNING id`,
          [opts.orgId, rider.id, pickupStr, dropoffStr,
           t.pickupAt ?? t.appointmentAt, t.appointmentAt, t.status ?? 'scheduled',
           t.externalTripId, t.levelOfService, t.additionalPassengers, t.assistanceNeeds,
           t.tripType, t.distanceMiles, t.notes, opts.profileId, jobId, opts.userId]
        );
        tripIds.push(inserted.rows[0].id);
        created++;
      } catch (err) {
        failed++;
        errors.push({ row: row.row, sourceTripId: row.trip.externalTripId, code: 'E_INSERT', message: (err as Error).message });
      }
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    await query(`UPDATE import_jobs SET status = 'failed', completed_at = NOW() WHERE id = $1`, [jobId]);
    client.release();
    throw err;
  }
  client.release();

  await query(
    `UPDATE import_jobs SET status = 'completed', imported_rows = $1, updated_rows = $2,
       skipped_rows = $3, duplicate_rows = $4, error_rows = $5, errors = $6,
       result_trip_ids = $7, completed_at = NOW() WHERE id = $8`,
    [created, updated, skipped, duplicates, failed, JSON.stringify([...analysis.issues.filter(i => i.severity === 'error'), ...errors].slice(0, 1000)), tripIds, jobId]
  );

  // Audit: generated trip IDs recorded, no sensitive values
  await query(
    `INSERT INTO audit_log (org_id, user_id, user_role, entity_type, entity_id, action, details)
     VALUES ($1, $2, $3, 'import_job', $4, 'import_executed', $5)`,
    [opts.orgId, opts.userId, opts.userRole, jobId, JSON.stringify({ mode: opts.mode, created, updated, skipped, duplicates, failed, tripIds })]
  ).catch(() => {});

  // Best-effort background geocoding (throttled per Nominatim policy) — fire and forget
  geocodeImportedTrips(tripIds).catch(err => logger.warn('Background geocode failed', { error: err.message }));

  return jobId;
}

async function createRider(client: import('pg').PoolClient, orgId: number, t: import('@midtransport/shared').CanonicalTrip, riders: RiderRow[]): Promise<RiderRow> {
  const name = [t.passengerFirstName, t.passengerLastName].filter(Boolean).join(' ');
  const inserted = await client.query(
    `INSERT INTO riders (org_id, name, first_name, last_name, date_of_birth, medical_id, phone, phone_alt, home_address, dispatcher_notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id, first_name, last_name, name, date_of_birth, phone`,
    [orgId, name, t.passengerFirstName, t.passengerLastName, t.dateOfBirth, t.medicalId,
     t.primaryPhone, t.alternatePhone, fmtAddr(t.pickupAddress),
     t.assistanceNeeds ? `Assistance: ${t.assistanceNeeds}` : null]
  );
  const row = inserted.rows[0] as RiderRow;
  riders.push(row); // subsequent rows for the same passenger match
  return row;
}

function fmtAddr(a: { street: string; city: string; state: string; zip: string } | null): string {
  return a ? [a.street, a.city, a.state, a.zip].filter(Boolean).join(', ') : '';
}

async function finalizeJob(jobId: number, analysis: { counts: Record<string, number>; issues: unknown[] }, tripIds: number[]): Promise<void> {
  await query(
    `UPDATE import_jobs SET status = 'completed', total_rows = $1, error_rows = $2, errors = $3, result_trip_ids = $4, completed_at = NOW() WHERE id = $5`,
    [analysis.counts.total, analysis.counts.invalid, JSON.stringify(analysis.issues.slice(0, 1000)), tripIds, jobId]
  );
}

async function geocodeImportedTrips(tripIds: number[]): Promise<void> {
  for (const id of tripIds) {
    const trip = await queryOne<{ pickup_address: string; dropoff_address: string }>(
      'SELECT pickup_address, dropoff_address FROM trips WHERE id = $1', [id]);
    if (!trip) continue;
    const p = await geocodeAddress(trip.pickup_address);
    const d = await geocodeAddress(trip.dropoff_address);
    if (p || d) {
      await query('UPDATE trips SET pickup_lat = COALESCE($1, pickup_lat), pickup_lng = COALESCE($2, pickup_lng), dropoff_lat = COALESCE($3, dropoff_lat), dropoff_lng = COALESCE($4, dropoff_lng) WHERE id = $5',
        [p?.lat ?? null, p?.lng ?? null, d?.lat ?? null, d?.lng ?? null, id]);
    }
    await new Promise(r => setTimeout(r, 1100)); // Nominatim 1 req/s policy
  }
}
```

- [ ] **Step 2: Add execute route to `importTrips.ts`**

```ts
router.post('/execute',
  body('uploadId').isInt(), body('profileVersionId').isInt(), body('profileId').isInt(),
  body('mode').isIn(['test', 'all_or_nothing', 'valid_rows_only']),
  body('duplicatePolicy').isIn(['skip', 'reject', 'update']),
  body('mappingOverrides').optional().isObject(),
  async (req: Request, res: Response, next: NextFunction) => {
    if (!validationResult(req).isEmpty()) return next(new AppError('Missing or invalid execute parameters', 400));
    try {
      const { uploadId, profileVersionId, profileId, mode, duplicatePolicy, mappingOverrides } = req.body;
      if ((mode === 'all_or_nothing' || duplicatePolicy === 'update') && req.user!.role !== 'admin') {
        return next(new AppError('All-or-nothing mode and update policy require an administrator', 403));
      }
      const uploadRow = await queryOne<{ filename: string; sha256: string }>(
        'SELECT filename, sha256 FROM import_uploads WHERE id = $1 AND org_id = $2 AND expires_at > NOW()',
        [uploadId, req.user!.orgId]
      );
      if (!uploadRow) return next(new AppError('Upload not found or expired — re-upload the file', 404));

      const jobId = await executeImport({
        orgId: req.user!.orgId, userId: req.user!.userId, userRole: req.user!.role,
        uploadId, profileVersionId, profileId, mappingOverrides,
        mode, duplicatePolicy, filename: uploadRow.filename, fileHash: uploadRow.sha256,
      });
      res.status(202).json({ jobId, statusUrl: `/api/import/trips/jobs/${jobId}` });
    } catch (err) { next(err); }
  }
);
```

- [ ] **Step 3: Verify** — build clean; manual end-to-end via curl with vendor-a fixture in `test` mode (job completes, counts match analyze, no trips created) then `valid_rows_only` (1 trip created, 2 failed).
- [ ] **Step 4: Commit** — `git commit -m "feat(api): trip import execute endpoint with modes, duplicate policies, audit, background geocode"`

### Task 23: Job status + error CSV download

**Files:**
- Modify: `apps/api/src/routes/importTrips.ts`

**Interfaces:**
- Produces: `GET /api/import/trips/jobs/:id` → job row (counts, mode, status); `GET /api/import/trips/jobs/:id/errors.csv` → CSV with columns `row,source_trip_id,field,code,guidance`.

- [ ] **Step 1: Implement** in `importTrips.ts`

```ts
router.get('/jobs/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const job = await queryOne(
      `SELECT id, status, mode, duplicate_policy, filename, total_rows, imported_rows, updated_rows,
              skipped_rows, duplicate_rows, error_rows, created_at, completed_at
       FROM import_jobs WHERE id = $1 AND org_id = $2 AND import_type = 'trips'`,
      [req.params.id, req.user!.orgId]
    );
    if (!job) return next(new AppError('Import job not found', 404));
    res.json(job);
  } catch (err) { next(err); }
});

router.get('/jobs/:id/errors.csv', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const job = await queryOne<{ errors: Array<{ row?: number; sourceTripId?: string | null; field?: string | null; code?: string; guidance?: string }> }>(
      `SELECT errors FROM import_jobs WHERE id = $1 AND org_id = $2 AND import_type = 'trips'`,
      [req.params.id, req.user!.orgId]
    );
    if (!job) return next(new AppError('Import job not found', 404));
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = ['row,source_trip_id,field,code,guidance'];
    for (const e of job.errors ?? []) {
      lines.push([e.row ?? '', e.sourceTripId ?? '', e.field ?? '', e.code ?? '', esc(e.guidance ?? '')].join(','));
    }
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="import-${req.params.id}-errors.csv"`);
    res.send(lines.join('\n'));
  } catch (err) { next(err); }
});
```

- [ ] **Step 2: Verify** — build clean; curl the errors CSV after a `valid_rows_only` run → file with 2 error rows for the vendor-a fixture.
- [ ] **Step 3: Commit** — `git commit -m "feat(api): import job status and downloadable error CSV"`

### Task 24: Vendor profile routes + canonical-fields endpoint

**Files:**
- Create: `apps/api/src/routes/vendorProfiles.ts`
- Modify: `apps/api/src/app.ts` (mount `/api/import/profiles`)
- Modify: `apps/api/src/routes/importTrips.ts` (add `GET /canonical-fields`)

**Interfaces:**
- Produces:
  - `GET /api/import/profiles` → `[{ id, name, is_active, latestVersion, created_at }]`
  - `POST /api/import/profiles` (admin) body `{ name, config: VendorProfileConfig }` → `{ profileId, versionId }` (creates version 1)
  - `GET /api/import/profiles/:id` → `{ id, name, versions: [{ id, version, created_at }], latestConfig }`
  - `POST /api/import/profiles/:id/versions` (admin) body `{ config }` → `{ versionId, version }` (version = max+1; immutable)
  - `GET /api/import/trips/canonical-fields` → `CANONICAL_FIELDS`

- [ ] **Step 1: Implement `vendorProfiles.ts`**

```ts
import { Router, Request, Response, NextFunction } from 'express';
import { body, validationResult } from 'express-validator';
import { authenticate, requireRole } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { query, queryOne } from '../db/pool';
import { isValidMappingTarget } from '../services/importEngine/canonical';

const router = Router();
router.use(authenticate);

function validateConfig(config: Record<string, unknown>): string | null {
  const required = ['headerSignature', 'columnMap', 'dateFormat', 'timeFormat', 'dateTimeFormat', 'timezone'];
  for (const k of required) if (config[k] === undefined) return `config.${k} is required`;
  if (!Array.isArray(config.headerSignature)) return 'config.headerSignature must be an array';
  const columnMap = config.columnMap as Record<string, string>;
  for (const [source, target] of Object.entries(columnMap)) {
    if (!isValidMappingTarget(target)) return `Invalid mapping target "${target}" for column "${source}"`;
  }
  return null;
}

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rows = await query(
      `SELECT p.id, p.name, p.is_active, p.created_at,
              (SELECT MAX(v.version) FROM vendor_profile_versions v WHERE v.profile_id = p.id) AS "latestVersion"
       FROM vendor_profiles p WHERE p.org_id = $1 ORDER BY p.name`,
      [req.user!.orgId]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

router.post('/', requireRole('admin'),
  body('name').trim().notEmpty().isLength({ max: 200 }),
  body('config').isObject(),
  async (req: Request, res: Response, next: NextFunction) => {
    if (!validationResult(req).isEmpty()) return next(new AppError('name and config are required', 400));
    try {
      const invalid = validateConfig(req.body.config);
      if (invalid) return next(new AppError(invalid, 400));
      const profile = await queryOne<{ id: number }>(
        'INSERT INTO vendor_profiles (org_id, name, created_by) VALUES ($1, $2, $3) RETURNING id',
        [req.user!.orgId, req.body.name, req.user!.userId]
      );
      const version = await queryOne<{ id: number }>(
        'INSERT INTO vendor_profile_versions (profile_id, version, config, created_by) VALUES ($1, 1, $2, $3) RETURNING id',
        [profile!.id, JSON.stringify(req.body.config), req.user!.userId]
      );
      res.status(201).json({ profileId: profile!.id, versionId: version!.id });
    } catch (err) { next(err); }
  }
);

router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const profile = await queryOne(
      'SELECT id, name, is_active FROM vendor_profiles WHERE id = $1 AND org_id = $2',
      [req.params.id, req.user!.orgId]
    );
    if (!profile) return next(new AppError('Profile not found', 404));
    const versions = await query(
      'SELECT id, version, created_at FROM vendor_profile_versions WHERE profile_id = $1 ORDER BY version DESC',
      [req.params.id]
    );
    const latest = await queryOne<{ config: unknown }>(
      'SELECT config FROM vendor_profile_versions WHERE profile_id = $1 ORDER BY version DESC LIMIT 1',
      [req.params.id]
    );
    res.json({ ...profile, versions, latestConfig: latest?.config ?? null });
  } catch (err) { next(err); }
});

router.post('/:id/versions', requireRole('admin'),
  body('config').isObject(),
  async (req: Request, res: Response, next: NextFunction) => {
    if (!validationResult(req).isEmpty()) return next(new AppError('config is required', 400));
    try {
      const invalid = validateConfig(req.body.config);
      if (invalid) return next(new AppError(invalid, 400));
      const profile = await queryOne<{ id: number }>(
        'SELECT id FROM vendor_profiles WHERE id = $1 AND org_id = $2',
        [req.params.id, req.user!.orgId]
      );
      if (!profile) return next(new AppError('Profile not found', 404));
      const row = await queryOne<{ id: number; version: number }>(
        `INSERT INTO vendor_profile_versions (profile_id, version, config, created_by)
         VALUES ($1, (SELECT COALESCE(MAX(version), 0) + 1 FROM vendor_profile_versions WHERE profile_id = $1), $2, $3)
         RETURNING id, version`,
        [profile.id, JSON.stringify(req.body.config), req.user!.userId]
      );
      res.status(201).json({ versionId: row!.id, version: row!.version });
    } catch (err) { next(err); }
  }
);

export default router;
```

- [ ] **Step 2: Mount + canonical-fields**

In `src/app.ts`: `import vendorProfileRoutes from './routes/vendorProfiles';` + `app.use('/api/import/profiles', vendorProfileRoutes);`.

In `importTrips.ts`:

```ts
import { CANONICAL_FIELDS } from '../services/importEngine/canonical';
// ...
router.get('/canonical-fields', (_req: Request, res: Response) => {
  res.json(CANONICAL_FIELDS);
});
```

IMPORTANT route order: `/canonical-fields` must be registered BEFORE `/jobs/:id`-style parameter routes — in Express, place it immediately after `router.use(...)`.

- [ ] **Step 3: Verify** — build clean. Manual: create Vendor A profile via curl (config = `VENDOR_A_PROFILE` JSON), re-run upload → `detectedProfile` now returns the profile.
- [ ] **Step 4: Commit** — `git commit -m "feat(api): vendor profile CRUD with immutable versions + canonical-fields endpoint"`

### Task 25: Route permission tests (supertest)

**Files:**
- Modify: `apps/api/package.json` (devDeps: `supertest`, `@types/supertest`)
- Create: `apps/api/tests/routes/importPermissions.test.ts`

**Interfaces:**
- Consumes: `app` from Task 19. Mocks `db/pool` and `db/redis` via `vi.mock`.

- [ ] **Step 1: Write the test**

```ts
import { describe, it, expect, vi, beforeAll } from 'vitest';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = 'test-secret';

vi.mock('../../src/db/pool', () => ({
  db: { connect: vi.fn(), query: vi.fn(), end: vi.fn() },
  query: vi.fn().mockResolvedValue([]),
  queryOne: vi.fn().mockResolvedValue(null),
}));
vi.mock('../../src/db/redis', () => ({
  redis: { get: vi.fn().mockResolvedValue(null) },
  RedisKeys: { tokenBlacklist: (j: string) => `blacklist:${j}` },
}));
vi.mock('../../src/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import request from 'supertest';
import { app } from '../../src/app';

function token(role: 'admin' | 'dispatcher' | 'driver'): string {
  return jwt.sign({ userId: 1, orgId: 1, role, jti: `jti-${role}` }, 'test-secret');
}

describe('import route permissions', () => {
  it('rejects unauthenticated', async () => {
    await request(app).post('/api/import/trips/execute').send({}).expect(401);
  });
  it('rejects driver role on upload', async () => {
    await request(app).post('/api/import/trips/upload')
      .set('Authorization', `Bearer ${token('driver')}`).expect(403);
  });
  it('rejects non-admin execute with all_or_nothing', async () => {
    const res = await request(app).post('/api/import/trips/execute')
      .set('Authorization', `Bearer ${token('dispatcher')}`)
      .send({ uploadId: 1, profileVersionId: 1, profileId: 1, mode: 'all_or_nothing', duplicatePolicy: 'skip' });
    expect(res.status).toBe(403);
  });
  it('rejects non-admin profile creation', async () => {
    await request(app).post('/api/import/profiles')
      .set('Authorization', `Bearer ${token('dispatcher')}`)
      .send({ name: 'X', config: {} }).expect(403);
  });
  it('canonical-fields is reachable by dispatcher', async () => {
    const res = await request(app).get('/api/import/trips/canonical-fields')
      .set('Authorization', `Bearer ${token('dispatcher')}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(19);
  });
});
```

NOTE: `app.ts` mounts `auditMiddleware` which calls `db/pool` `query` on mutations — mocked above, returns `[]`, harmless. If the audit mock write interferes, keep the mock and assert only status codes.

- [ ] **Step 2: Run** — `npm install --workspace=apps/api && npm test --workspace=apps/api` → all green (engine tests + route tests).
- [ ] **Step 3: Commit** — `git commit -m "test(api): import route permission tests (supertest)"`

---

## Phase 4 — Web wizard UI

### Task 26: Wizard shell, routing, nav

**Files:**
- Create: `apps/web/src/pages/ImportTrips/index.tsx`, `apps/web/src/pages/ImportTrips/types.ts`
- Modify: `apps/web/src/App.tsx` (routes)
- Modify: `apps/web/src/components/Layout.tsx` (nav item)

**Interfaces:**
- Produces: routes `/import` (wizard) and `/import/profiles` (manager). Wizard state via `useReducer` in `ImportTrips/index.tsx`:

```ts
// apps/web/src/pages/ImportTrips/types.ts
export interface UploadInfo {
  uploadId: number; filename: string; sha256: string; encoding: string;
  delimiter: string; headers: string[]; rowCount: number;
  detectedProfile: { profileId: number; versionId: number; name: string; confidence: number } | null;
}
export interface AnalysisResult {
  counts: { total: number; valid: number; warning: number; invalid: number; duplicates: number; newRiders: number; matchedRiders: number };
  sample: Array<{ row: number; status: string; externalTripId: string | null; passengerName: string;
    primaryPhone: string; medicalId: string | null; pickupAt: string | null; pickupAddress: string; dropoffAddress: string }>;
  notices: string[];
  issues: Array<{ row: number; sourceTripId: string | null; field: string | null; code: string; guidance: string; severity: string }>;
  headers: string[]; recognized: string[]; unmapped: string[];
}
export interface WizardState {
  step: 1 | 2 | 3 | 4 | 5;
  upload: UploadInfo | null;
  profileId: number | null;         // vendor_profiles.id
  profileVersionId: number | null;  // vendor_profile_versions.id
  mappingOverrides: Record<string, string>;
  analysis: AnalysisResult | null;
  mode: 'test' | 'all_or_nothing' | 'valid_rows_only';
  duplicatePolicy: 'skip' | 'reject' | 'update';
  jobId: number | null;
}
```

- [ ] **Step 1: Create `types.ts`** exactly as above.

- [ ] **Step 2: Create the shell** `ImportTrips/index.tsx`:

```tsx
import { useReducer } from 'react';
import type { WizardState } from './types';
import { UploadStep } from './UploadStep';
import { MapStep } from './MapStep';
import { PreviewStep } from './PreviewStep';
import { ValidateStep } from './ValidateStep';
import { ResultsStep } from './ResultsStep';

export type WizardAction = Partial<WizardState> & { type: 'update' };

function reducer(state: WizardState, action: WizardAction): WizardState {
  const { type: _t, ...patch } = action;
  return { ...state, ...patch };
}

const initial: WizardState = {
  step: 1, upload: null, profileId: null, profileVersionId: null,
  mappingOverrides: {}, analysis: null,
  mode: 'valid_rows_only', duplicatePolicy: 'skip', jobId: null,
};

const STEPS = ['Upload', 'Map', 'Preview', 'Validate & Import', 'Results'];

export function ImportTrips() {
  const [state, dispatch] = useReducer(reducer, initial);
  const update = (patch: Partial<WizardState>) => dispatch({ type: 'update', ...patch });

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-1">Import Trips</h1>
      <p className="text-sm text-gray-500 mb-6">Upload a vendor CSV, map columns, preview, and import. Limits: 20 MB, 10,000 rows.</p>

      {/* Stepper */}
      <div className="flex items-center gap-2 mb-8">
        {STEPS.map((label, i) => (
          <div key={label} className="flex items-center gap-2">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold
              ${state.step > i + 1 ? 'bg-green-500 text-white' : state.step === i + 1 ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-500'}`}>
              {state.step > i + 1 ? '✓' : i + 1}
            </div>
            <span className={`text-sm ${state.step === i + 1 ? 'font-semibold text-gray-900' : 'text-gray-400'}`}>{label}</span>
            {i < STEPS.length - 1 && <div className="w-8 h-px bg-gray-300" />}
          </div>
        ))}
      </div>

      {state.step === 1 && <UploadStep state={state} update={update} />}
      {state.step === 2 && <MapStep state={state} update={update} />}
      {state.step === 3 && <PreviewStep state={state} update={update} />}
      {state.step === 4 && <ValidateStep state={state} update={update} />}
      {state.step === 5 && <ResultsStep state={state} update={update} />}
    </div>
  );
}
```

- [ ] **Step 3: Routes** in `App.tsx` — add imports `ImportTrips` and `ImportProfiles`; add inside the Layout route group:

```tsx
<Route path="import" element={<ImportTrips />} />
<Route path="import/profiles" element={<ImportProfiles />} />
```

- [ ] **Step 4: Nav** — in `Layout.tsx`, find the nav array (entries like `{ to: '/trips', label: 'Trips', icon: ... }`) and add `{ to: '/import', label: 'Import', icon: Upload }` (import `Upload` from `lucide-react`), placed after Riders.

- [ ] **Step 5: Verify** — `npm run build --workspace=apps/web` fails (step components don't exist yet) — that's expected; the next tasks create them. Alternatively stub all five step components in this task (`export function UploadStep() { return null; }` etc. as separate files to be filled in later tasks) so the build stays green. **Do the stubs** — never leave the build broken between tasks.
- [ ] **Step 6: Commit** — `git commit -m "feat(web): trip import wizard shell with stepper and routing"`

### Task 27: Upload step

**Files:**
- Modify: `apps/web/src/pages/ImportTrips/UploadStep.tsx`

**Interfaces:**
- Consumes: `WizardState`/`update` from Task 26; `POST /api/import/trips/upload` from Task 20.
- Produces: on success sets `upload`, `profileId`/`profileVersionId` (from detection, if any), `step: 2`.

- [ ] **Step 1: Implement** — drag-drop + file picker, posts multipart, displays limits, shows detection result:

```tsx
import { useState } from 'react';
import { api } from '../../lib/api';
import type { WizardState, UploadInfo } from './types';

export function UploadStep({ state, update }: { state: WizardState; update: (p: Partial<WizardState>) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const send = async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.csv')) { setError('Only .csv files are accepted'); return; }
    if (file.size > 20 * 1024 * 1024) { setError('File exceeds the 20 MB limit'); return; }
    setBusy(true); setError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const { data } = await api.post<UploadInfo>('/api/import/trips/upload', form);
      update({
        upload: data,
        profileId: data.detectedProfile?.profileId ?? null,
        profileVersionId: data.detectedProfile?.versionId ?? null,
        step: 2,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally { setBusy(false); }
  };

  return (
    <div>
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) send(f); }}
        className={`border-2 border-dashed rounded-xl p-12 text-center transition-colors
          ${dragOver ? 'border-blue-500 bg-blue-50' : 'border-gray-300 bg-white'}`}
      >
        <p className="text-lg font-medium text-gray-700 mb-2">Drop your vendor CSV here</p>
        <p className="text-sm text-gray-400 mb-4">or</p>
        <label className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-4 py-2 text-sm font-medium cursor-pointer">
          {busy ? 'Uploading…' : 'Choose file'}
          <input type="file" accept=".csv" className="hidden" disabled={busy}
            onChange={e => { const f = e.target.files?.[0]; if (f) send(f); }} />
        </label>
        <p className="text-xs text-gray-400 mt-4">Limits: 20 MB · 10,000 rows · .csv only · UTF-8 or Windows-1252</p>
      </div>
      {error && <p className="mt-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 2: Verify** — build clean; manually drop the vendor-a fixture → advances to step 2 with headers.
- [ ] **Step 3: Commit** — `git commit -m "feat(web): import wizard upload step"`

### Task 28: Map step (profile select/save + column mapping)

**Files:**
- Modify: `apps/web/src/pages/ImportTrips/MapStep.tsx`

**Interfaces:**
- Consumes: `GET /api/import/profiles`, `GET /api/import/trips/canonical-fields`, `GET /api/import/profiles/:id`, `POST /api/import/profiles` + `/versions` (admin only — the wizard calls these only when an admin clicks "Save as new profile version").

- [ ] **Step 1: Implement** — layout:

```tsx
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useAuthStore } from '../../hooks/useAuth';
import type { WizardState } from './types';

interface CanonicalField { key: string; label: string; type: string; required: boolean; description: string }
interface ProfileListItem { id: number; name: string; latestVersion: number }

export function MapStep({ state, update }: { state: WizardState; update: (p: Partial<WizardState>) => void }) {
  const user = useAuthStore(s => s.user);
  const isAdmin = user?.role === 'admin';
  const [error, setError] = useState<string | null>(null);

  const { data: fields = [] } = useQuery<CanonicalField[]>({
    queryKey: ['canonical-fields'],
    queryFn: () => api.get('/api/import/trips/canonical-fields').then(r => r.data),
  });
  const { data: profiles = [] } = useQuery<ProfileListItem[]>({
    queryKey: ['import-profiles'],
    queryFn: () => api.get('/api/import/profiles').then(r => r.data),
  });
  const { data: profileDetail } = useQuery({
    queryKey: ['import-profile', state.profileId],
    queryFn: () => api.get(`/api/import/profiles/${state.profileId}`).then(r => r.data),
    enabled: state.profileId !== null,
  });

  // Effective mapping = saved profile mapping + in-flight overrides
  const savedMap: Record<string, string> = profileDetail?.latestConfig?.columnMap ?? {};
  const effective = useMemo(() => ({ ...savedMap, ...state.mappingOverrides }), [savedMap, state.mappingOverrides]);

  const [draftProfileId, setDraftProfileId] = useState<number | null>(state.profileId);

  // When profile selection changes, reset overrides and set the latest version id
  useEffect(() => {
    if (draftProfileId !== state.profileId) {
      const latest = profileDetailFor(profiles, draftProfileId);
      update({ profileId: draftProfileId, profileVersionId: latest, mappingOverrides: {} });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftProfileId]);

  const requiredKeys = fields.filter(f => f.required).map(f => f.key);
  const mappedTargets = new Set(Object.values(effective).map(t => t.split('.')[0]));
  const missingRequired = requiredKeys.filter(k => !mappedTargets.has(k));

  const mappingOptions = fields.flatMap(f => {
    if (f.type === 'datetime') return [
      { value: f.key, label: `${f.label} (single column)` },
      { value: `${f.key}.date`, label: `${f.label} — date part` },
      { value: `${f.key}.time`, label: `${f.label} — time part` },
    ];
    if (f.type === 'address') return ['street', 'city', 'state', 'zip'].map(part => ({
      value: `${f.key}.${part}`, label: `${f.label} — ${part}`,
    }));
    return [{ value: f.key, label: f.label }];
  });

  return (
    <div className="space-y-6">
      {/* Detection banner */}
      {state.upload?.detectedProfile && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-800">
          Auto-detected profile <strong>{state.upload.detectedProfile.name}</strong> ({Math.round(state.upload.detectedProfile.confidence * 100)}% header match). Review the mapping below before continuing.
        </div>
      )}

      {/* Profile selector */}
      <div className="flex items-end gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Vendor profile</label>
          <select
            value={draftProfileId ?? ''}
            onChange={e => setDraftProfileId(e.target.value ? Number(e.target.value) : null)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
          >
            <option value="">— No profile (map manually) —</option>
            {profiles.map(p => <option key={p.id} value={p.id}>{p.name} (v{p.latestVersion})</option>)}
          </select>
        </div>
      </div>

      {/* Column mapping table */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100">
              <th className="text-left px-4 py-3 font-medium text-gray-600">Source column ({state.upload?.headers.length})</th>
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

      {/* Missing-required warning */}
      {missingRequired.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
          Required fields not yet mapped: <strong>{missingRequired.join(', ')}</strong>
        </div>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}

      {/* Actions */}
      <div className="flex items-center justify-between">
        <button onClick={() => update({ step: 1 })} className="text-sm text-gray-500 hover:underline">← Back</button>
        <div className="flex gap-2">
          {isAdmin && state.profileId && (
            <SaveVersionButton mapping={effective} onSaved={versionId => update({ profileVersionId: versionId, mappingOverrides: {} })} onError={setError} />
          )}
          <button
            disabled={missingRequired.length > 0 || !state.profileVersionId}
            onClick={() => update({ step: 3 })}
            className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-40"
          >
            Continue to preview →
          </button>
        </div>
      </div>
    </div>
  );
}

function profileDetailFor(profiles: ProfileListItem[], id: number | null): number | null {
  // latestVersion is the version NUMBER; we need the version row id — fetch happens via profile detail query.
  // The upload detection supplies versionId directly; for manual selection we resolve it from the detail query.
  return null; // resolved in effect below via detail query
}

function SaveVersionButton({ mapping, onSaved, onError }: {
  mapping: Record<string, string>;
  onSaved: (versionId: number) => void;
  onError: (msg: string) => void;
}) {
  return (
    <button
      onClick={async () => {
        try {
          // The parent supplies the full config via the profile detail query; see implementation note below.
          onError('Use "Save mapping as new version" — implemented with full config in Task 28 note');
        } catch (e) { onError(e instanceof Error ? e.message : 'Save failed'); }
      }}
      className="border border-gray-300 text-gray-700 rounded-lg px-3 py-2 text-sm font-medium hover:bg-gray-50"
    >
      Save mapping as new version
    </button>
  );
}
```

**Implementation note (fixes the two rough edges above — apply when writing the file):**
- Version-id resolution: the `GET /api/import/profiles/:id` response includes `versions: [{ id, version, created_at }]` sorted DESC. When `profileDetail` loads, if `state.profileVersionId` is null, `update({ profileVersionId: profileDetail.versions[0].id })`.
- `SaveVersionButton` needs the full config: spread `profileDetail.latestConfig` with `columnMap: effective` and POST to `/api/import/profiles/${state.profileId}/versions`; on success call `onSaved(data.versionId)` and invalidate queries `['import-profiles']` and `['import-profile', state.profileId]`. When no profile is selected and the user is admin, offer "Save as new profile" (prompt for name; POST `/api/import/profiles` with a full default config: `encoding: 'auto', delimiter: ',', dateFormat: 'M/d/yyyy', timeFormat: 'H:mm', dateTimeFormat: 'iso', timezone: <org tz unknown client-side — use 'America/New_York'>, valueTranslations: {}, defaults: {}, requiredOverrides: [], headerSignature: state.upload.headers`).

- [ ] **Step 2: Verify** — build clean; with a saved profile, mapping pre-fills; editing a select updates overrides; continue button gates on required fields.
- [ ] **Step 3: Commit** — `git commit -m "feat(web): import wizard column-mapping step with profile management"`

### Task 29: Preview step

**Files:**
- Modify: `apps/web/src/pages/ImportTrips/PreviewStep.tsx`

- [ ] **Step 1: Implement** — calls `/analyze` on mount and when mapping changes; shows notices, counts chips, masked sample table, recognized/unmapped column summary:

```tsx
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import type { WizardState, AnalysisResult } from './types';

export function PreviewStep({ state, update }: { state: WizardState; update: (p: Partial<WizardState>) => void }) {
  const { data, isLoading, error } = useQuery<AnalysisResult>({
    queryKey: ['import-analyze', state.upload?.uploadId, state.profileVersionId, state.mappingOverrides],
    queryFn: () => api.post('/api/import/trips/analyze', {
      uploadId: state.upload!.uploadId,
      profileVersionId: state.profileVersionId,
      mappingOverrides: state.mappingOverrides,
    }).then(r => r.data),
    enabled: state.upload !== null && state.profileVersionId !== null,
  });

  if (isLoading) return <p className="text-sm text-gray-500">Analyzing file…</p>;
  if (error) return <p className="text-sm text-red-600">{(error as Error).message}</p>;
  if (!data) return null;

  const c = data.counts;
  return (
    <div className="space-y-6">
      {/* Transformation notices */}
      {data.notices.length > 0 && (
        <ul className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-sm text-gray-700 list-disc list-inside">
          {data.notices.map((n, i) => <li key={i}>{n}</li>)}
        </ul>
      )}

      {/* Count chips */}
      <div className="flex flex-wrap gap-3">
        <Chip label="Total rows" value={c.total} tone="gray" />
        <Chip label="Valid" value={c.valid} tone="green" />
        <Chip label="Warnings" value={c.warning} tone="amber" />
        <Chip label="Invalid" value={c.invalid} tone="red" />
        <Chip label="Duplicates" value={c.duplicates} tone="amber" />
        <Chip label="Matched passengers" value={c.matchedRiders} tone="blue" />
        <Chip label="New passengers" value={c.newRiders} tone="blue" />
      </div>
      {c.newRiders > 0 && (
        <p className="text-sm text-blue-800 bg-blue-50 border border-blue-200 rounded-lg p-3">
          {c.newRiders} new passenger record{c.newRiders === 1 ? '' : 's'} will be created from trip rows (no existing match by name + date of birth or phone).
        </p>
      )}

      {/* Masked sample */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100">
              {['Row', 'Status', 'Trip ID', 'Passenger', 'Phone', 'Medical ID', 'Pickup at', 'Pickup', 'Drop-off'].map(h => (
                <th key={h} className="text-left px-3 py-2 font-medium text-gray-600 whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.sample.map(r => (
              <tr key={r.row} className="border-b border-gray-50">
                <td className="px-3 py-2 text-gray-500">{r.row}</td>
                <td className="px-3 py-2"><StatusDot status={r.status} /></td>
                <td className="px-3 py-2 font-mono text-xs">{r.externalTripId}</td>
                <td className="px-3 py-2">{r.passengerName}</td>
                <td className="px-3 py-2 font-mono text-xs">{r.primaryPhone}</td>
                <td className="px-3 py-2 font-mono text-xs">{r.medicalId ?? ''}</td>
                <td className="px-3 py-2 text-xs">{r.pickupAt ? new Date(r.pickupAt).toLocaleString() : '—'}</td>
                <td className="px-3 py-2 text-xs">{r.pickupAddress}</td>
                <td className="px-3 py-2 text-xs">{r.dropoffAddress}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-400">Showing first {data.sample.length} rows. Phone numbers and medical IDs are masked in this preview.</p>

      {/* Unmapped columns */}
      {data.unmapped.length > 0 && (
        <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3">
          Unmapped source columns (ignored): <span className="font-mono text-xs">{data.unmapped.join(', ')}</span>
        </p>
      )}

      <div className="flex items-center justify-between">
        <button onClick={() => update({ step: 2 })} className="text-sm text-gray-500 hover:underline">← Back to mapping</button>
        <button
          onClick={() => update({ analysis: data, step: 4 })}
          className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-4 py-2 text-sm font-medium"
        >
          Continue to validation →
        </button>
      </div>
    </div>
  );
}

function Chip({ label, value, tone }: { label: string; value: number; tone: 'gray' | 'green' | 'amber' | 'red' | 'blue' }) {
  const colors = { gray: 'bg-gray-100 text-gray-800', green: 'bg-green-100 text-green-800', amber: 'bg-amber-100 text-amber-800', red: 'bg-red-100 text-red-800', blue: 'bg-blue-100 text-blue-800' };
  return (
    <div className={`${colors[tone]} rounded-lg px-3 py-2`}>
      <span className="text-lg font-bold">{value}</span>
      <span className="text-xs ml-1.5">{label}</span>
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  const color = status === 'valid' ? 'bg-green-500' : status === 'warning' ? 'bg-amber-500' : 'bg-red-500';
  return <span className={`inline-block w-2.5 h-2.5 rounded-full ${color}`} title={status} />;
}
```

- [ ] **Step 2: Verify** — build clean; preview renders masked sample; counts match analyze response.
- [ ] **Step 3: Commit** — `git commit -m "feat(web): import wizard preview step with masked sample"`

### Task 30: Validate & Import step

**Files:**
- Modify: `apps/web/src/pages/ImportTrips/ValidateStep.tsx`

**Interfaces:**
- Consumes: `state.analysis` (reuses Preview's analyze response — no new call); `POST /api/import/trips/execute`. Admin gating via `useAuthStore`.

- [ ] **Step 1: Implement** — issues grouped by code (collapsible), mode + duplicate-policy selectors (admin-only options disabled with explanation), confirm + execute:

```tsx
import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useAuthStore } from '../../hooks/useAuth';
import type { WizardState } from './types';

export function ValidateStep({ state, update }: { state: WizardState; update: (p: Partial<WizardState>) => void }) {
  const isAdmin = useAuthStore(s => s.user?.role === 'admin');
  const [confirmText, setConfirmText] = useState('');
  const analysis = state.analysis!;

  const grouped = useMemo(() => {
    const map = new Map<string, typeof analysis.issues>();
    for (const issue of analysis.issues) {
      const list = map.get(issue.code) ?? [];
      list.push(issue);
      map.set(issue.code, list);
    }
    return [...map.entries()];
  }, [analysis.issues]);

  const execute = useMutation({
    mutationFn: () => api.post('/api/import/trips/execute', {
      uploadId: state.upload!.uploadId,
      profileVersionId: state.profileVersionId,
      profileId: state.profileId,
      mappingOverrides: state.mappingOverrides,
      mode: state.mode,
      duplicatePolicy: state.duplicatePolicy,
    }).then(r => r.data),
    onSuccess: data => update({ jobId: data.jobId, step: 5 }),
  });

  const needsConfirm = state.mode !== 'test';
  const canExecute = !execute.isPending && (!needsConfirm || confirmText === 'IMPORT');

  return (
    <div className="space-y-6">
      {/* Issues grouped by code */}
      <div className="space-y-3">
        {grouped.length === 0 && <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg p-3">No issues found — all rows are valid.</p>}
        {grouped.map(([code, issues]) => (
          <details key={code} className="bg-white border border-gray-200 rounded-lg">
            <summary className="px-4 py-3 cursor-pointer text-sm font-medium text-gray-800">
              <span className={`inline-block w-2 h-2 rounded-full mr-2 ${issues[0].severity === 'error' ? 'bg-red-500' : 'bg-amber-500'}`} />
              {code} <span className="text-gray-400 font-normal">({issues.length} row{issues.length === 1 ? '' : 's'})</span>
            </summary>
            <div className="px-4 pb-3 text-xs text-gray-600 space-y-1">
              <p className="text-gray-500 mb-2">{issues[0].guidance}</p>
              {issues.slice(0, 20).map((i, idx) => (
                <p key={idx}>Row {i.row}{i.sourceTripId ? ` · ${i.sourceTripId}` : ''}{i.field ? ` · ${i.field}` : ''}</p>
              ))}
              {issues.length > 20 && <p className="text-gray-400">…and {issues.length - 20} more (download the error CSV after import for the full list)</p>}
            </div>
          </details>
        ))}
      </div>

      {/* Mode + duplicate policy */}
      <div className="grid sm:grid-cols-2 gap-4">
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">Import mode</label>
          {([
            { value: 'test', label: 'Test mode — validate only, create nothing', admin: false },
            { value: 'valid_rows_only', label: 'Import valid rows, skip errors', admin: false },
            { value: 'all_or_nothing', label: 'All-or-nothing (admin)', admin: true },
          ] as const).map(opt => (
            <label key={opt.value} className={`flex items-start gap-2 text-sm py-1 ${opt.admin && !isAdmin ? 'opacity-40' : ''}`}>
              <input type="radio" name="mode" value={opt.value} checked={state.mode === opt.value}
                disabled={opt.admin && !isAdmin}
                onChange={() => update({ mode: opt.value })} className="mt-1" />
              {opt.label}
            </label>
          ))}
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">Duplicate policy</label>
          {([
            { value: 'skip', label: 'Skip duplicates', admin: false },
            { value: 'reject', label: 'Reject duplicates as errors', admin: false },
            { value: 'update', label: 'Update existing trips (admin)', admin: true },
          ] as const).map(opt => (
            <label key={opt.value} className={`flex items-start gap-2 text-sm py-1 ${opt.admin && !isAdmin ? 'opacity-40' : ''}`}>
              <input type="radio" name="policy" value={opt.value} checked={state.duplicatePolicy === opt.value}
                disabled={opt.admin && !isAdmin}
                onChange={() => update({ duplicatePolicy: opt.value })} className="mt-1" />
              {opt.label}
            </label>
          ))}
        </div>
      </div>

      {/* Confirm + execute */}
      {needsConfirm && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <p className="text-sm text-amber-800 mb-2">
            This will create or update trip records. Type <strong>IMPORT</strong> to confirm.
          </p>
          <input value={confirmText} onChange={e => setConfirmText(e.target.value)}
            className="border border-amber-300 rounded-lg px-3 py-2 text-sm w-40" placeholder="IMPORT" />
        </div>
      )}

      {execute.isError && <p className="text-sm text-red-600">{(execute.error as Error).message}</p>}

      <div className="flex items-center justify-between">
        <button onClick={() => update({ step: 3 })} className="text-sm text-gray-500 hover:underline">← Back to preview</button>
        <button
          disabled={!canExecute}
          onClick={() => execute.mutate()}
          className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-5 py-2.5 text-sm font-medium disabled:opacity-40"
        >
          {execute.isPending ? 'Starting…' : state.mode === 'test' ? 'Run test' : 'Run import'}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify** — build clean; non-admin sees disabled admin options; execute blocked until IMPORT typed.
- [ ] **Step 3: Commit** — `git commit -m "feat(web): import wizard validate + execute step with mode and policy gating"`

### Task 31: Results step + error CSV

**Files:**
- Modify: `apps/web/src/pages/ImportTrips/ResultsStep.tsx`

- [ ] **Step 1: Implement** — polls `GET /api/import/trips/jobs/:id` (refetchInterval 2s while `status === 'processing'`), renders counts, error-CSV download via `api.get(..., { responseType: 'blob' })`, "import another file" reset:

```tsx
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import type { WizardState } from './types';

interface JobStatus {
  id: number; status: string; mode: string; total_rows: number;
  imported_rows: number; updated_rows: number; skipped_rows: number;
  duplicate_rows: number; error_rows: number; completed_at: string | null;
}

export function ResultsStep({ state, update }: { state: WizardState; update: (p: Partial<WizardState>) => void }) {
  const { data: job } = useQuery<JobStatus>({
    queryKey: ['import-job', state.jobId],
    queryFn: () => api.get(`/api/import/trips/jobs/${state.jobId}`).then(r => r.data),
    refetchInterval: query => (query.state.data?.status === 'processing' ? 2000 : false),
    enabled: state.jobId !== null,
  });

  const downloadErrors = async () => {
    const res = await api.get(`/api/import/trips/jobs/${state.jobId}/errors.csv`, { responseType: 'blob' });
    const url = URL.createObjectURL(res.data as Blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `import-${state.jobId}-errors.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const reset = () => update({
    step: 1, upload: null, profileId: null, profileVersionId: null,
    mappingOverrides: {}, analysis: null, jobId: null,
    mode: 'valid_rows_only', duplicatePolicy: 'skip',
  });

  if (!job) return <p className="text-sm text-gray-500">Loading job…</p>;

  const failed = job.status === 'failed';

  return (
    <div className="space-y-6">
      <div className={`rounded-xl p-5 ${failed ? 'bg-red-50 border border-red-200' : 'bg-green-50 border border-green-200'}`}>
        <h2 className={`text-lg font-bold ${failed ? 'text-red-800' : 'text-green-800'}`}>
          {job.status === 'processing' ? 'Import running…' : failed ? 'Import failed' : job.mode === 'test' ? 'Test complete' : 'Import complete'}
        </h2>
        {job.status === 'failed' && (
          <p className="text-sm text-red-700 mt-1">
            {job.mode === 'all_or_nothing' ? 'All-or-nothing mode: invalid rows were found, so nothing was imported. Fix the errors and re-run.' : 'The import job failed. Check the error CSV for details.'}
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-center">
        {[
          { label: 'Total', value: job.total_rows },
          { label: 'Created', value: job.imported_rows },
          { label: 'Updated', value: job.updated_rows },
          { label: 'Skipped', value: job.skipped_rows },
          { label: 'Duplicates', value: job.duplicate_rows },
          { label: 'Failed', value: job.error_rows },
        ].map(s => (
          <div key={s.label} className="bg-white border border-gray-200 rounded-xl p-4">
            <p className="text-2xl font-bold text-gray-900">{s.value}</p>
            <p className="text-xs text-gray-500">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <button onClick={downloadErrors}
          className="border border-gray-300 text-gray-700 rounded-lg px-4 py-2 text-sm font-medium hover:bg-gray-50">
          Download error CSV
        </button>
        <button onClick={reset} className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-4 py-2 text-sm font-medium">
          Import another file
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify** — build clean; full wizard walkthrough with vendor-a fixture: upload → (create profile) → map → preview → validate → import → results; error CSV downloads and opens in Excel with correct columns.
- [ ] **Step 3: Commit** — `git commit -m "feat(web): import wizard results step with error CSV download"`

### Task 32: Vendor profiles manager page

**Files:**
- Create: `apps/web/src/pages/ImportProfiles/index.tsx`
- (Route already added in Task 26.)

**Interfaces:**
- Consumes: `GET/POST /api/import/profiles`, `GET /api/import/profiles/:id`, `POST /api/import/profiles/:id/versions`.

- [ ] **Step 1: Implement** — list page: table of profiles (name, latest version, created date); clicking a row expands an inline JSON viewer of `latestConfig` (read-only, `<pre>` with `JSON.stringify(config, null, 2)`) and a version history list. Header button "New profile from CSV" → mini-flow: file input reads headers client-side (papaparse is already a web dependency), prompts for profile name, then navigates to `/import` wizard? **No — keep it self-contained:** headers + name → POST `/api/import/profiles` with default config (same defaults as Task 28 note) and `headerSignature` from the file; user then refines mapping in the wizard. Show create button only to admins (`useAuthStore`).

Key implementation:

```tsx
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Papa from 'papaparse';
import { api } from '../../lib/api';
import { useAuthStore } from '../../hooks/useAuth';

export function ImportProfiles() {
  const queryClient = useQueryClient();
  const isAdmin = useAuthStore(s => s.user?.role === 'admin');
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: profiles = [] } = useQuery<Array<{ id: number; name: string; latestVersion: number; created_at: string }>>({
    queryKey: ['import-profiles'],
    queryFn: () => api.get('/api/import/profiles').then(r => r.data),
  });

  const { data: detail } = useQuery({
    queryKey: ['import-profile', expandedId],
    queryFn: () => api.get(`/api/import/profiles/${expandedId}`).then(r => r.data),
    enabled: expandedId !== null,
  });

  const createProfile = useMutation({
    mutationFn: (payload: { name: string; config: unknown }) =>
      api.post('/api/import/profiles', payload).then(r => r.data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['import-profiles'] }),
    onError: e => setError((e as Error).message),
  });

  const handleFile = (file: File) => {
    Papa.parse<string[]>(file, {
      preview: 1,
      complete: results => {
        const headers = results.data[0]?.map(h => h.trim()).filter(Boolean) ?? [];
        if (headers.length === 0) { setError('Could not read headers from that file'); return; }
        const name = window.prompt('Name for the new vendor profile (e.g. "MTM", "ModivCare"):');
        if (!name) return;
        createProfile.mutate({
          name,
          config: {
            headerSignature: headers,
            columnMap: {},
            encoding: 'auto', delimiter: ',',
            dateFormat: 'M/d/yyyy', timeFormat: 'H:mm', dateTimeFormat: 'iso',
            timezone: 'America/New_York',
            valueTranslations: {}, defaults: {}, requiredOverrides: [],
          },
        });
      },
    });
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Vendor Import Profiles</h1>
          <p className="text-sm text-gray-500 mt-0.5">Saved column mappings for recurring vendor files. Versions are immutable.</p>
        </div>
        {isAdmin && (
          <label className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-4 py-2 text-sm font-medium cursor-pointer">
            New profile from CSV
            <input type="file" accept=".csv" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
          </label>
        )}
      </div>
      {error && <p className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">{error}</p>}

      <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100">
        {profiles.length === 0 && <p className="p-6 text-sm text-gray-500">No profiles yet. Upload a vendor CSV in the import wizard or create one here.</p>}
        {profiles.map(p => (
          <div key={p.id}>
            <button onClick={() => setExpandedId(expandedId === p.id ? null : p.id)}
              className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-gray-50">
              <span className="font-medium text-gray-900">{p.name}</span>
              <span className="text-xs text-gray-400">v{p.latestVersion} · {new Date(p.created_at).toLocaleDateString()}</span>
            </button>
            {expandedId === p.id && detail && (
              <div className="px-5 pb-4 space-y-3">
                <div>
                  <p className="text-xs font-medium text-gray-500 mb-1">Version history</p>
                  <p className="text-xs text-gray-600">{detail.versions.map((v: { version: number }) => `v${v.version}`).join(' · ')}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-gray-500 mb-1">Latest configuration</p>
                  <pre className="text-xs bg-gray-50 border border-gray-200 rounded-lg p-3 overflow-x-auto max-h-64">{JSON.stringify(detail.latestConfig, null, 2)}</pre>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify** — build clean; create profile from vendor-a fixture CSV → appears in list; wizard detects it on next upload.
- [ ] **Step 3: Commit** — `git commit -m "feat(web): vendor profile manager page"`

---

## Phase 5 — Simplified manual entry

### Task 33: Canonical validation endpoint + extended trip creation

**Files:**
- Modify: `apps/api/src/routes/trips.ts`
- Test: extend `apps/api/tests/routes/importPermissions.test.ts`? **No** — verify via build + manual curl (route logic is thin over the tested engine).

**Interfaces:**
- Produces: `POST /api/trips/validate-canonical` body `{ trip: CanonicalTrip & { riderId?: number } }` → `{ valid: boolean; issues: ImportIssue[]; duplicateWarning: { tripId: number; scheduledPickupAt: string } | null }`.
- Extends: `POST /api/trips` body now also accepts optional `appointmentAt`, `levelOfService`, `additionalPassengers`, `assistanceNeeds`, `tripType`, `externalTripId`, `newRider: { firstName, lastName, dateOfBirth?, phone, medicalId? }`, `returnTrip: { pickupAt: string; appointmentAt?: string }`.

- [ ] **Step 1: Add validate-canonical** to `trips.ts` (before `router.get('/:id')` to avoid param capture):

```ts
router.post('/validate-canonical',
  requireRole('admin', 'dispatcher'),
  body('trip').isObject(),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { trip } = req.body as { trip: CanonicalTrip };
      const { validateRows } = await import('../services/importEngine/validate');
      const { requiredKeys } = await import('../services/importEngine/canonical');
      const losRows = await query<{ code: string }>(
        'SELECT code FROM levels_of_service WHERE org_id = $1 AND is_active = true', [req.user!.orgId]);
      const { results } = validateRows(
        { trips: [trip], rowNumbers: [1], issues: [], notices: [] },
        requiredKeys(['external_trip_id']), // manual entry: external ref optional
        { levelOfServiceCodes: losRows.map(r => r.code), existingExternalIds: new Set() }
      );
      // duplicate warning: same rider name + same service date
      let duplicateWarning = null;
      if (trip.passengerFirstName && trip.passengerLastName && trip.pickupAt) {
        const dup = await queryOne<{ id: number; scheduled_pickup_at: string }>(
          `SELECT t.id, t.scheduled_pickup_at FROM trips t
           JOIN riders r ON r.id = t.rider_id
           WHERE t.org_id = $1
             AND LOWER(COALESCE(r.first_name, split_part(r.name, ' ', 1))) = LOWER($2)
             AND LOWER(COALESCE(r.last_name, split_part(r.name, ' ', 2))) = LOWER($3)
             AND DATE(t.scheduled_pickup_at AT TIME ZONE 'UTC') = DATE($4::timestamptz)
             AND t.status NOT IN ('cancelled') LIMIT 1`,
          [req.user!.orgId, trip.passengerFirstName, trip.passengerLastName, trip.pickupAt]
        );
        if (dup) duplicateWarning = { tripId: dup.id, scheduledPickupAt: dup.scheduled_pickup_at };
      }
      res.json({ valid: results[0].status !== 'invalid', issues: results[0].issues, duplicateWarning });
    } catch (err) { next(err); }
  }
);
```

Add `import type { CanonicalTrip } from '@midtransport/shared';` at the top.

- [ ] **Step 2: Extend `POST /api/trips`** — inside the existing handler, after rider verification:

  - If `newRider` is provided instead of `riderId`: insert rider first (`name = first + last`, split fields, phone, dob, medical_id, home_address = pickup), use its id.
  - Accept the new optional columns in the INSERT: `appointment_at`, `level_of_service`, `additional_passengers`, `assistance_needs`, `trip_type`, `external_trip_id`.
  - If `returnTrip` provided: after creating the outbound trip, create a second trip with pickup/dropoff swapped, `scheduled_pickup_at = returnTrip.pickupAt`, `appointment_at = returnTrip.appointmentAt ?? null`, same rider + canonical fields, `dispatcher_notes = 'Return leg'` appended to any notes. Emit `trip:created` for both.

- [ ] **Step 3: Verify** — build clean; curl: create trip with `newRider` + `returnTrip` → 2 trips, second with swapped addresses; `validate-canonical` with a bad phone → `{ valid: false, issues: [E_PHONE_INVALID] }`; duplicate warning fires on a second identical request.
- [ ] **Step 4: Commit** — `git commit -m "feat(api): canonical trip validation endpoint + manual-entry trip creation with return leg"`

### Task 34: Guided manual entry UI (replaces AddTripModal)

**Files:**
- Modify: `apps/web/src/components/TripBoard/AddTripModal.tsx` (full rewrite of the component body; keep the same exported name and `{ onClose }` props — `TripBoard.tsx` needs no change)

**Interfaces:**
- Consumes: `GET /api/riders?search=`, `GET /api/geocode/search`, `POST /api/trips/validate-canonical`, `POST /api/trips` (extended), `GET /api/import/trips/canonical-fields` not needed — hardcode the LOS options from a new small endpoint? **No:** reuse `GET /api/import/trips/canonical-fields`? LOS codes are org data, not field defs — fetch LOS codes via `GET /api/import/profiles`? Wrong shape. **Decision:** fetch LOS codes client-side from `/api/reports`? None fit. Simplest correct: add `GET /api/levels-of-service` — **no, avoid new endpoint:** the validate endpoint already checks LOS; for the dropdown, add a tiny `GET /api/trips/lookups` in this task returning `{ levelOfService: [{code,label}], tripTypes: [{value,label}] }` (trip types static: `one_way`, `round_trip`, `multi_stop`). Implement inside `trips.ts` (3 lines of SQL + literal array).

- [ ] **Step 1: Add lookups endpoint** in `trips.ts`:

```ts
router.get('/lookups', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const los = await query(
      'SELECT code, label FROM levels_of_service WHERE org_id = $1 AND is_active = true ORDER BY code',
      [req.user!.orgId]);
    res.json({ levelOfService: los, tripTypes: [
      { value: 'one_way', label: 'One way' },
      { value: 'round_trip', label: 'Round trip' },
      { value: 'multi_stop', label: 'Multi-stop' },
    ]});
  } catch (err) { next(err); }
});
```

IMPORTANT: register before `router.get('/:id')`.

- [ ] **Step 2: Rewrite `AddTripModal.tsx`** — 4-screen mini-wizard inside the existing modal shell:

  1. **Passenger**: search box hitting `GET /api/riders?search=` (debounced 300ms); selecting fills the rider. "New passenger" toggle reveals first/last name, DOB, phone (required), medical ID (optional), assistance needs.
  2. **Trip**: service date + pickup time (or Will Call checkbox), trip type + level of service from `/api/trips/lookups`, additional passengers count, external reference (optional), notes.
  3. **Addresses**: two `AddressInput` blocks (pickup/dropoff). `AddressInput` = text input with 300ms debounced `/api/geocode/search` dropdown; choosing a suggestion fills street/city/state/zip fields (editable) and stores lat/lng.
  4. **Review**: plain-language summary; on mount posts `/api/trips/validate-canonical`; shows issues next to fields (map `field` → screen) and the duplicate warning banner if present. "Add return ride" toggle (available from step 2) adds return date/time inputs; review shows both legs. Submit posts `/api/trips`; on success `queryClient.invalidateQueries(['trips'])` + `onClose()`.
  - Draft persistence: `useEffect` writes the form object to `localStorage['mt-trip-draft']` on change; "Restore draft?" banner on open if present; cleared on successful submit.

Keep styling consistent with the existing modal (`fixed inset-0 bg-black/40 ...`, white rounded panel, max-w-2xl). Reuse the existing `Trip` type imports only where needed — this file should be self-contained (~350 lines).

- [ ] **Step 3: Verify** — build clean; create a trip end-to-end with a new passenger + return leg; confirm two trips appear on the board and duplicate warning shows when re-entering the same trip.
- [ ] **Step 4: Commit** — `git commit -m "feat(web): guided manual trip entry with validation sharing and return leg"`

---

## Phase 6 — Acceptance verification & docs

### Task 35: Acceptance-criteria checklist + docs

**Files:**
- Modify: `README.md` (feature list: trip import methods, vendor profiles)
- Create: `docs/superpowers/verification/2026-09-21-import-acceptance.md`

- [ ] **Step 1: Run each AC against a local stack** (`docker compose up`, seed profiles via the UI using the two synthetic fixtures, then the REAL vendor files — real files stay local, never committed). Record pass/fail + evidence in the verification doc:

| # | Acceptance criterion | How to verify |
|---|---|---|
| 1 | Both CSV structures parse via separate saved profiles without editing headings | Import `vendor-a.csv` and `vendor-b.csv` fixtures through their profiles |
| 2 | Windows-1252 + UTF-8-BOM import cleanly | Unit test (Task 9) + real MTM file locally |
| 3 | Whitespace/control chars removed, punctuation preserved | Pipeline test assertions (Task 17) + preview inspection |
| 4 | Preview + correct before import | Wizard steps 3–4 walkthrough |
| 5 | Dedupe key + skip/reject/update policies | Re-import same file with each policy |
| 6 | Stable error codes, no cross-rider exposure | Error CSV contents review |
| 7 | Manual entry + CSV share validation/model | `validate-canonical` test (Task 33) + create same trip both ways, compare records |
| 8 | Permissions, audit, retention, privacy | Permission tests (Task 25); `audit_log` query; upload expiry check |

- [ ] **Step 2: Update README.md** — under "Multiple Data Entry Methods", replace the CSV bullet with:

```markdown
- CSV bulk trip import with vendor profiles (auto-detected, versioned column mappings)
- Guided import wizard: upload → map → masked preview → validate → import with duplicate policies
- Simplified manual entry with address autocomplete, return-leg toggle, and shared validation
```

- [ ] **Step 3: Final full verification** — `npm test --workspace=apps/api` green; `npm run build:api && npm run build:web` green; `npx tsc --noEmit` clean in `apps/mobile`.
- [ ] **Step 4: Commit** — `git commit -m "docs: import feature verification + README update"`

---

## Self-review notes (plan author)

- **Spec coverage:** §3 stabilization → Tasks 1–5; §4 architecture → Tasks 7–19; §5 data model → Task 6; §6 canonical fields → Task 12; §7 normalization → Task 11/14; §8 error codes → Task 8; §9 workflow → Tasks 20–32; manual entry → Tasks 33–34; §10 ACs → Task 35; §11 testing → Tasks 1, 8–17, 25, 35.
- **Type consistency:** `MappingResult` (Task 14) consumed identically in Tasks 16, 21, 33; `AnalysisResult`/`MaskedSample` (Task 21) mirrored in web `types.ts` (Task 26); `WizardState` consumed by all five step components; `ImportMode`/`DuplicatePolicy` values match server `isIn` validators (Task 22) and web radio options (Task 30).
- **Deliberate simplifications:** preview and validate share one `/analyze` call (wizard steps are UI-level); geocoding runs in a throttled background loop after import (Nominatim 1 req/s policy makes synchronous geocoding impractical for large files); masked preview keeps names/addresses visible to authorized dispatchers (needed to verify mapping) while masking phone/medical ID.

