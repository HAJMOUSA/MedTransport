# Driver App — MediRoutes Parity Enhancements (Design)

**Date:** 2026-09-27
**Status:** Approved (design)
**Scope:** Enhance the existing `apps/mobile` Expo/React Native driver app with three MediRoutes-style capabilities. No rebuild. Offline support explicitly out of scope for this iteration.

## Goal

Bring the MidTransport driver app closer to MediRoutes' "DriveConnect" driver experience by adding:

1. **Turn-by-turn navigation** — deep-link from the active trip to the phone's native maps app.
2. **Signature + proof capture** — rider/attendant signature captured on the driver's phone at dropoff, **required to complete a trip**.
3. **No-show & cancellation flow** — driver-initiated, with reason codes, optional note, and optional photo evidence.

## Non-goals

- Offline manifest / queued sync (deferred).
- In-app turn-by-turn routing (we deep-link to native maps instead of building/hosting routing).
- Signature at pickup (dropoff only, per decision).
- Rider/member-facing app (separate future effort).

## Existing context (what we build on)

- `apps/mobile` — Expo 51 + React Native 0.74, stack navigation (`Main` → `ActiveTrip` → `OTPEntry` modal), React Query + axios (`src/lib/api.ts`), Socket.io client, Zustand auth. `expo-camera`, `expo-location`, `expo-secure-store` already installed.
- `ActiveTrip.tsx` drives status via a `NEXT_STATUS` map; GPS tracked every 10s.
- `OTPEntry.tsx` handles pickup/dropoff OTP with an `expo-camera` photo fallback.
- Backend `apps/api`: `PATCH /api/trips/:id/status` already accepts all statuses incl. `cancelled` and `no_show`; `trip_status` enum already includes both. `otp.ts` demonstrates the multer photo-upload pattern (`/app/uploads/...`, 5MB, image-only) and Socket.io `trip:status-changed` broadcasts to `org:{id}:dispatchers`.
- Trips already carry `pickup_lat/lng`, `dropoff_lat/lng`, and addresses.

## Architecture decision: data storage

**Chosen: Option A — new append-only `trip_events` table.** One row per driver action. Reuses the existing multer upload pattern. Extensible (mileage, breaks later) and provides an audit trail that supports the platform's Medicaid-billing/compliance positioning. Keeps the `trips` table clean.

Rejected: (B) columns on `trips` — not append-only, single-event only; (C) overloading `otp_events` — muddies OTP semantics.

## Backend design (`apps/api`)

### Schema (append to `src/db/schema.sql`)

```sql
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

### Endpoints (`src/routes/trips.ts`)

- `POST /api/trips/:id/signature` — multipart (`signature` PNG file) + optional `lat`/`lng`. Inserts a `signature` event. Org-scoped.
- `POST /api/trips/:id/no-show` — body `{ reason_code, note?, ... }`, optional photo. In **one transaction**: insert `no_show` event + set trip status `no_show`. Broadcast `trip:status-changed`.
- `POST /api/trips/:id/cancellation` — body `{ reason_code, note? }`. In one transaction: insert `cancellation` event + set status `cancelled`. Broadcast.

### Signature gate (server-authoritative) + centralizing completion

`PATCH /api/trips/:id/status` is modified: a transition to `completed` is rejected with **409** and a clear message unless a `signature` `trip_event` exists for that trip. The rule lives on the server, not just the UI.

**Important reconciliation:** today the dropoff OTP paths — `POST /api/otp/:id/verify` (eventType `dropoff`) and `POST /api/otp/:id/fallback` (dropoff) — set trip status directly to `completed` via a raw `UPDATE`, bypassing `PATCH /:id/status`. A gate on the status endpoint alone would be silently bypassed. Therefore completion is centralized: **dropoff** OTP verify/fallback no longer auto-complete — they record verification and leave status at `arrived_dropoff`. The only path to `completed` becomes `PATCH /:id/status`, where the gate is enforced. **Pickup** OTP verify/fallback are unchanged (still advance to `picked_up`).

The gate applies to all roles (driver, dispatcher, admin). A dispatcher/admin manual-complete override is explicitly out of scope for this iteration.

### Reason codes (shared constant)

- No-show: `rider_not_present`, `rider_refused`, `wrong_address`, `rider_cancelled_on_arrival`
- Cancellation: `dispatch_cancelled`, `duplicate`, `rider_unreachable`, `other`

Defined once and shared/duplicated so web dispatcher and mobile present identical lists.

## Mobile design (`apps/mobile`)

### Navigation stack (`App.tsx`)

Add to `RootStackParamList` and register as modal screens:
- `SignatureCapture: { tripId: number }`
- `TripException: { tripId: number; mode: 'no_show' | 'cancellation' }`

### Screens

**`ActiveTrip.tsx` (modify)**
- "Navigate" button per address. Deep-link helper `openNavigation()` in `src/lib/`:
  - iOS: `comgooglemaps://?daddr=…` → fallback `http://maps.apple.com/?daddr=…`
  - Android: `google.navigation:q=lat,lng` → fallback `geo:`/`https://www.google.com/maps/dir/?api=1&destination=…`
  - Prefer coordinates; else URL-encoded address. Use `Linking.canOpenURL`; final fallback is the always-openable `https://` Google Maps URL.
- "No-show / Cancel" action → routes to `TripException`.
- Dropoff completion flow: at `arrived_dropoff`, the button still routes to `OTPEntry` (dropoff). On successful dropoff OTP verify/fallback, `OTPEntry` now navigates (replace) to `SignatureCapture` instead of going back — since dropoff OTP no longer completes the trip. `SignatureCapture` performs the actual completion.

**`SignatureCapture.tsx` (new)**
- Full-screen signing pad via `react-native-signature-canvas` (WebView-backed, Expo-compatible). "Clear" + "Confirm".
- On confirm: export PNG (base64 data URL) → write to a temp file with `expo-file-system` → upload via `POST /:id/signature` as multipart (matching the existing OTP photo-upload pattern) → on 2xx, `PATCH /:id/status` to `completed` (gate now passes) → navigate to `Main`.
- Shows rider name + "Rider/attendant signature" caption.

**`TripException.tsx` (new)**
- Reason-code radio list (from shared constant, filtered by `mode`), optional note, optional photo (reuse `expo-camera` capture from `OTPEntry`).
- Confirm calls `/no-show` or `/cancellation`. Destructive-action `Alert` first; confirm button disabled while in flight.

### Data / state
- Existing React Query + `api` axios client. On success invalidate `['trips']` and `['trip', tripId]`.
- Socket.io already propagates status to dispatchers — no new socket code.

### Dependencies / permissions
- Add `react-native-signature-canvas` (+ `react-native-webview` peer, Expo-managed) and `expo-file-system`.
- No new native permissions (signature pad is JS/WebView; navigation is a URL open; camera already declared).

## Error handling

- **Signature gate race:** server 409 → app catches and re-routes to `SignatureCapture` instead of raw error.
- **Upload failures:** retain captured image in state, show "Retry upload"; never advance status until upload returns 2xx. No silent success.
- **Deep-link:** if `canOpenURL` is false, fall back to `https://` Google Maps URL (opens in browser).
- **Missing coordinates:** navigation and event lat/lng degrade to address-only / null.
- **Destructive actions:** confirmation `Alert`; disable confirm during request to prevent double-submit.

## Testing

- **Backend (automated, existing `apps/api` test setup):**
  - Signature gate blocks `completed` (409) with no signature; allows it once a `signature` event exists.
  - No-show and cancellation each set status + insert event atomically (transaction).
  - Org scoping enforced on all new endpoints.
- **Mobile:** no RN test harness exists today; verify flows manually via Expo using the checklist below (do not stand up a mobile test framework this iteration).
- **Manual E2E checklist:**
  1. Happy path: dispatched → Navigate opens maps → OTP → SignatureCapture → complete; trip leaves the active list; dispatcher web sees status change.
  2. No-show: reason + optional photo → status `no_show` on web.
  3. Cancellation: reason + note → status `cancelled` on web.
  4. Signature gate: attempt to complete without signature → blocked/re-routed.
  5. Navigation fallback: device without Google Maps app opens browser maps.

## Build sequence (high level)

1. Backend: schema migration → new endpoints → signature gate on status → tests.
2. Shared reason-code constant.
3. Mobile: `openNavigation()` helper + ActiveTrip navigate buttons.
4. Mobile: `SignatureCapture` screen + gated completion flow.
5. Mobile: `TripException` screen (no-show/cancellation).
6. Manual E2E pass against the checklist.
