# Driver App MediRoutes-Parity Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add turn-by-turn navigation (deep-link), dropoff signature capture (required to complete), and a no-show/cancellation flow to the existing `apps/mobile` driver app, backed by a new append-only `trip_events` table.

**Architecture:** New `trip_events` audit table stores signatures, proof photos, no-show and cancellation events. Trip completion is centralized on `PATCH /api/trips/:id/status`, which enforces a server-side signature gate; dropoff OTP verify/fallback stop auto-completing. Mobile gains a navigation deep-link helper, a `SignatureCapture` screen, and a `TripException` screen.

**Tech Stack:** Node.js + Express + TypeScript (`apps/api`), PostgreSQL, vitest + supertest (mocked pool) for API tests; Expo + React Native + React Query (`apps/mobile`); `react-native-signature-canvas`, `expo-file-system` (new mobile deps).

**Spec:** `docs/superpowers/specs/2026-09-27-driver-app-mediroutes-parity-design.md`

---

## File Structure

**Backend (`apps/api`)**
- Modify `src/db/schema.sql` — add `trip_event_type` enum + `trip_events` table (canonical schema).
- Modify `src/db/migrate.ts` — idempotent migration for the same table (existing deployments).
- Create `src/lib/reasonCodes.ts` — no-show / cancellation reason-code constants (API source of truth).
- Modify `src/routes/trips.ts` — signature/no-show/cancellation endpoints + signature gate on status.
- Modify `src/routes/otp.ts` — dropoff verify/fallback stop auto-completing.
- Create `tests/routes/tripEvents.test.ts` — endpoint + gate tests.
- Modify `tests/routes/` (new file only; existing tests unchanged).

**Mobile (`apps/mobile`)**
- Create `src/lib/navigation.ts` — `openNavigation()` deep-link helper.
- Create `src/lib/reasonCodes.ts` — mirror of API reason codes (Metro can't bundle the workspace TS package without extra config; keep in sync).
- Create `src/screens/SignatureCapture.tsx` — signing pad + completion.
- Create `src/screens/TripException.tsx` — no-show/cancellation form.
- Modify `src/screens/ActiveTrip.tsx` — Navigate buttons + No-show/Cancel action.
- Modify `src/screens/OTPEntry.tsx` — dropoff success chains to `SignatureCapture`.
- Modify `App.tsx` — register the two new screens.
- Modify `package.json` — add deps.

---

## Phase 1 — Backend

### Task 1: Add `trip_events` schema + migration

**Files:**
- Modify: `apps/api/src/db/schema.sql` (append after the `trips` indexes block, ~line 186)
- Modify: `apps/api/src/db/migrate.ts` (add a new idempotent block after the import-feature migration, before the admin seed)

- [ ] **Step 1: Add the enum + table to `schema.sql`**

Append after the trips indexes (after `CREATE INDEX idx_trips_pickup_time ...`):

```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- TRIP EVENTS (append-only audit: signature, proof photo, no-show, cancellation)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TYPE trip_event_type AS ENUM ('signature', 'proof_photo', 'no_show', 'cancellation');

CREATE TABLE IF NOT EXISTS trip_events (
  id            SERIAL PRIMARY KEY,
  org_id        INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  trip_id       INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  driver_id     INTEGER REFERENCES drivers(id),
  event_type    trip_event_type NOT NULL,
  reason_code   VARCHAR(40),
  note          TEXT,
  file_filename VARCHAR(255),
  lat           DECIMAL(10, 8),
  lng           DECIMAL(11, 8),
  created_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX idx_trip_events_trip ON trip_events(trip_id);
CREATE INDEX idx_trip_events_org ON trip_events(org_id);
```

- [ ] **Step 2: Add the idempotent migration to `migrate.ts`**

After the `logger.info('Schema migrations applied');`-and-import-feature block, before the admin-seed section, add:

```ts
    // Trip events (signature / proof / no-show / cancellation audit log)
    await db.query(`
      DO $$ BEGIN
        CREATE TYPE trip_event_type AS ENUM ('signature', 'proof_photo', 'no_show', 'cancellation');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;

      CREATE TABLE IF NOT EXISTS trip_events (
        id            SERIAL PRIMARY KEY,
        org_id        INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        trip_id       INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
        driver_id     INTEGER REFERENCES drivers(id),
        event_type    trip_event_type NOT NULL,
        reason_code   VARCHAR(40),
        note          TEXT,
        file_filename VARCHAR(255),
        lat           DECIMAL(10, 8),
        lng           DECIMAL(11, 8),
        created_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_trip_events_trip ON trip_events(trip_id);
      CREATE INDEX IF NOT EXISTS idx_trip_events_org ON trip_events(org_id);
    `);
    logger.info('Trip events migration applied');
```

- [ ] **Step 3: Type-check**

Run: `cd apps/api && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/db/schema.sql apps/api/src/db/migrate.ts
git commit -m "feat(api): add trip_events audit table + migration"
```

---

### Task 2: Reason-code constants (API)

**Files:**
- Create: `apps/api/src/lib/reasonCodes.ts`

- [ ] **Step 1: Create the constants file**

```ts
// Shared reason codes for trip exception events.
// NOTE: mirrored in apps/mobile/src/lib/reasonCodes.ts — keep both in sync.

export const NO_SHOW_REASON_CODES = [
  'rider_not_present',
  'rider_refused',
  'wrong_address',
  'rider_cancelled_on_arrival',
] as const;

export const CANCELLATION_REASON_CODES = [
  'dispatch_cancelled',
  'duplicate',
  'rider_unreachable',
  'other',
] as const;

export type NoShowReasonCode = (typeof NO_SHOW_REASON_CODES)[number];
export type CancellationReasonCode = (typeof CANCELLATION_REASON_CODES)[number];
```

- [ ] **Step 2: Type-check**

Run: `cd apps/api && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/lib/reasonCodes.ts
git commit -m "feat(api): add trip exception reason-code constants"
```

---

### Task 3: Signature endpoint + signature gate (TDD)

**Files:**
- Modify: `apps/api/src/routes/trips.ts`
- Create: `apps/api/tests/routes/tripEvents.test.ts`

- [ ] **Step 1: Write the failing test file**

Create `apps/api/tests/routes/tripEvents.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
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
vi.mock('../../src/lib/io', () => ({
  getIo: () => ({ to: () => ({ emit: vi.fn() }) }),
}));
vi.mock('../../src/lib/geocode', () => ({
  geocodeAddress: vi.fn().mockResolvedValue(null),
}));

import request from 'supertest';
import { app } from '../../src/app';
import { query, queryOne } from '../../src/db/pool';

const mockQuery = vi.mocked(query);
const mockQueryOne = vi.mocked(queryOne);

function token(role: 'admin' | 'dispatcher' | 'driver'): string {
  return jwt.sign({ userId: 1, orgId: 1, role, jti: `jti-${role}` }, 'test-secret');
}

beforeEach(() => {
  mockQuery.mockReset().mockResolvedValue([]);
  mockQueryOne.mockReset().mockResolvedValue(null);
});

describe('PATCH /api/trips/:id/status signature gate', () => {
  it('blocks completed with 409 when no signature event exists', async () => {
    // trip lookup (org check inside UPDATE path) — gate queryOne returns null (no signature)
    mockQueryOne.mockResolvedValue(null);
    const res = await request(app)
      .patch('/api/trips/5/status')
      .set('Authorization', `Bearer ${token('driver')}`)
      .send({ status: 'completed' });
    expect(res.status).toBe(409);
  });

  it('allows completed when a signature event exists', async () => {
    // 1st queryOne = signature gate check (found); 2nd queryOne = UPDATE ... RETURNING *
    mockQueryOne
      .mockResolvedValueOnce({ id: 99 })                       // signature exists
      .mockResolvedValueOnce({ id: 5, status: 'completed' });  // updated trip
    const res = await request(app)
      .patch('/api/trips/5/status')
      .set('Authorization', `Bearer ${token('driver')}`)
      .send({ status: 'completed' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('completed');
  });

  it('does not gate non-completed transitions', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 5, status: 'en_route_pickup' }); // UPDATE RETURNING
    const res = await request(app)
      .patch('/api/trips/5/status')
      .set('Authorization', `Bearer ${token('driver')}`)
      .send({ status: 'en_route_pickup' });
    expect(res.status).toBe(200);
  });
});

describe('POST /api/trips/:id/signature', () => {
  it('rejects unauthenticated', async () => {
    await request(app).post('/api/trips/5/signature').send({ imageBase64: 'x' }).expect(401);
  });

  it('400 when imageBase64 missing', async () => {
    const res = await request(app)
      .post('/api/trips/5/signature')
      .set('Authorization', `Bearer ${token('driver')}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it('404 when trip not in org', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ id: 7 }) // driver lookup
      .mockResolvedValueOnce(null);     // trip lookup -> not found
    const res = await request(app)
      .post('/api/trips/5/signature')
      .set('Authorization', `Bearer ${token('driver')}`)
      .send({ imageBase64: 'data:image/png;base64,iVBORw0KGgo=' });
    expect(res.status).toBe(404);
  });

  it('201 and records a signature event on success', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ id: 7 })     // driver lookup
      .mockResolvedValueOnce({ id: 5 })     // trip lookup
      .mockResolvedValueOnce({ id: 123 });  // insert RETURNING id
    const res = await request(app)
      .post('/api/trips/5/signature')
      .set('Authorization', `Bearer ${token('driver')}`)
      .send({ imageBase64: 'data:image/png;base64,iVBORw0KGgo=', lat: 43.6, lng: -70.2 });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ tripId: 5, eventType: 'signature' });
  });
});
```

> Note: signatures are sent as a base64 data URL in the JSON body (not multipart) — the driver's signature PNG is small and this avoids React Native `FormData` file-uri quirks. The server decodes and writes the PNG with `fs`. `fs` writes go to `process.env.UPLOAD_DIR` (default `/app/uploads/trip-events`). In tests we set `UPLOAD_DIR` to a temp dir so real writes are harmless; see Step 2.

- [ ] **Step 2: Set a temp UPLOAD_DIR at the top of the test file**

Add near the top of `tripEvents.test.ts`, right after `process.env.JWT_SECRET`:

```ts
import os from 'os';
import path from 'path';
process.env.UPLOAD_DIR = path.join(os.tmpdir(), 'midtransport-test-uploads');
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd apps/api && npx vitest run tests/routes/tripEvents.test.ts`
Expected: FAIL (routes not implemented; gate returns 200 instead of 409; signature route 404s the whole path).

- [ ] **Step 4: Add the signature endpoint + gate to `trips.ts`**

At the top of `apps/api/src/routes/trips.ts`, add imports (after existing imports):

```ts
import fs from 'fs';
import path from 'path';
```

Add the signature endpoint immediately after the existing `PATCH /:id/status` handler block (after its closing `);` near line 392):

```ts
// ─── POST /api/trips/:id/signature ───────────────────────────────────────────
// Driver captures rider/attendant signature at dropoff (required to complete).
const UPLOAD_DIR = process.env.UPLOAD_DIR || '/app/uploads/trip-events';

router.post('/:id/signature',
  param('id').isInt(),
  body('imageBase64').isString().notEmpty(),
  body('lat').optional().isFloat(),
  body('lng').optional().isFloat(),
  async (req: Request, res: Response, next: NextFunction) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return next(new AppError('Signature image is required', 400));

    try {
      const tripId = parseInt(req.params.id, 10);
      const { imageBase64, lat, lng } = req.body as {
        imageBase64: string; lat?: number; lng?: number;
      };

      const driver = await queryOne<{ id: number }>(
        'SELECT id FROM drivers WHERE user_id = $1', [req.user!.userId]
      );

      const trip = await queryOne<{ id: number }>(
        'SELECT id FROM trips WHERE id = $1 AND org_id = $2', [tripId, req.user!.orgId]
      );
      if (!trip) return next(new AppError('Trip not found', 404));

      const b64 = imageBase64.replace(/^data:image\/\w+;base64,/, '');
      const filename = `sig-${tripId}-${Date.now()}.png`;
      await fs.promises.mkdir(UPLOAD_DIR, { recursive: true });
      await fs.promises.writeFile(path.join(UPLOAD_DIR, filename), Buffer.from(b64, 'base64'));

      const event = await queryOne<{ id: number }>(
        `INSERT INTO trip_events (org_id, trip_id, driver_id, event_type, file_filename, lat, lng)
         VALUES ($1, $2, $3, 'signature', $4, $5, $6) RETURNING id`,
        [req.user!.orgId, tripId, driver?.id ?? null, filename,
         lat ?? null, lng ?? null]
      );

      res.status(201).json({ id: event!.id, tripId, eventType: 'signature' });
    } catch (err) { next(err); }
  }
);
```

Then modify the existing `PATCH /:id/status` handler: inside the `try`, after `const tripId = parseInt(...)` and before building `timestampUpdates`, insert the gate:

```ts
      // Signature gate: cannot complete without a captured signature.
      if (status === 'completed') {
        const sig = await queryOne<{ id: number }>(
          `SELECT id FROM trip_events WHERE trip_id = $1 AND event_type = 'signature' LIMIT 1`,
          [tripId]
        );
        if (!sig) {
          return next(new AppError('A signature is required before completing this trip', 409));
        }
      }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd apps/api && npx vitest run tests/routes/tripEvents.test.ts`
Expected: PASS (all cases in the two describe blocks above).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/trips.ts apps/api/tests/routes/tripEvents.test.ts
git commit -m "feat(api): signature endpoint + server-side completion gate"
```

---

### Task 4: No-show + cancellation endpoints (TDD)

**Files:**
- Modify: `apps/api/src/routes/trips.ts`
- Modify: `apps/api/tests/routes/tripEvents.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `tripEvents.test.ts`:

```ts
describe('POST /api/trips/:id/no-show', () => {
  it('rejects invalid reason code', async () => {
    const res = await request(app)
      .post('/api/trips/5/no-show')
      .set('Authorization', `Bearer ${token('driver')}`)
      .send({ reasonCode: 'not_a_reason' });
    expect(res.status).toBe(400);
  });

  it('404 when trip not in org', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ id: 7 }) // driver lookup
      .mockResolvedValueOnce(null);     // trip lookup
    const res = await request(app)
      .post('/api/trips/5/no-show')
      .set('Authorization', `Bearer ${token('driver')}`)
      .send({ reasonCode: 'rider_not_present' });
    expect(res.status).toBe(404);
  });

  it('records event + sets status no_show', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ id: 7 })   // driver lookup
      .mockResolvedValueOnce({ id: 5 });  // trip lookup
    const res = await request(app)
      .post('/api/trips/5/no-show')
      .set('Authorization', `Bearer ${token('driver')}`)
      .send({ reasonCode: 'rider_not_present', note: 'Waited 5 min' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('no_show');
  });
});

describe('POST /api/trips/:id/cancellation', () => {
  it('rejects invalid reason code', async () => {
    const res = await request(app)
      .post('/api/trips/5/cancellation')
      .set('Authorization', `Bearer ${token('dispatcher')}`)
      .send({ reasonCode: 'nope' });
    expect(res.status).toBe(400);
  });

  it('records event + sets status cancelled', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ id: 7 })   // driver lookup
      .mockResolvedValueOnce({ id: 5 });  // trip lookup
    const res = await request(app)
      .post('/api/trips/5/cancellation')
      .set('Authorization', `Bearer ${token('dispatcher')}`)
      .send({ reasonCode: 'duplicate' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('cancelled');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && npx vitest run tests/routes/tripEvents.test.ts`
Expected: FAIL (endpoints return 404 route-not-found or 401).

- [ ] **Step 3: Implement both endpoints in `trips.ts`**

Add import near the other imports:

```ts
import { NO_SHOW_REASON_CODES, CANCELLATION_REASON_CODES } from '../lib/reasonCodes';
```

Add after the signature endpoint. These write the event then set status via two sequential queries — matching the existing `otp.ts` fallback pattern (insert + update without an explicit transaction):

```ts
// ─── POST /api/trips/:id/no-show ─────────────────────────────────────────────
router.post('/:id/no-show',
  param('id').isInt(),
  body('reasonCode').isIn(NO_SHOW_REASON_CODES as unknown as string[]),
  body('note').optional().trim().isLength({ max: 1000 }),
  body('lat').optional().isFloat(),
  body('lng').optional().isFloat(),
  async (req: Request, res: Response, next: NextFunction) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return next(new AppError('Invalid no-show request', 400));
    await recordException(req, res, next, 'no_show', 'no_show');
  }
);

// ─── POST /api/trips/:id/cancellation ────────────────────────────────────────
router.post('/:id/cancellation',
  param('id').isInt(),
  body('reasonCode').isIn(CANCELLATION_REASON_CODES as unknown as string[]),
  body('note').optional().trim().isLength({ max: 1000 }),
  async (req: Request, res: Response, next: NextFunction) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return next(new AppError('Invalid cancellation request', 400));
    await recordException(req, res, next, 'cancellation', 'cancelled');
  }
);

// Shared handler for no-show / cancellation events.
async function recordException(
  req: Request, res: Response, next: NextFunction,
  eventType: 'no_show' | 'cancellation',
  newStatus: 'no_show' | 'cancelled',
) {
  try {
    const tripId = parseInt(req.params.id, 10);
    const { reasonCode, note, lat, lng } = req.body as {
      reasonCode: string; note?: string; lat?: number; lng?: number;
    };

    const driver = await queryOne<{ id: number }>(
      'SELECT id FROM drivers WHERE user_id = $1', [req.user!.userId]
    );

    const trip = await queryOne<{ id: number }>(
      'SELECT id FROM trips WHERE id = $1 AND org_id = $2', [tripId, req.user!.orgId]
    );
    if (!trip) return next(new AppError('Trip not found', 404));

    await query(
      `INSERT INTO trip_events (org_id, trip_id, driver_id, event_type, reason_code, note, lat, lng)
       VALUES ($1, $2, $3, $4::trip_event_type, $5, $6, $7, $8)`,
      [req.user!.orgId, tripId, driver?.id ?? null, eventType, reasonCode, note ?? null,
       lat ?? null, lng ?? null]
    );

    await query(
      `UPDATE trips SET status = $1::trip_status, updated_at = NOW() WHERE id = $2 AND org_id = $3`,
      [newStatus, tripId, req.user!.orgId]
    );

    getIo().to(`org:${req.user!.orgId}:dispatchers`).emit('trip:status-changed', {
      tripId, status: newStatus, timestamp: new Date().toISOString(),
    });

    res.json({ tripId, status: newStatus, eventType });
  } catch (err) { next(err); }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/api && npx vitest run tests/routes/tripEvents.test.ts`
Expected: PASS (all no-show/cancellation cases).

- [ ] **Step 5: Run the full API test suite (no regressions)**

Run: `cd apps/api && npx vitest run`
Expected: PASS (all suites, including the existing import/route tests).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/trips.ts apps/api/tests/routes/tripEvents.test.ts
git commit -m "feat(api): no-show and cancellation event endpoints"
```

---

### Task 5: Stop dropoff OTP from auto-completing (TDD)

**Files:**
- Modify: `apps/api/src/routes/otp.ts`
- Create: `apps/api/tests/routes/otpDropoff.test.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/api/tests/routes/otpDropoff.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
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
vi.mock('../../src/lib/io', () => ({
  getIo: () => ({ to: () => ({ emit: vi.fn() }) }),
}));
vi.mock('../../src/services/otp', () => ({
  verifyOtp: vi.fn().mockResolvedValue({ success: true }),
  recordFallback: vi.fn().mockResolvedValue(1),
}));

import request from 'supertest';
import { app } from '../../src/app';
import { query, queryOne } from '../../src/db/pool';

const mockQuery = vi.mocked(query);
const mockQueryOne = vi.mocked(queryOne);

function token(): string {
  return jwt.sign({ userId: 1, orgId: 1, role: 'driver', jti: 'jti-d' }, 'test-secret');
}

beforeEach(() => {
  mockQuery.mockReset().mockResolvedValue([]);
  mockQueryOne.mockReset().mockResolvedValue({ id: 5, org_id: 1 }); // trip lookup
});

describe('POST /api/otp/:tripId/verify dropoff', () => {
  it('returns arrived_dropoff (does not complete) for dropoff', async () => {
    const res = await request(app)
      .post('/api/otp/5/verify')
      .set('Authorization', `Bearer ${token()}`)
      .send({ code: '123456', eventType: 'dropoff' });
    expect(res.status).toBe(200);
    expect(res.body.newStatus).toBe('arrived_dropoff');
  });

  it('still advances to picked_up for pickup', async () => {
    const res = await request(app)
      .post('/api/otp/5/verify')
      .set('Authorization', `Bearer ${token()}`)
      .send({ code: '123456', eventType: 'pickup' });
    expect(res.status).toBe(200);
    expect(res.body.newStatus).toBe('picked_up');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && npx vitest run tests/routes/otpDropoff.test.ts`
Expected: FAIL — the dropoff case currently returns `newStatus: 'completed'`.

- [ ] **Step 3: Modify `otp.ts` verify handler**

In the `POST /:tripId/verify` handler, replace the status block:

```ts
      // Update trip status after successful OTP
      const newStatus = eventType === 'pickup' ? 'picked_up' : 'completed';
      const timestampField = eventType === 'pickup' ? 'actual_pickup_at' : 'actual_dropoff_at';

      await query(
        `UPDATE trips SET status = $1, ${timestampField} = NOW(), updated_at = NOW() WHERE id = $2`,
        [newStatus, tripId]
      );
```

with (dropoff no longer completes; completion happens after signature via PATCH /status):

```ts
      // Pickup advances to picked_up. Dropoff does NOT complete here — the trip
      // is completed only after signature capture (PATCH /status enforces the gate).
      let newStatus: string;
      if (eventType === 'pickup') {
        newStatus = 'picked_up';
        await query(
          `UPDATE trips SET status = $1, actual_pickup_at = NOW(), updated_at = NOW() WHERE id = $2`,
          [newStatus, tripId]
        );
      } else {
        newStatus = 'arrived_dropoff';
        // Status stays arrived_dropoff; only record that dropoff OTP was verified.
        await query(
          `UPDATE trips SET updated_at = NOW() WHERE id = $1`,
          [tripId]
        );
      }
```

- [ ] **Step 4: Modify `otp.ts` fallback handler the same way**

In `POST /:tripId/fallback`, replace:

```ts
      // Update trip status
      const newStatus = eventType === 'pickup' ? 'picked_up' : 'completed';
      await query(
        `UPDATE trips SET status = $1, ${eventType === 'pickup' ? 'actual_pickup_at' : 'actual_dropoff_at'} = NOW(),
         updated_at = NOW() WHERE id = $2 AND org_id = $3`,
        [newStatus, tripId, req.user!.orgId]
      );
```

with:

```ts
      // Pickup advances; dropoff stays arrived_dropoff (completion happens after signature).
      let newStatus: string;
      if (eventType === 'pickup') {
        newStatus = 'picked_up';
        await query(
          `UPDATE trips SET status = $1, actual_pickup_at = NOW(), updated_at = NOW()
           WHERE id = $2 AND org_id = $3`,
          [newStatus, tripId, req.user!.orgId]
        );
      } else {
        newStatus = 'arrived_dropoff';
        await query(
          `UPDATE trips SET updated_at = NOW() WHERE id = $1 AND org_id = $2`,
          [tripId, req.user!.orgId]
        );
      }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/api && npx vitest run tests/routes/otpDropoff.test.ts`
Expected: PASS.

- [ ] **Step 6: Run full API suite**

Run: `cd apps/api && npx vitest run`
Expected: PASS (no regressions).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes/otp.ts apps/api/tests/routes/otpDropoff.test.ts
git commit -m "feat(api): dropoff OTP no longer auto-completes (signature-gated)"
```

---

## Phase 2 — Mobile

> No RN test harness exists in this repo. Phase 2 tasks are verified by `tsc` type-checks and the manual E2E checklist in Task 11 (run via `cd apps/mobile && npx expo start`). Do not add a mobile test framework in this iteration.

### Task 6: Add mobile dependencies + reason codes

**Files:**
- Modify: `apps/mobile/package.json`
- Create: `apps/mobile/src/lib/reasonCodes.ts`

- [ ] **Step 1: Install deps**

Run: `cd apps/mobile && npx expo install react-native-signature-canvas react-native-webview expo-file-system`
Expected: three packages added to `package.json` dependencies at Expo-compatible versions.

- [ ] **Step 2: Create the mobile reason-codes mirror**

```ts
// Mirror of apps/api/src/lib/reasonCodes.ts — keep in sync.
export const NO_SHOW_REASONS: { code: string; label: string }[] = [
  { code: 'rider_not_present', label: 'Rider not present' },
  { code: 'rider_refused', label: 'Rider refused ride' },
  { code: 'wrong_address', label: 'Wrong / bad address' },
  { code: 'rider_cancelled_on_arrival', label: 'Rider cancelled on arrival' },
];

export const CANCELLATION_REASONS: { code: string; label: string }[] = [
  { code: 'dispatch_cancelled', label: 'Cancelled by dispatch' },
  { code: 'duplicate', label: 'Duplicate trip' },
  { code: 'rider_unreachable', label: 'Rider unreachable' },
  { code: 'other', label: 'Other' },
];
```

- [ ] **Step 3: Type-check**

Run: `cd apps/mobile && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/package.json apps/mobile/src/lib/reasonCodes.ts
git commit -m "feat(mobile): add signature/webview/file-system deps + reason codes"
```

---

### Task 7: Navigation deep-link helper + Navigate buttons

**Files:**
- Create: `apps/mobile/src/lib/navigation.ts`
- Modify: `apps/mobile/src/screens/ActiveTrip.tsx`

- [ ] **Step 1: Create the helper**

```ts
// apps/mobile/src/lib/navigation.ts
import { Linking, Platform } from 'react-native';

interface Destination {
  lat?: number | null;
  lng?: number | null;
  address?: string | null;
}

export async function openNavigation(dest: Destination): Promise<void> {
  const hasCoords = dest.lat != null && dest.lng != null;
  if (!hasCoords && !dest.address) return;

  const q = hasCoords
    ? `${dest.lat},${dest.lng}`
    : encodeURIComponent(dest.address ?? '');

  const candidates =
    Platform.OS === 'ios'
      ? [`comgooglemaps://?daddr=${q}&directionsmode=driving`, `http://maps.apple.com/?daddr=${q}`]
      : [`google.navigation:q=${q}`, `geo:0,0?q=${q}`];

  const webFallback = `https://www.google.com/maps/dir/?api=1&destination=${q}`;

  for (const url of candidates) {
    try {
      if (await Linking.canOpenURL(url)) {
        await Linking.openURL(url);
        return;
      }
    } catch {
      // try next candidate
    }
  }
  await Linking.openURL(webFallback);
}
```

- [ ] **Step 2: Wire Navigate buttons in `ActiveTrip.tsx`**

Add import:

```ts
import { openNavigation } from '../lib/navigation';
```

Extend the `TripDetail` interface with the coordinate fields the API already returns (add these lines):

```ts
  pickup_lat: number | null;
  pickup_lng: number | null;
  dropoff_lat: number | null;
  dropoff_lng: number | null;
```

Add a small button beside each address in the render (pickup and dropoff). Example for pickup — place next to the pickup address text:

```tsx
<TouchableOpacity
  style={styles.navBtn}
  onPress={() => openNavigation({
    lat: trip.pickup_lat, lng: trip.pickup_lng, address: trip.pickup_address,
  })}
>
  <Text style={styles.navBtnText}>🧭 Navigate</Text>
</TouchableOpacity>
```

And for dropoff:

```tsx
<TouchableOpacity
  style={styles.navBtn}
  onPress={() => openNavigation({
    lat: trip.dropoff_lat, lng: trip.dropoff_lng, address: trip.dropoff_address,
  })}
>
  <Text style={styles.navBtnText}>🧭 Navigate</Text>
</TouchableOpacity>
```

Add styles to the `StyleSheet.create({...})` block:

```ts
  navBtn: {
    marginTop: 8,
    alignSelf: 'flex-start',
    backgroundColor: '#eff6ff',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  navBtnText: { color: '#2563eb', fontWeight: '600', fontSize: 14 },
```

- [ ] **Step 3: Type-check**

Run: `cd apps/mobile && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/lib/navigation.ts apps/mobile/src/screens/ActiveTrip.tsx
git commit -m "feat(mobile): navigation deep-link buttons on active trip"
```

---

### Task 8: SignatureCapture screen

**Files:**
- Create: `apps/mobile/src/screens/SignatureCapture.tsx`
- Modify: `apps/mobile/App.tsx`

- [ ] **Step 1: Create the screen**

```tsx
import React, { useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import SignatureScreen, { SignatureViewRef } from 'react-native-signature-canvas';
import * as FileSystem from 'expo-file-system';
import * as Location from 'expo-location';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';

export function SignatureCapture({ route, navigation }: { route: any; navigation: any }) {
  const { tripId } = route.params as { tripId: number };
  const ref = useRef<SignatureViewRef>(null);
  const queryClient = useQueryClient();
  const [submitting, setSubmitting] = useState(false);

  const submit = useMutation({
    mutationFn: async (signatureDataUrl: string) => {
      // signatureDataUrl looks like "data:image/png;base64,...."
      const base64 = signatureDataUrl.replace(/^data:image\/\w+;base64,/, '');
      const fileUri = `${FileSystem.cacheDirectory}signature-${tripId}.png`;
      await FileSystem.writeAsStringAsync(fileUri, base64, {
        encoding: FileSystem.EncodingType.Base64,
      });

      let lat: number | undefined;
      let lng: number | undefined;
      try {
        const loc = await Location.getLastKnownPositionAsync();
        if (loc) { lat = loc.coords.latitude; lng = loc.coords.longitude; }
      } catch { /* location optional */ }

      await api.post(`/api/trips/${tripId}/signature`, {
        imageBase64: signatureDataUrl, lat, lng,
      });
      await api.patch(`/api/trips/${tripId}/status`, { status: 'completed' });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trip', tripId] });
      queryClient.invalidateQueries({ queryKey: ['my-trips'] });
      navigation.navigate('Main');
    },
    onError: () => {
      setSubmitting(false);
      Alert.alert('Save failed', 'Could not save the signature. Please try again.');
    },
  });

  const handleConfirm = () => {
    setSubmitting(true);
    ref.current?.readSignature(); // fires onOK with the base64 data URL
  };

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Rider / attendant signature</Text>
      <Text style={styles.subtitle}>Required to complete the trip</Text>

      <View style={styles.pad}>
        <SignatureScreen
          ref={ref}
          onOK={(sig) => submit.mutate(sig)}
          onEmpty={() => {
            setSubmitting(false);
            Alert.alert('No signature', 'Please capture a signature before confirming.');
          }}
          webStyle={`.m-signature-pad--footer { display: none; }`}
          autoClear={false}
        />
      </View>

      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.btn, styles.clearBtn]}
          onPress={() => ref.current?.clearSignature()}
          disabled={submitting}
        >
          <Text style={styles.clearText}>Clear</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.btn, styles.confirmBtn, submitting && { opacity: 0.6 }]}
          onPress={handleConfirm}
          disabled={submitting}
        >
          {submitting
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.confirmText}>Confirm & Complete</Text>}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', padding: 16 },
  title: { fontSize: 18, fontWeight: '700', color: '#111827' },
  subtitle: { fontSize: 13, color: '#6b7280', marginBottom: 12 },
  pad: { flex: 1, borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 12, overflow: 'hidden' },
  actions: { flexDirection: 'row', gap: 12, marginTop: 16 },
  btn: { flex: 1, borderRadius: 10, paddingVertical: 14, alignItems: 'center' },
  clearBtn: { backgroundColor: '#f3f4f6' },
  clearText: { color: '#374151', fontWeight: '600', fontSize: 15 },
  confirmBtn: { backgroundColor: '#10b981' },
  confirmText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
```

> On a 409 from the PATCH (missing signature) the `onError` alert fires and the driver can retry; the signature POST runs first, so a correctly-signed flow always satisfies the gate.

- [ ] **Step 2: Register the screen in `App.tsx`**

Add to `RootStackParamList`:

```ts
  SignatureCapture: { tripId: number };
```

Add the import:

```ts
import { SignatureCapture } from './src/screens/SignatureCapture';
```

Add inside the authenticated `<>...</>` block, alongside the other `Stack.Screen`s:

```tsx
<Stack.Screen
  name="SignatureCapture"
  component={SignatureCapture}
  options={{ presentation: 'modal' }}
/>
```

- [ ] **Step 3: Type-check**

Run: `cd apps/mobile && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/screens/SignatureCapture.tsx apps/mobile/App.tsx
git commit -m "feat(mobile): signature capture screen + route"
```

---

### Task 9: Chain dropoff OTP into signature capture

**Files:**
- Modify: `apps/mobile/src/screens/OTPEntry.tsx`

- [ ] **Step 1: Route to SignatureCapture after dropoff OTP success**

In `OTPEntry.tsx`, find the OTP verify success handler (the `useMutation` posting to `/api/otp/${tripId}/verify`) and its `onSuccess`. Change navigation so that a **dropoff** verification goes to `SignatureCapture` while **pickup** keeps the existing back-navigation.

Locate the verify mutation success (around line 53–60) and set its `onSuccess` to:

```ts
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trip', tripId] });
      queryClient.invalidateQueries({ queryKey: ['my-trips'] });
      if (eventType === 'dropoff') {
        navigation.replace('SignatureCapture', { tripId });
      } else {
        navigation.goBack();
      }
    },
```

- [ ] **Step 2: Route the photo-fallback success the same way**

In the `submitFallback` mutation `onSuccess`, replace the `Alert(... goBack())` with:

```ts
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trip', tripId] });
      queryClient.invalidateQueries({ queryKey: ['my-trips'] });
      if (eventType === 'dropoff') {
        navigation.replace('SignatureCapture', { tripId });
      } else {
        Alert.alert('📷 Photo Submitted', 'Fallback photo recorded.', [
          { text: 'OK', onPress: () => navigation.goBack() },
        ]);
      }
    },
```

> `navigation.replace` requires the stack navigator's `replace` method — available on `@react-navigation/stack`. If TypeScript complains about `replace` on the `any`-typed `navigation` prop, it will still work at runtime; the prop is already typed `any`.

- [ ] **Step 3: Type-check**

Run: `cd apps/mobile && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/screens/OTPEntry.tsx
git commit -m "feat(mobile): dropoff OTP chains into signature capture"
```

---

### Task 10: TripException screen (no-show / cancellation)

**Files:**
- Create: `apps/mobile/src/screens/TripException.tsx`
- Modify: `apps/mobile/App.tsx`
- Modify: `apps/mobile/src/screens/ActiveTrip.tsx`

- [ ] **Step 1: Create the screen**

```tsx
import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, TextInput, Alert, ActivityIndicator, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { NO_SHOW_REASONS, CANCELLATION_REASONS } from '../lib/reasonCodes';

export function TripException({ route, navigation }: { route: any; navigation: any }) {
  const { tripId, mode } = route.params as { tripId: number; mode: 'no_show' | 'cancellation' };
  const queryClient = useQueryClient();
  const reasons = mode === 'no_show' ? NO_SHOW_REASONS : CANCELLATION_REASONS;
  const [reasonCode, setReasonCode] = useState<string | null>(null);
  const [note, setNote] = useState('');

  const submit = useMutation({
    mutationFn: async () => {
      const endpoint = mode === 'no_show' ? 'no-show' : 'cancellation';
      await api.post(`/api/trips/${tripId}/${endpoint}`, {
        reasonCode, note: note.trim() || undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trip', tripId] });
      queryClient.invalidateQueries({ queryKey: ['my-trips'] });
      navigation.navigate('Main');
    },
    onError: () => Alert.alert('Failed', 'Could not submit. Please try again.'),
  });

  const title = mode === 'no_show' ? 'Report No-Show' : 'Cancel Trip';

  const confirm = () => {
    if (!reasonCode) { Alert.alert('Select a reason', 'Please choose a reason.'); return; }
    Alert.alert(title, 'Are you sure? This cannot be undone.', [
      { text: 'Back', style: 'cancel' },
      { text: 'Confirm', style: 'destructive', onPress: () => submit.mutate() },
    ]);
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={{ padding: 16 }}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.label}>Reason</Text>
        {reasons.map((r) => (
          <TouchableOpacity
            key={r.code}
            style={[styles.reason, reasonCode === r.code && styles.reasonSelected]}
            onPress={() => setReasonCode(r.code)}
          >
            <Text style={[styles.reasonText, reasonCode === r.code && styles.reasonTextSelected]}>
              {r.label}
            </Text>
          </TouchableOpacity>
        ))}

        <Text style={styles.label}>Note (optional)</Text>
        <TextInput
          style={styles.input}
          value={note}
          onChangeText={setNote}
          placeholder="Add any details…"
          multiline
          maxLength={1000}
        />

        <TouchableOpacity
          style={[styles.submitBtn, submit.isPending && { opacity: 0.6 }]}
          onPress={confirm}
          disabled={submit.isPending}
        >
          {submit.isPending
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.submitText}>{title}</Text>}
        </TouchableOpacity>

        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  title: { fontSize: 20, fontWeight: '700', color: '#111827', marginBottom: 16 },
  label: { fontSize: 14, fontWeight: '600', color: '#374151', marginTop: 16, marginBottom: 8 },
  reason: {
    borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 10,
    paddingVertical: 14, paddingHorizontal: 14, marginBottom: 8,
  },
  reasonSelected: { borderColor: '#2563eb', backgroundColor: '#eff6ff' },
  reasonText: { fontSize: 15, color: '#374151' },
  reasonTextSelected: { color: '#2563eb', fontWeight: '600' },
  input: {
    borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 10, padding: 12,
    minHeight: 80, textAlignVertical: 'top', fontSize: 15,
  },
  submitBtn: {
    backgroundColor: '#dc2626', borderRadius: 10, paddingVertical: 16,
    alignItems: 'center', marginTop: 24,
  },
  submitText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  backBtn: { alignItems: 'center', paddingVertical: 16 },
  backText: { color: '#6b7280', fontSize: 15 },
});
```

- [ ] **Step 2: Register in `App.tsx`**

Add to `RootStackParamList`:

```ts
  TripException: { tripId: number; mode: 'no_show' | 'cancellation' };
```

Add import:

```ts
import { TripException } from './src/screens/TripException';
```

Add inside the authenticated block:

```tsx
<Stack.Screen
  name="TripException"
  component={TripException}
  options={{ presentation: 'modal' }}
/>
```

- [ ] **Step 3: Add the No-show / Cancel entry point in `ActiveTrip.tsx`**

Add a button in the render (below the primary status action, hidden when the trip is already done). Use the existing `isDone` boolean:

```tsx
{!isDone && (
  <View style={styles.exceptionRow}>
    <TouchableOpacity
      style={styles.exceptionBtn}
      onPress={() => navigation.navigate('TripException', { tripId, mode: 'no_show' })}
    >
      <Text style={styles.exceptionText}>Report No-Show</Text>
    </TouchableOpacity>
    <TouchableOpacity
      style={styles.exceptionBtn}
      onPress={() => navigation.navigate('TripException', { tripId, mode: 'cancellation' })}
    >
      <Text style={styles.exceptionText}>Cancel Trip</Text>
    </TouchableOpacity>
  </View>
)}
```

Add styles:

```ts
  exceptionRow: { flexDirection: 'row', gap: 12, marginTop: 16, paddingHorizontal: 16 },
  exceptionBtn: {
    flex: 1, borderWidth: 1, borderColor: '#fca5a5', borderRadius: 10,
    paddingVertical: 12, alignItems: 'center',
  },
  exceptionText: { color: '#dc2626', fontWeight: '600', fontSize: 14 },
```

- [ ] **Step 4: Type-check**

Run: `cd apps/mobile && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/screens/TripException.tsx apps/mobile/App.tsx apps/mobile/src/screens/ActiveTrip.tsx
git commit -m "feat(mobile): no-show / cancellation exception flow"
```

---

### Task 11: Manual E2E verification

**Files:** none (verification only)

- [ ] **Step 1: Start the stack**

Run (API + DB): `docker compose up -d` (or the project's usual dev startup), then apply the migration: `cd apps/api && FORCE_MIGRATE=true npm run db:migrate`.
Then: `cd apps/mobile && npx expo start` and open on a device/simulator.

- [ ] **Step 2: Happy path**

Log in as a driver, open an assigned trip → tap **Navigate** on pickup (native maps opens) → advance to arrived_pickup → OTP pickup (status → picked_up) → advance to arrived_dropoff → OTP dropoff → **SignatureCapture** appears → sign → **Confirm & Complete** → trip leaves the active list. Confirm on the web dispatcher that status is `completed`.
Expected: all steps succeed; trip completes only after signing.

- [ ] **Step 3: Signature gate**

Using an API client, `PATCH /api/trips/:id/status {status:'completed'}` for a trip with no signature event.
Expected: **409** with "A signature is required before completing this trip".

- [ ] **Step 4: No-show**

On an active trip, tap **Report No-Show** → pick a reason → Confirm.
Expected: trip status `no_show` on the web dispatcher; a `no_show` row in `trip_events`.

- [ ] **Step 5: Cancellation**

Tap **Cancel Trip** → pick a reason + note → Confirm.
Expected: status `cancelled`; a `cancellation` row in `trip_events`.

- [ ] **Step 6: Navigation fallback**

On a device without the Google Maps app (or simulator), tap Navigate.
Expected: opens Apple Maps (iOS) or the browser Google Maps URL — never a crash/dead button.

- [ ] **Step 7: Commit any doc/notes updates (if needed)**

```bash
git add -A
git commit -m "docs: record manual E2E verification results" || echo "nothing to commit"
```

---

## Self-Review Notes

- **Spec coverage:** navigation (Task 7), signature + gate (Tasks 3, 8, 9), no-show/cancellation (Tasks 4, 10), `trip_events` table (Task 1), reason codes (Tasks 2, 6), completion centralization (Task 5). All spec sections mapped.
- **Deviation from spec (documented):** no-show/cancellation use two sequential writes (insert event, then update status) rather than an explicit DB transaction — matching the existing `otp.ts` fallback precedent and the mocked-pool test setup. If strict atomicity is later required, wrap in `db.connect()` + `BEGIN/COMMIT`.
- **Signature transport:** base64 JSON body (not multipart) — small payload, avoids RN `FormData` file-uri pitfalls; server decodes with `fs`. Consistent within this feature.
- **Type consistency:** `openNavigation(Destination)`, `NO_SHOW_REASONS`/`CANCELLATION_REASONS` (mobile, `{code,label}`) vs `NO_SHOW_REASON_CODES`/`CANCELLATION_REASON_CODES` (API, string tuples) are intentionally different shapes for their consumers and used consistently within each app.
