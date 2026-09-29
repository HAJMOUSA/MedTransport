# Rideshare Overflow Dispatch — Design

**Date:** 2026-09-29
**Status:** Approved (pending spec review)
**Author:** Ayman Hajmousa (with Claude)

## Problem

When a patient is waiting and no MidTransport vehicle is available, the provider
wants to fulfill the trip with a third-party rideshare (Uber/Lyft) instead of
leaving the patient stranded. Because the rideshare driver is not a MidTransport
employee and does not use the driver app, the proof-of-service flow (pickup
verification + signature) must move from the driver app to the **rider**, via a
link sent over SMS.

The patient sees a **MidTransport-branded** experience (standard white-labeling,
as Uber Health / Lyft Healthcare do). The system records the true fulfillment
provider internally for billing and audit accuracy.

## Scope

### In scope (v1)
- Dispatcher manually orders the Uber/Lyft ride in the real rideshare app, then
  records the assignment (provider, driver, vehicle, plate) in MidTransport.
- MidTransport sends the rider ONE persistent, tokenized SMS link.
- A public (unauthenticated) rider web page that self-advances through two steps:
  pickup confirmation, then a dropoff signature.
- Rideshare is **hard-blocked** for any trip whose `mobility_type` is not
  `standard` (ambulatory only).
- Internal record of the true provider + driver/vehicle for billing/audit.

### Out of scope (YAGNI for v1 — clean seams left for later)
- Real Uber Health / Lyft Healthcare API booking.
- Live GPS map of the rideshare car on the rider page (we do not have the Uber
  driver's location).
- Automated ETA / status webhooks.
- In-app rideshare ordering by the dispatcher.

## Key decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| How the ride is ordered | Manual dispatch + record | No Uber Health business account or large API integration needed; shippable now for a 1–20 vehicle provider. |
| Rider confirmation flow | One persistent link, two self-advancing steps | Simplest for the rider; no second SMS and no status-trigger plumbing (we have no Uber webhooks). |
| Non-standard mobility | Hard block (UI + server) | Safety/liability: cannot send an ambulatory-only UberX to a wheelchair/stretcher/bariatric patient. |
| Patient-facing branding | MidTransport white-label | Normal practice; MidTransport is the responsible party. True provider recorded internally. |
| Live tracking | None (text status only) | We do not have the rideshare driver's GPS. |

## Architecture

### Data model changes

**`trips`** — add fulfillment fields (all null/default for normal internal trips):
- `fulfillment_type` — `'internal' | 'rideshare'`, default `'internal'`
- `rideshare_provider` — `'uber' | 'lyft'`, nullable
- `rideshare_driver_name` — text, nullable
- `rideshare_vehicle_desc` — text, nullable (e.g. "Silver Toyota Camry")
- `rideshare_plate` — text, nullable
- `rideshare_cost_cents` — integer, nullable (billing reconciliation)

**`trip_access_tokens`** — new table (the rider link):
- `id` — PK
- `org_id` — FK organizations
- `trip_id` — FK trips
- `token_hash` — SHA-256 of a random 32-byte URL-safe token (raw token never stored)
- `expires_at` — timestamptz (~12h after scheduled pickup)
- `pickup_confirmed_at` — timestamptz, nullable
- `created_at` — timestamptz default now()

**`trip_events`** — extend the existing table:
- Add `source` column — `'driver' | 'rider'`, default `'driver'`
- Add new value `rider_pickup_confirm` to the `trip_event_type` enum
- The rider's dropoff signature is stored as the existing `'signature'` event with
  `source='rider'`. This **automatically satisfies the existing completion gate**
  at `apps/api/src/routes/trips.ts:375` (which checks for a `signature` event) —
  no special-casing needed.

### Status flow (reuses existing `trip_status` values — no board changes)

1. Dispatcher sends rideshare → status `dispatched`, SMS goes out.
2. Rider taps "I'm in the vehicle" → insert `rider_pickup_confirm` event, set
   `actual_pickup_at`, status → `picked_up`.
3. Rider signs on arrival → insert `signature` event (`source='rider'`), set
   `actual_dropoff_at`, status → `completed`.

### Backend — new public (unauthenticated) router

Mounted at `/api/ride`, separate from the JWT-protected `/api/*` routers, and
rate-limited (same posture as `/api/auth`). Endpoints resolve the trip by hashing
the supplied token and matching `token_hash`.

- `GET /api/ride/:token` — minimal public trip view: rider first name,
  driver/vehicle/plate, pickup + dropoff addresses, current step. No extra PII.
- `POST /api/ride/:token/pickup` — idempotent pickup confirmation.
- `POST /api/ride/:token/signature` — accepts a base64 signature (reuses the
  existing signature file-writing logic from `trips.ts`), then completes the trip.

### Backend — new authenticated dispatch endpoint

- `POST /api/trips/:id/rideshare-dispatch` — role `admin`/`dispatcher`.
  Body: `provider`, `driverName`, `vehicleDesc`, `plate`, optional `costCents`, `etaNote`.
  - **Server-side hard block:** reject (409/400) if `mobility_type != 'standard'`
    or a driver is already assigned.
  - Sets fulfillment fields, generates the token row, sends the SMS, sets status
    `dispatched`.
  - **Resend:** re-sends the SMS reusing the same (non-expired) token.

### Dispatcher UI (web dashboard)

- A **"Send Rideshare"** action on the trip card / trip detail, **enabled only
  when** `mobility_type === 'standard'` and no driver is assigned (mirrors the
  server gate — defense in depth).
- Modal fields: Provider (Uber/Lyft), Driver name, Vehicle description, Plate,
  optional ETA note and cost → `POST /api/trips/:id/rideshare-dispatch`.
- After dispatch, the trip card shows a dispatcher-only **"Rideshare · Uber/Lyft"**
  badge (internal truth) and a **"Resend link"** button.

### SMS copy (MidTransport-branded)

> Your MidTransport ride is on the way — Silver Toyota Camry, plate ABC-123,
> driver John. Confirm & sign here: https://midtransport.hajmousa.com/r/<token>

### Rider web page

Served by the web app at public route `/r/:token` (no login), fetching
`GET /api/ride/:token`. Self-advancing:

- **Step 1 (dispatched):** "Your MidTransport ride" header, driver/vehicle/plate,
  pickup → dropoff, large **"I'm in the vehicle"** button. Text status only, no map.
- **Step 2 (picked_up):** "On the way to [dropoff]" + signature pad
  ("Please sign when you arrive") → Submit.
- **Step 3 (completed):** "Thank you for riding with MidTransport ✅".

## Error handling

- Invalid / expired / consumed token → friendly "This link is no longer active —
  please contact MidTransport" page, no data leak.
- Double-tap pickup or double signature → idempotent no-op if already past that step.
- SMS send failure → dispatcher sees an error and can retry; the dispatch is still
  recorded so the link works if copied manually.
- Completion remains gated on a signature existing (unchanged) — satisfied by the
  rider's signature.
- Rideshare-dispatch rejected server-side for non-standard mobility or an already
  assigned driver.

## Security & audit

- Tokens are random 32-byte URL-safe strings, **stored only as SHA-256 hashes**,
  single-trip scoped, and time-boxed (~12h).
- Public `/api/ride` router is rate-limited.
- `audit_log` entries recorded for rideshare-dispatch, pickup confirm, and
  signature — preserving the true fulfillment provider for billing/compliance
  even though the rider sees MidTransport branding.

## Testing

- **Unit:** token generate/hash/verify + expiry; mobility-gate rejection; state
  transitions (`dispatched → picked_up → completed`); signature gate satisfied by
  a rider-sourced signature.
- **Integration:** full happy path (dispatch → GET public view → pickup →
  signature → completed) and failure paths (expired token, wheelchair trip
  blocked, SMS failure).

## Compliance note

Recording the true fulfillment provider (Uber/Lyft) alongside the trip keeps the
billing and audit trail accurate for Medicaid/broker reporting, even though the
patient-facing experience is MidTransport-branded. The mobility hard-block avoids
dispatching an unsuitable vehicle to a patient who requires accessible transport.
