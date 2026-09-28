# 01 — Overview

## What MidTransport is

MidTransport is a self-hostable NEMT (Non-Emergency Medical Transportation) dispatch platform. It lets a small transport provider manage riders, drivers, vehicles, and trips; track drivers live on a map; verify pickups/drop-offs with SMS one-time passcodes (OTP); and import trips from broker/vendor CSV files.

**Design pillars**

- **Privacy-first.** Stores only contact information (name, phone, address, emergency contact). No diagnoses, insurance numbers, or clinical data — deliberately below the HIPAA PHI threshold. See [07 — Auth, Security & Privacy](07-auth-security-privacy.md).
- **Self-hostable.** The entire stack runs from one `docker compose up` on a small VPS. No external SaaS dependency except optional Twilio (SMS) and SendGrid (email).
- **Multi-tenant ready.** Every domain table is scoped by `org_id` with cascade deletes, even though most deployments are single-tenant.

## Monorepo layout

npm workspaces monorepo:

```
MidTransport/
├── apps/
│   ├── api/          Node + Express + Socket.io backend (TypeScript)
│   ├── web/          Dispatcher dashboard SPA (React + Vite + Tailwind)
│   └── mobile/       Driver app (Expo / React Native)
├── packages/
│   └── shared/       Types shared between api and web (e.g. VendorProfileConfig)
├── deploy/           Caddyfile, deployment runbooks, demo seed/teardown SQL
├── docs/             This documentation
├── docker-compose.yml            Base stack (db, redis, api, web)
├── docker-compose.prod.yml       Prod override: Caddy TLS in front
└── package.json                  Workspace root
```

## Tech stack

| Layer | Technology | Notes |
|---|---|---|
| Backend | Node.js, Express 4, TypeScript | `apps/api` |
| Realtime | Socket.io 4 | Live GPS, geofence-triggered OTP |
| Database | PostgreSQL 16 + PostGIS 3.4 | Spatial queries for geofencing |
| Cache / geo | Redis 7 (ioredis) | Live driver positions, OTP TTL, rate-limit state |
| Web frontend | React 18, Vite, TailwindCSS, React Router 6 | `apps/web` |
| Data fetching | @tanstack/react-query | 30s stale time |
| Client state | Zustand | Auth store (persisted) |
| Maps | Leaflet + OpenStreetMap | No API key required |
| Mobile | Expo, React Native, React Navigation | `apps/mobile` |
| Auth | JWT (access + refresh), bcryptjs | RBAC: admin / dispatcher / driver |
| SMS / OTP | Twilio | Optional; blank = dev-SMS mode (codes in logs) |
| Email | SendGrid | Optional |
| Tests | Vitest, Supertest | `apps/api/tests` |
| Deploy | Docker, Docker Compose, Caddy (TLS) | See [12](12-deployment-operations.md) |

## Glossary

| Term | Meaning |
|---|---|
| **Org** | An organization (tenant). All data is scoped to an org. |
| **Rider** | A passenger. Contact info only. |
| **Driver** | A user with role `driver` plus a `drivers` row (vehicle, license, shift state). |
| **Trip** | A scheduled transport from a pickup address to a drop-off address. |
| **Will-call** | A trip with no scheduled pickup time; the rider calls when ready. |
| **Vendor profile** | A saved, versioned CSV column mapping for a broker/vendor. |
| **Canonical field** | A normalized trip/rider attribute (e.g. `pickup_at`, `primary_phone`). |
| **Geofence** | A circular zone around a destination that triggers arrival detection. |
| **OTP** | One-time passcode (6-digit) sent by SMS to verify pickup/drop-off. |

## Where to start reading

- Understanding the system end to end → [02 — Architecture](02-architecture.md)
- Changing the database → [03 — Data Model](03-data-model.md)
- Adding/altering an endpoint → [04 — API Reference](04-api-reference.md)
- Working on CSV import → [05 — Import Engine](05-import-engine.md)
- Running it locally → [10 — Development Setup](10-development-setup.md)
