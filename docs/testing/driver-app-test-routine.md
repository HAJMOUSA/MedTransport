# Driver App — Test Routine

A repeatable routine for verifying the MidTransport driver app (Expo/React
Native) against any backend environment (local stack or the AWS demo server).

It has two layers:

1. **Automated API smoke test** — `scripts/driver-app-smoke-test.mjs`, exercises
   the endpoints the app relies on. Fast, run it first.
2. **Manual on-device scenarios** — walk the UI to confirm the app renders and
   behaves correctly end-to-end.

---

## Environments

| Environment | API base URL | Notes |
|---|---|---|
| Local (full) | `http://localhost:3001` | This branch — includes the new signature/no-show/cancellation features. Reach from a USB device via `adb reverse tcp:3001 tcp:3001`. |
| AWS demo | `https://midtransport.hajmousa.com` | Currently runs the older `trip-import` branch. Base flow works; the new endpoints (signature/no-show/cancellation) return **404** until this branch is deployed. |

### Demo logins

| Where | Email | Password | Role |
|---|---|---|---|
| AWS demo org (Sunrise) | `danny.driver@sunrise.demo` | `Demo1234!` | driver (4 trips) |
| AWS demo org (Sunrise) | `marcus.driver@sunrise.demo` / `latoya.driver@sunrise.demo` | `Demo1234!` | driver |
| AWS demo org (Sunrise) | `dispatch@sunrise.demo` | `Demo1234!` | dispatcher |
| Local seed | `driver@example.com` | `Driver1234!` | driver |

---

## Layer 1 — Automated API smoke test

Runs the scenarios the app depends on and prints PASS/FAIL per scenario.

```bash
# AWS demo (base features; new endpoints are reported as skipped/not-deployed)
node scripts/driver-app-smoke-test.mjs \
  --base https://midtransport.hajmousa.com \
  --email danny.driver@sunrise.demo --password 'Demo1234!'

# Local full stack (includes the new endpoints; add --mutate to test the gate)
node scripts/driver-app-smoke-test.mjs \
  --base http://localhost:3001 \
  --email driver@example.com --password 'Driver1234!' --mutate
```

Scenarios covered:

1. Health check (`GET /api/health`)
2. Login rejects a bad password
3. Unauthenticated `GET /api/trips` → 401
4. Driver login returns a `driver`-role token
5. `GET /api/drivers/me`
6. Trip list loads and is an array (guards the `{ data: [] }` unwrap bug)
7. Trip detail carries a navigable address/coordinates
8–10. New endpoints deployed? (`no-show`, `cancellation`, `signature` — 400 = deployed & validating, 404 = not deployed)
11. Signature gate: completing a dropoff without a signature → 409 (`--mutate`, needs an `arrived_dropoff` trip)

Exit code is non-zero if any non-skipped scenario fails.

---

## Layer 2 — Manual on-device scenarios

### Setup

1. Start the backend you want to test.
2. Start Metro pointing the app at that API:
   ```bash
   cd apps/mobile
   # Local:
   EXPO_PUBLIC_API_URL=http://localhost:3001 EXPO_OFFLINE=1 \
     ./node_modules/.bin/expo start --localhost --port 8081
   # AWS:
   EXPO_PUBLIC_API_URL=https://midtransport.hajmousa.com EXPO_OFFLINE=1 \
     ./node_modules/.bin/expo start --localhost --port 8081
   ```
3. USB device: `adb reverse tcp:8081 tcp:8081` (Metro bundle). For a **local** API
   also `adb reverse tcp:3001 tcp:3001`; for **AWS** the phone reaches it over WiFi.
4. Launch: `adb shell monkey -p com.midtransport.driver -c android.intent.category.LAUNCHER 1`

### Scenarios

| # | Scenario | Steps | Expected |
|---|---|---|---|
| 1 | **Login (happy path)** | Enter driver email + password → Sign In | Lands on **My Trips**; header shows the driver name + On/Off Shift toggle |
| 2 | **Login (bad password)** | Enter wrong password → Sign In | Inline error / alert; stays on login |
| 3 | **Trip list** | Observe the list | Trips grouped by Active / Scheduled / Completed; statuses and rider names correct |
| 4 | **Shift toggle** | Tap On/Off Shift | Toggle flips; persists on refresh |
| 5 | **Open active trip** | Tap a dispatched/active trip | ActiveTrip opens; requests location permission on first run |
| 6 | **Navigate** | Tap **🧭 Navigate** on pickup then dropoff | Opens Google/Apple Maps to the stop (or browser maps fallback) |
| 7 | **Status progression** | Advance: Start → Arrived pickup | Status/labels update; dispatcher (web) sees the change live |
| 8 | **OTP pickup** | At arrived_pickup, enter the 6-digit code (dev SMS: read from `docker compose logs api`) | Advances to picked_up |
| 9 | **Dropoff → signature (NEW)** | Advance to arrived_dropoff → OTP dropoff → **Signature** screen → sign → Confirm & Complete | Trip completes only after signing; a `signature` row is recorded; server 409 if you try to complete without it |
| 10 | **No-show (NEW)** | On an active trip → Report No-Show → pick reason → Confirm | Status → `no_show`; buttons no longer shown for that trip |
| 11 | **Cancellation (NEW)** | On an active trip → Cancel Trip → reason + note → Confirm | Status → `cancelled` |
| 12 | **Photo fallback** | On OTP screen → Use Photo Fallback → capture | Photo submitted; dropoff chains into the signature screen |
| 13 | **Logout / re-login** | Log out, log back in | Returns to login, then trip list; token persists across app restart |

> Scenarios 9–11 require the API to have this branch's endpoints. Against the
> current AWS deployment they return 404 — deploy this branch first (see below).

### Capturing evidence (headless)

```bash
adb exec-out screencap -p > shot.png        # screenshot
adb logcat -d | grep -i ReactNativeJS         # JS logs / red-box errors
```

---

## Deploying this branch to AWS (to test the new features there)

The AWS demo runs `trip-import`. To exercise scenarios 9–11 against AWS:

```bash
# push this branch, then on the server:
ssh -i ~/.ssh/midtransport-key.pem ubuntu@3.234.108.64
cd MedTransport && git fetch && git checkout feat/driver-app-mediroutes-parity \
  && git pull && sudo docker compose up -d --build
# the API runs migrate on start → creates the trip_events table
```

Then re-run Layer 1 against AWS; the new-endpoint scenarios should flip from
skipped (404) to passing (400/409).

---

## Known-good baseline (last run)

- **AWS demo, after deploying this branch** (`danny.driver@sunrise.demo`): 11 passed, 0 failed. New endpoints live; signature gate returns 409 without a signature; full E2E confirmed (POST /signature → 201, complete → 200, no-show → 200; `trip_events` rows recorded). Note: this E2E mutated demo trips 29 (completed) and 35 (no_show) — restore with `deploy/demo-seed.sql`.
- **Local full** (`driver@example.com`): 11 passed, 0 failed, 1 skipped (gate needs `--mutate` + an arrived_dropoff trip).
- **On device (local API):** login → My Trips → open active trip verified; TripList `{data}` unwrap bug fixed.
