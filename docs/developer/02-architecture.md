# 02 — Architecture

## Runtime topology

The production stack is four containers on one host, fronted by Caddy for TLS:

```
                 ┌─────────────────────────── Host (VPS / Lightsail) ───────────────────────────┐
   Internet      │                                                                               │
  ──────────►  Caddy (:80/:443)  ──►  web (nginx, :80)  ──┬── static React assets                │
   HTTPS         │   auto Let's Encrypt                   │                                       │
                 │                                        ├── /api/*      ─► api (:3001)          │
                 │                                        └── /socket.io/*─► api (:3001, WS)       │
                 │                                                          │                      │
                 │                                              api ──► db (PostgreSQL+PostGIS)    │
                 │                                              api ──► redis (7)                  │
                 └───────────────────────────────────────────────────────────────────────────────┘
```

- **Caddy** (`docker-compose.prod.yml`) terminates TLS and reverse-proxies to `web`. In the HTTP/IP-only deployment it is omitted and `web` is published directly on `:3000`.
- **web** is an nginx container serving the built React SPA. Its `nginx.conf` proxies `/api/` and `/socket.io/` to the `api` container, so the browser is always same-origin (no CORS). See `apps/web/nginx.conf`.
- **api** is the Express + Socket.io server. It never listens for DB/Redis externally; those ports are only reachable inside the Docker network (and blocked by the host firewall).
- **db** is `postgis/postgis:16-3.4-alpine`. Schema is applied on first boot from `apps/api/src/db/schema.sql`; migrations also run on every API start (idempotent — see [10](10-development-setup.md)).
- **redis** stores live driver positions (geo + hash), OTP-sent flags, and DB-write throttling keys.

## Backend composition (`apps/api`)

```
src/
├── index.ts            HTTP + Socket.io server bootstrap (listens)
├── app.ts              Express app: middleware, route mounts, health check
├── db/
│   ├── pool.ts         pg Pool + query/queryOne helpers
│   ├── redis.ts        ioredis client + RedisKeys builders
│   ├── schema.sql      Full DDL (source of truth for the schema)
│   └── migrate.ts      Idempotent migration runner (db:migrate)
├── lib/
│   ├── io.ts           setIo/getIo — decouples routes from the server entrypoint
│   └── logger.ts       Winston logger
├── middleware/
│   ├── auth.ts         authenticate (JWT) + requireRole (RBAC)
│   ├── audit.ts        Audit logging of authenticated requests
│   └── errorHandler.ts AppError + global error handler
├── routes/             One router per resource (see 04-api-reference)
├── services/
│   ├── otp.ts          OTP generation/verification
│   ├── sms.ts          Twilio wrapper (dev-SMS mode when unconfigured)
│   ├── geofence.ts     PostGIS ST_DWithin arrival detection
│   ├── importRunner.ts Import orchestration (analyze/execute)
│   └── importEngine/   Pure CSV pipeline (see 05-import-engine)
└── sockets/
    └── locationHandler.ts  Socket.io connection + driver events
```

**Key decoupling:** route modules never import `index.ts`. Anything that needs to emit socket events calls `getIo()` from `lib/io.ts`. This keeps `index.ts` (which calls `listen`) out of the import graph for tests and routes.

## Request lifecycle (REST)

1. Browser calls `/api/...` (same-origin; nginx/Caddy proxy to `api:3001`).
2. `helmet` → `cors` → JSON body parse → **rate limiter** (`/api/` 200/15min; `/api/auth/` 20/15min).
3. `auditMiddleware` records authenticated mutations to `audit_log`.
4. Route-level `authenticate` verifies the JWT and attaches `req.user` (`{ userId, orgId, role }`).
5. Route-level `requireRole(...)` enforces RBAC where needed.
6. Handler runs queries via `query`/`queryOne` (parameterized), optionally emits socket events via `getIo()`.
7. Errors are thrown as `AppError(msg, status)` and formatted by `errorHandler`.

Every domain query filters by `req.user.orgId` — this is the tenant isolation boundary. When adding queries, **always scope by `org_id`.**

## Realtime lifecycle (Socket.io)

1. Client connects with `auth.token` (the JWT). `io.use(...)` verifies it.
2. On connect: drivers join `org:{orgId}` and `driver:{userId}`; dispatchers/admins join `org:{orgId}:dispatchers`.
3. Drivers emit `driver:start-shift`, `driver:location-update`, `driver:end-shift`.
4. On each location update the server updates Redis geo/hash, throttles DB writes, broadcasts `driver:position` to dispatchers, and runs geofence checks that can auto-send an OTP.

Full event catalogue: [06 — Realtime, GPS & OTP](06-realtime-gps-otp.md).

## Data stores and their roles

| Store | Holds | Lifetime |
|---|---|---|
| PostgreSQL | All durable domain data + audit log + route breadcrumbs | Permanent |
| Redis geo `org:{org}:driver_positions` | Live driver lng/lat for instant lookup | Volatile |
| Redis hash `driver:{id}:location` | Last-known position + speed/heading | Volatile |
| Redis `trip:{id}:otp_sent:{event}` | Dedup flag so a geofence sends one OTP | TTL 700s |
| Redis `driver:{id}:last_db_write` | Throttles breadcrumb writes to `GPS_UPDATE_INTERVAL_S` | Short TTL |
| Redis (OTP) | Hashed OTP + attempts | `OTP_EXPIRY_SECONDS` |

## Frontend/mobile at a glance

- **Web** (`apps/web`): React Router SPA behind a JWT guard, React Query for server state, Zustand for auth, a Socket.io singleton hook for live updates. See [08](08-frontend-web.md).
- **Mobile** (`apps/mobile`): Expo app with a React Navigation stack (Login → TripList → ActiveTrip → OTPEntry), Expo SecureStore for tokens, Expo Location for GPS. See [09](09-mobile-app.md).
