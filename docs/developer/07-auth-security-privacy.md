# 07 — Auth, Security & Privacy

## Authentication

- **JWT, two-token model.** `POST /api/auth/login` returns an **access token** (`JWT_EXPIRES_IN`, default 15m) and a **refresh token** (`JWT_REFRESH_EXPIRES_IN`, default 7d). Both are signed — access with `JWT_SECRET`, refresh with `JWT_REFRESH_SECRET`.
- **Refresh rotation.** Refresh tokens are stored **hashed** in `refresh_tokens`. `POST /api/auth/refresh` issues a new access token (and rotates the refresh token); `POST /api/auth/logout` revokes it.
- **Password hashing.** `bcryptjs`. The DB seed and demo seed use pgcrypto `crypt(..., gen_salt('bf', 12))`, which is bcrypt-compatible with the Node verifier.
- **Middleware.** `middleware/auth.ts` exposes `authenticate` (verifies the access token, sets `req.user = { userId, orgId, role }`) and `requireRole(...roles)`.

### Token storage on clients
- **Web:** Zustand auth store persisted to `localStorage` (`hooks/useAuth.ts`). Axios interceptors attach the access token and auto-refresh on 401 (`lib/api.ts`).
- **Mobile:** tokens in Expo **SecureStore**; the same auto-refresh interceptor pattern (`apps/mobile/src/lib/api.ts`).

## Authorization (RBAC)

Three roles: `admin`, `dispatcher`, `driver`.

- **admin** — full management incl. deleting riders, creating/versioning vendor profiles.
- **dispatcher** — day-to-day operations (trips, riders, drivers, imports, reports).
- **driver** — restricted to their own driver record and assigned trips (`GET /api/drivers/me`, OTP verify, tracking updates).

Guards are applied per-route via `requireRole(...)`. See role columns in [04 — API Reference](04-api-reference.md).

## Tenant isolation

Every domain query filters by `req.user.orgId`. This is the primary data-isolation boundary — there is no cross-org read path. When adding queries, scoping by `org_id` is mandatory. Socket handlers likewise re-derive `orgId` from `socket.user` and only broadcast within org rooms.

## Transport & network hardening

- **TLS** via Caddy (auto Let's Encrypt) in the prod compose. HTTP→HTTPS redirect (308).
- **Helmet** sets security headers on the API; nginx adds headers on the web tier (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, etc.).
- **CORS** is locked to `APP_BASE_URL`. In the standard deployment the browser is same-origin (nginx proxies `/api`), so CORS is effectively unused.
- **Rate limiting** — `/api/*` 200/15min; `/api/auth/*` 20/15min (brute-force mitigation).
- **Firewall** — only 22/80/443 exposed on the host; Postgres/Redis are never published externally (only inside the Docker network).
- **Uploads** — CSV uploads limited to 20 MB and `.csv` only; JSON bodies limited to 10 MB.

## Audit logging

`middleware/audit.ts` writes authenticated mutations to `audit_log` (`org_id`, `user_id`, `user_role`, `entity_type`, `entity_id`, `action`, `details` JSONB, `ip_address`, `user_agent`, `created_at`). OTP send/verify events are logged for **Medicaid-billing traceability** — an auditable proof-of-service trail. `audit_log` is append-only and has no `org_id` cascade, so purge it explicitly before deleting an org.

## Privacy posture (why this matters)

MidTransport deliberately stores **contact information only** — name, phone, address, emergency contact — and **no clinical data** (no diagnoses, no insurance/claim data). The intent is to stay below the HIPAA PHI threshold and to keep provider data on the provider's own server rather than a shared multi-tenant cloud. Notes fields are labeled "operational only" and must not be used for medical information. `riders.medical_id` is an external reference identifier, not clinical content.

When extending the schema or import mappings, **do not** introduce clinical/PHI fields without a deliberate compliance decision — it changes the platform's regulatory profile.

## Secrets management

- All secrets come from environment variables (`.env` on the server; never committed — `.env` is gitignored). See [13 — Configuration Reference](13-configuration-reference.md).
- Rotate `JWT_SECRET`/`JWT_REFRESH_SECRET` by updating `.env` and restarting the API (invalidates existing tokens).
- Generate strong values with `openssl rand -hex 48` (secrets) / `openssl rand -hex 24` (passwords).
