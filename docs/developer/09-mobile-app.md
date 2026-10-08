# 09 — Mobile App (Driver)

`apps/mobile` — an Expo / React Native app for drivers. Handles login, shift toggling, the day's trip list, an active-trip screen with live GPS reporting and navigation hand-off, and OTP entry (with photo fallback).

## Structure

```
apps/mobile/
├── App.tsx                  Navigation stack + query client + auth bootstrap
├── app.json                 Expo config
├── package.json
└── src/
    ├── lib/api.ts           Axios + Expo SecureStore token storage + auto-refresh
    ├── hooks/
    │   ├── useAuth.ts       Zustand auth store (SecureStore-persisted)
    │   └── useSocket.ts     Socket.io client hook
    └── screens/
        ├── LoginScreen.tsx  Driver login
        ├── TripList.tsx     Today's trips + shift toggle + realtime updates
        ├── ActiveTrip.tsx   Active trip: GPS tracking + status buttons + navigation
        └── OTPEntry.tsx     6-digit OTP input + photo fallback camera
```

## Navigation (`App.tsx`)

React Navigation stack (`headerShown: false`). Auth-gated:

- **Not signed in:** `Login`.
- **Signed in:** `Main` (`TripList`) → `ActiveTrip` (`{ tripId }`) → `OTPEntry` (`{ tripId, eventType }`, presented modally).

On boot, `useAuth.loadFromStorage()` restores tokens from SecureStore before rendering (spinner until bootstrapped).

## Auth & API

- Tokens stored in **Expo SecureStore** (not AsyncStorage) — see `src/lib/api.ts`.
- Same auto-refresh interceptor pattern as web: attach access token; on 401 refresh once and retry.
- API base URL is provided via `EXPO_PUBLIC_API_URL` (points at the deployed API origin, e.g. `https://midtransport.hajmousa.com`).

## Shift & GPS lifecycle

1. Driver toggles shift on `TripList` → emits `driver:start-shift` (Socket.io). Server marks `on_shift`, adds to the active set, notifies dispatchers.
2. While a trip is active (`ActiveTrip`), the app uses **Expo Location** to emit `driver:location-update` periodically. The server updates Redis, throttles breadcrumb writes (`GPS_UPDATE_INTERVAL_S`), broadcasts `driver:position` to dispatchers, and runs geofence checks.
3. On arrival within `GEOFENCE_ARRIVAL_RADIUS_M`, the server sends an OTP and emits `trip:otp-sent` → the app navigates to `OTPEntry`.
4. Ending the shift emits `driver:end-shift`.

## Trip actions

- `ActiveTrip` exposes status transitions (e.g. en route → arrived → picked up → completed) backed by `PATCH /api/trips/:id/status`.
- "Navigate" opens the device's map app (Google/Apple Maps) to the pickup or drop-off address.
- `OTPEntry` submits to `POST /api/otp/:tripId/verify`; if the rider has no phone, the photo-fallback path calls `POST /api/otp/:tripId/fallback` with a timestamped photo.

## Running & building

- **Dev:** `npx expo start` from `apps/mobile` with `EXPO_PUBLIC_API_URL` set; open in Expo Go on a device on the same network (or a tunnel). GPS/camera require a physical device or a simulator with location.
- **Production build:** EAS Build, e.g. `npx eas-cli build --platform android --profile production` with `EXPO_PUBLIC_API_URL` set to the public HTTPS origin (a free Expo account is needed for EAS). See `deploy/DEPLOY.md` §6.

## Notes for maintainers

- The app depends on the same realtime contract as the backend ([06 — Realtime, GPS & OTP](06-realtime-gps-otp.md)) — keep event names/payloads in sync when changing either side.
- Camera/geolocation require the app to run over HTTPS (for any PWA build) or as a native build with the proper permissions; for phone testing use the HTTPS deployment, not the HTTP/IP one.
