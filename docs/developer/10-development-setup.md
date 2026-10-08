# 10 — Development Setup

## Prerequisites

- Node.js 20+ and npm 9+ (the repo uses npm workspaces; a `pnpm-lock.yaml` also exists but npm is the documented path).
- Docker + Docker Compose (for Postgres/PostGIS + Redis, or the full stack).
- For the mobile app: Expo CLI (`npx expo`) and the Expo Go app or an emulator.

## 1. Clone & install

```bash
git clone https://github.com/HAJMOUSA/MedTransport.git
cd MedTransport
npm install         # installs all workspaces
```

## 2. Environment

```bash
cp .env.example .env
# edit .env — at minimum set POSTGRES_PASSWORD, REDIS_PASSWORD, JWT_SECRET, JWT_REFRESH_SECRET
```

Full variable reference: [13 — Configuration Reference](13-configuration-reference.md).

## 3a. Fastest path — run everything in Docker

```bash
docker compose up -d --build
# web:  http://localhost:3000
# api:  proxied under http://localhost:3000/api
```

Postgres schema is applied automatically on first boot; the API also runs idempotent migrations on start. Default admin: `admin@example.com` / `Admin1234!` (change it).

## 3b. Hybrid path — infra in Docker, apps on host (recommended for dev)

Run only the datastores in Docker, and run api/web with hot reload on the host:

```bash
# Start just db + redis
docker compose up -d db redis

# API (watch mode)
npm run dev -w @midtransport/api     # tsx watch src/index.ts → http://localhost:3001

# Web (Vite dev server)
npm run dev -w @midtransport/web     # http://localhost:5173 (proxies /api to :3001)
```

Ensure `.env` `DATABASE_URL`/`REDIS_URL` point at `localhost` when running the API on the host (the Docker service names `db`/`redis` only resolve inside the compose network).

## 4. Database migrations / seed

- Schema source: `apps/api/src/db/schema.sql`.
- Manual run: `npm run db:migrate -w @midtransport/api` (executes `src/db/migrate.ts`, idempotent).
- The default org + admin user are seeded by the schema file.
- **Demo data:** `deploy/demo-seed.sql` (re-runnable) creates a self-contained `demo-sunrise` org; `deploy/demo-teardown.sql` removes it. Load via `docker compose exec -T db psql -U midtransport -d midtransport < deploy/demo-seed.sql`.

## 5. Mobile app

```bash
cd apps/mobile
EXPO_PUBLIC_API_URL="http://<your-lan-ip>:3001" npx expo start
# open in Expo Go on a device on the same network
```

Use your machine's LAN IP (not `localhost`) so a physical phone can reach the API. GPS/camera features need a real device.

## Workspace scripts

| Command | Effect |
|---|---|
| `npm run dev -w @midtransport/api` | API in watch mode (tsx) |
| `npm run dev -w @midtransport/web` | Web dev server (Vite) |
| `npm run build -w @midtransport/api` | Type-check + compile API (tsc) |
| `npm test -w @midtransport/api` | Run API tests (vitest) |
| `npm run db:migrate -w @midtransport/api` | Run migrations |

## Common pitfalls

- **`db`/`redis` hostnames** resolve only inside Docker. On the host, use `localhost`.
- **Required env vars** (`POSTGRES_PASSWORD`, `REDIS_PASSWORD`) are enforced by compose — the stack refuses to start without them.
- **Ports:** api `3001`, web (Docker) `3000`, web (Vite dev) `5173`, Postgres `5432`, Redis `6379`.
- **OTP in dev:** with Twilio blank, codes appear in the API logs, not by SMS.
