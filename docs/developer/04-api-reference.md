# 04 — API Reference

Base path: all endpoints are under `/api`. In production the browser reaches them same-origin (nginx/Caddy proxy to `api:3001`). Route mounts are defined in `apps/api/src/app.ts`; per-endpoint validation lives in each `apps/api/src/routes/*.ts` file (via `express-validator`) — treat those files as the authoritative contract.

## Conventions

- **Auth:** Send `Authorization: Bearer <accessToken>`. All endpoints require a valid JWT **except** `POST /api/auth/login` and `POST /api/auth/refresh`.
- **Tenant scope:** Every request is implicitly scoped to the caller's `orgId` from the JWT. You cannot read/write another org's data.
- **Roles:** `admin` ⊇ `dispatcher` capabilities in most places; `driver` is restricted to its own trips/driver record. Role requirements below reflect `requireRole(...)` guards in code.
- **Errors:** JSON `{ "error": "message" }` with an appropriate HTTP status (`AppError`). Validation failures return `400`.
- **Rate limits:** `/api/*` = 200 req / 15 min; `/api/auth/*` = 20 req / 15 min.

## Auth — `/api/auth`

| Method | Path | Role | Purpose |
|---|---|---|---|
| POST | `/login` | public | Email + password → `{ accessToken, refreshToken, user }`. Updates `last_login_at`. |
| POST | `/refresh` | public | Refresh token → new access (and rotated refresh) token. |
| POST | `/logout` | auth | Revokes the caller's refresh token. |
| GET | `/me` | auth | Current user profile. |
| POST | `/change-password` | auth | Change own password (requires current password). |

Access-token lifetime `JWT_EXPIRES_IN` (default 15m), refresh `JWT_REFRESH_EXPIRES_IN` (default 7d).

## Riders — `/api/riders`

| Method | Path | Role | Purpose |
|---|---|---|---|
| GET | `/` | auth | List/search riders (query params for search/pagination). |
| GET | `/:id` | auth | One rider. |
| POST | `/` | auth | Create rider. |
| PUT | `/:id` | auth | Update rider. |
| DELETE | `/:id` | **admin** | Delete rider. |

## Drivers — `/api/drivers`

| Method | Path | Role | Purpose |
|---|---|---|---|
| GET | `/me` | **driver** | The calling driver's own record (id, vehicle, shift). |
| GET | `/` | admin/dispatcher | List drivers with live metrics. |
| POST | `/` | auth | Create a driver (creates the user + drivers row). |
| PUT | `/:id` | auth | Update driver / vehicle assignment. |

## Trips — `/api/trips`

| Method | Path | Role | Purpose |
|---|---|---|---|
| GET | `/` | auth | List trips (filter by status/date/driver via query). |
| GET | `/lookups` | auth | Reference data for forms (riders, drivers, LOS, etc.). Registered before `/:id`. |
| POST | `/validate-canonical` | auth | Validate a canonical trip payload without saving (shared manual-entry + import validation). |
| GET | `/:id` | auth | One trip. |
| POST | `/` | auth | Create trip (manual entry; supports a return-leg). Emits socket updates. |
| PUT | `/:id` | auth | Update trip. |
| PATCH | `/:id/status` | auth | Change trip status. Broadcasts `trip:status-changed`. |
| PATCH | `/:id/assign` | auth | Assign/reassign a driver (and vehicle). |

## Rider CSV import — `/api/import`

| Method | Path | Role | Purpose |
|---|---|---|---|
| POST | `/riders` | auth | Upload a riders CSV (multipart `file`) and import synchronously; returns a job summary. |
| GET | `/jobs/:id` | auth | Poll a rider import job. |
| GET | `/template/riders` | auth | Download the rider CSV template. |

## Trip CSV import wizard — `/api/import/trips`

All endpoints require **admin or dispatcher** (`router.use(authenticate, requireRole('admin','dispatcher'))`).

| Method | Path | Purpose |
|---|---|---|
| GET | `/canonical-fields` | List canonical trip fields (`CANONICAL_FIELDS`) for the mapping UI. |
| POST | `/upload` | Upload a trip CSV (multipart `file`). Stages the file, parses headers, auto-detects a vendor profile, and returns `suggestedMap` (column auto-match). |
| POST | `/analyze` | Dry-run analysis with a `profileVersionId` or inline config (+ optional `mappingOverrides`). Returns counts, sample, notices, issues — no writes. |
| POST | `/execute` | Perform the import (`mode`: `test` / `all_or_nothing` / `valid_rows_only`; `duplicatePolicy`: `skip` / `reject` / `update`). |
| GET | `/jobs/:id` | Poll a trip import job. |
| GET | `/jobs/:id/errors.csv` | Download rejected rows with per-row error reasons. |

See [05 — Import Engine](05-import-engine.md) for the pipeline and config shape.

## Vendor profiles — `/api/import/profiles`

| Method | Path | Role | Purpose |
|---|---|---|---|
| GET | `/` | auth | List vendor profiles (with latest version). |
| POST | `/` | **admin** | Create a profile + initial version. |
| GET | `/:id` | auth | Profile detail incl. versions and latest `config`. |
| POST | `/:id/versions` | **admin** | Save a new config version for the profile. |

## Tracking — `/api/tracking`

| Method | Path | Role | Purpose |
|---|---|---|---|
| GET | `/drivers/live` | admin/dispatcher | Current live positions of on-shift drivers (from Redis). |
| GET | `/trips/:tripId/route` | auth | Breadcrumb route for a trip (from `driver_locations`). |
| GET | `/drivers/:driverId/metrics` | auth | Driver metrics (trips, on-time, idle, speed). |

## OTP — `/api/otp`

| Method | Path | Role | Purpose |
|---|---|---|---|
| POST | `/:tripId/verify` | auth | Verify a 6-digit OTP for a trip (pickup/dropoff). Logs to `otp_events`. |
| POST | `/:tripId/fallback` | auth | Photo fallback when the rider has no phone (multipart photo). |
| GET | `/:tripId/events` | auth | OTP event history for a trip. |

## Reports — `/api/reports`

| Method | Path | Role | Purpose |
|---|---|---|---|
| GET | `/summary` | auth | Summary analytics over a date range (KPIs, per-driver performance). Backs the Reports page and CSV export. |

## Geocoding — `/api/geocode`

| Method | Path | Role | Purpose |
|---|---|---|---|
| GET | `/search` | auth | Address autocomplete/geocode (OpenStreetMap/Nominatim-backed). Used by manual trip entry and rider address fields. |

## Health

| Method | Path | Role | Purpose |
|---|---|---|---|
| GET | `/api/health` | public | Checks DB (`SELECT 1`) and Redis (`PING`). `200 {status:'ok'}` or `503`. |

## Adding a new endpoint (checklist)

1. Add/extend a router in `apps/api/src/routes/`. Mount it in `app.ts` if new.
2. Put `authenticate` (and `requireRole` where needed) on the route.
3. Validate inputs with `express-validator`; throw `AppError(msg, status)` for failures.
4. Scope **every** query by `req.user.orgId`.
5. Emit socket events via `getIo()` from `lib/io.ts` if realtime clients care.
6. Add a Supertest route test in `apps/api/tests/routes/` (see [11 — Testing](11-testing.md)).
7. Document it here.
