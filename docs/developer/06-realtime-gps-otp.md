# 06 — Realtime, GPS & OTP

Live tracking and OTP verification are driven by Socket.io. Source: `apps/api/src/sockets/locationHandler.ts`, `services/geofence.ts`, `services/otp.ts`, `services/sms.ts`. Client access on web via `apps/web/src/hooks/useSocket.ts`; on mobile via `apps/mobile/src/hooks/useSocket.ts`.

## Connection & authentication

- Clients connect with the JWT in the handshake: `io(url, { auth: { token } })`.
- `io.use(...)` verifies the token with `JWT_SECRET` and attaches `socket.user = { userId, orgId, role }`. Invalid/missing token → connection rejected.
- Transports: `['websocket', 'polling']`. In production, nginx proxies `/socket.io/` with upgrade headers and Caddy passes WebSockets through automatically.

## Rooms

On connect the server joins rooms by role:

| Role | Rooms joined |
|---|---|
| driver | `org:{orgId}`, `driver:{userId}` |
| dispatcher / admin | `org:{orgId}:dispatchers` |

Dispatcher broadcasts target `org:{orgId}:dispatchers`; driver-specific messages target the driver's own socket.

## Events

### Client → server (emitted by the driver app)

| Event | Payload | Effect |
|---|---|---|
| `driver:start-shift` | `{ driverId }` | Sets `drivers.on_shift=true`, adds to Redis `activeDrivers` set, notifies dispatchers `driver:shift-started`. |
| `driver:location-update` | `{ driverId, lat, lng, speedMph?, headingDeg?, accuracyM? }` | Core update loop (below). |
| `driver:end-shift` | `{ driverId }` | Sets `on_shift=false`, clears Redis position, notifies `driver:shift-ended`. |

### Server → client

| Event | Target | Payload |
|---|---|---|
| `driver:shift-started` | dispatchers | `{ driverId, userId, timestamp }` |
| `driver:position` | dispatchers | `{ driverId, lat, lng, speedMph, headingDeg, accuracyM, timestamp }` |
| `driver:shift-ended` | dispatchers | `{ driverId, timestamp }` |
| `driver:disconnected` | dispatchers | `{ driverId, timestamp }` (on socket disconnect) |
| `trip:otp-sent` | the driver | `{ tripId, eventType, expiresAt }` (prompts the OTP screen) |
| `trip:status-changed` | dispatchers | `{ tripId, status, driverId, timestamp }` |

## `driver:location-update` pipeline

For each update (coordinates validated to sane ranges):

1. **Redis geo** — `GEOADD org:{orgId}:driver_positions lng lat driverId` for instant dispatcher lookup.
2. **Redis hash** — `HSET driver:{driverId}:location` with lat/lng/speed/heading/accuracy/updatedAt (last-known snapshot).
3. **DB throttle** — a breadcrumb is written to `driver_locations` at most every `GPS_UPDATE_INTERVAL_S` seconds (default 10), gated by a Redis `last_db_write` key. This keeps route replay data without hammering Postgres.
4. **Broadcast** — emit `driver:position` to dispatchers (drives the live map).
5. **Geofence check** — see below.

## Geofencing & automatic OTP

`services/geofence.ts` uses PostGIS `ST_DWithin` on the `geog` columns to test whether the driver is within a trip's pickup/drop-off arrival radius (`GEOFENCE_ARRIVAL_RADIUS_M`, default 100 m).

On a positive trigger for an active trip:

1. A Redis dedup key `trip:{tripId}:otp_sent:{event}` (TTL 700s) prevents duplicate sends.
2. `generateOtp(...)` creates a 6-digit code, stores its **bcrypt hash** + expiry in Redis (`OTP_EXPIRY_SECONDS`, default 600), writes an `otp_events` row (`status='pending'`), and sends the SMS.
3. The driver socket receives `trip:otp-sent` → the app shows the OTP entry screen.
4. Trip status is advanced to `arrived_pickup` / `arrived_dropoff` and dispatchers get `trip:status-changed`.

## OTP verification

- `POST /api/otp/:tripId/verify` compares the entered code to the stored bcrypt hash. On success: `otp_events.status='verified'`, `verified_at` set, and the trip advances (`picked_up` / `completed`).
- Expiry is enforced by Redis TTL and the `expires_at` column; expired codes → `status='expired'`.
- **Photo fallback** (`POST /api/otp/:tripId/fallback`): when the rider has no phone, the driver captures a timestamped photo; `otp_events.status='fallback_photo'` with `photo_filename`. This preserves an auditable proof-of-service.
- Every OTP action is written to `audit_log` for Medicaid-billing traceability.

## SMS provider (`services/sms.ts`)

- Wraps Twilio. If `TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN`/`TWILIO_PHONE_NUMBER` are blank, the service runs in **dev-SMS mode**: the OTP is logged (`docker compose logs api | grep -i otp`) instead of sent. This is the default for test/demo deployments.

## Redis key reference (`db/redis.ts` → `RedisKeys`)

| Key | Purpose |
|---|---|
| `org:{orgId}:driver_positions` | Geo set of live positions |
| `driver:{driverId}:location` | Last-known position hash |
| `org:{orgId}:active_drivers` (`activeDrivers`) | Set of on-shift driver ids |
| `driver:{driverId}:last_db_write` | Breadcrumb write throttle |
| `trip:{tripId}:otp_sent:{event}` | Geofence OTP dedup flag |
| OTP keys | Hashed OTP + attempt counters (TTL = `OTP_EXPIRY_SECONDS`) |

## Extending realtime

- Add new client→server handlers inside `io.on('connection')` in `locationHandler.ts`; always re-check `socket.user.orgId`/role.
- To emit from a REST route, use `getIo()` from `lib/io.ts` and target the right room — never import `index.ts`.
