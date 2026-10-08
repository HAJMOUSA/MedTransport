# 13 — Configuration Reference

All configuration is via environment variables, loaded from `.env` (never commit it — `.env` is gitignored). Templates: `.env.example` (local/dev) and `.env.production.example` (server). Compose injects these into the `api` container and derives `DATABASE_URL`/`REDIS_URL` from the DB/Redis vars.

## Database

| Var | Default | Notes |
|---|---|---|
| `POSTGRES_DB` | `midtransport` | Database name. |
| `POSTGRES_USER` | `midtransport` | DB user. |
| `POSTGRES_PASSWORD` | — (**required**) | Compose refuses to start without it. |
| `DATABASE_SSL` | `false` | Set `true` only for an external managed DB requiring SSL. |
| `DATABASE_URL` | derived | Built by compose from the above; set manually when running the API on the host (use `localhost`). |

## Redis

| Var | Default | Notes |
|---|---|---|
| `REDIS_PASSWORD` | — (**required**) | Redis auth password. |
| `REDIS_URL` | derived | `redis://:<pw>@redis:6379` in compose; `localhost` on host. |

## API server

| Var | Default | Notes |
|---|---|---|
| `NODE_ENV` | `production` | `development` locally. |
| `PORT` | `3001` | API listen port. |
| `JWT_SECRET` | — (**required**) | ≥32 random chars. Access-token signing. |
| `JWT_REFRESH_SECRET` | — (**required**) | Separate secret for refresh tokens. |
| `JWT_EXPIRES_IN` | `15m` | Access-token lifetime. |
| `JWT_REFRESH_EXPIRES_IN` | `7d` | Refresh-token lifetime. |

Generate secrets: `openssl rand -hex 48` (JWT), `openssl rand -hex 24` (passwords).

## Frontend

| Var | Default | Notes |
|---|---|---|
| `VITE_API_URL` | `""` | Empty = same-origin (nginx proxies `/api`). Set only for a split-origin setup. Baked in at web build time. |
| `APP_BASE_URL` | `http://localhost:3000` | Public origin of the web app. Used for CORS, Socket.io CORS, and links in SMS/email. Set to `https://<domain>` in prod. |

## Domain / TLS (prod override only)

| Var | Notes |
|---|---|
| `DOMAIN` | Public hostname for Caddy (no scheme/port), e.g. `midtransport.hajmousa.com`. Required by `docker-compose.prod.yml`. |

## Twilio (SMS / OTP) — optional

| Var | Notes |
|---|---|
| `TWILIO_ACCOUNT_SID` | Leave blank for **dev-SMS mode** (OTP codes logged, not sent). |
| `TWILIO_AUTH_TOKEN` | — |
| `TWILIO_PHONE_NUMBER` | E.164 sender number, e.g. `+1XXXXXXXXXX`. |

## SendGrid (email) — optional

| Var | Notes |
|---|---|
| `SENDGRID_API_KEY` | Leave blank to disable email. |
| `SENDGRID_FROM_EMAIL` | Sender address. |
| `SENDGRID_FROM_NAME` | Sender display name. |

## App settings

| Var | Default | Notes |
|---|---|---|
| `ORG_NAME` | `Your Transport Company` | Shown in SMS/email. |
| `ORG_TIMEZONE` | `America/New_York` | IANA tz used to interpret imported trip times. |
| `OTP_EXPIRY_SECONDS` | `600` | OTP validity window (also the Redis TTL). |
| `GEOFENCE_ARRIVAL_RADIUS_M` | `100` | Arrival-detection radius (meters). |
| `GPS_UPDATE_INTERVAL_S` | `10` | Min seconds between breadcrumb DB writes per driver. |

## Mobile app

| Var | Notes |
|---|---|
| `EXPO_PUBLIC_API_URL` | API origin the driver app targets (e.g. `https://midtransport.hajmousa.com`). Set for `expo start` and EAS builds. |

## Minimum required to boot

`POSTGRES_PASSWORD`, `REDIS_PASSWORD`, `JWT_SECRET`, `JWT_REFRESH_SECRET`. For the HTTPS prod override also `DOMAIN` and `APP_BASE_URL`. Everything else has safe defaults; Twilio/SendGrid may stay blank.
