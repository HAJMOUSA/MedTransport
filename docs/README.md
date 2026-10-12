# MidTransport Documentation

MidTransport is an open-source, privacy-first Non-Emergency Medical Transportation (NEMT) platform for small providers (1–20 vehicles). It is self-hostable, stores no medical records, and ships as a single Docker Compose stack.

This folder contains the full project documentation, split into a **developer maintenance handbook** and an **end-user guide**.

## Developer Handbook (`developer/`)

For engineers maintaining or extending the platform.

| Doc | Contents |
|---|---|
| [01 — Overview](developer/01-overview.md) | Purpose, monorepo layout, tech stack, glossary |
| [02 — Architecture](developer/02-architecture.md) | System components, request/data flow, runtime topology |
| [03 — Data Model](developer/03-data-model.md) | PostgreSQL + PostGIS schema, tables, enums, relationships |
| [04 — API Reference](developer/04-api-reference.md) | Every REST endpoint, auth, request/response shapes |
| [05 — Import Engine](developer/05-import-engine.md) | CSV import pipeline, vendor profiles, column auto-match |
| [06 — Realtime, GPS & OTP](developer/06-realtime-gps-otp.md) | Socket.io events, geofencing, OTP verification flow |
| [07 — Auth, Security & Privacy](developer/07-auth-security-privacy.md) | JWT/RBAC, audit log, rate limiting, privacy posture |
| [08 — Web Frontend](developer/08-frontend-web.md) | Dispatcher SPA structure, state, patterns |
| [09 — Mobile App](developer/09-mobile-app.md) | Driver app (Expo/React Native) structure |
| [10 — Development Setup](developer/10-development-setup.md) | Local setup, workspaces, running services |
| [11 — Testing](developer/11-testing.md) | Vitest layout, conventions, running tests |
| [12 — Deployment & Operations](developer/12-deployment-operations.md) | Docker, AWS Lightsail, Caddy TLS, backups, ops |
| [13 — Configuration Reference](developer/13-configuration-reference.md) | Every environment variable |

## User Guide (`user-guide/`)

For dispatchers, admins, and drivers using the platform.

| Doc | Audience |
|---|---|
| [Overview & Getting Started](user-guide/README.md) | All users |
| [Dispatcher Web Guide](user-guide/dispatcher-guide.md) | Admins & dispatchers |
| [Driver App Guide](user-guide/driver-app-guide.md) | Drivers |
| [FAQ & Troubleshooting](user-guide/faq-troubleshooting.md) | All users |

## Related documents

- Product research & roadmap: [`../PROPOSAL.md`](../PROPOSAL.md)
- Deployment runbooks: [`../deploy/DEPLOY.md`](../deploy/DEPLOY.md) (HTTPS/Caddy), [`../deploy/AWS-LIGHTSAIL.md`](../deploy/AWS-LIGHTSAIL.md) (HTTP/IP)
- Design specs & implementation plans: [`superpowers/specs/`](superpowers/specs/), [`superpowers/plans/`](superpowers/plans/)

## Conventions used in these docs

- Code references use paths relative to the repo root, e.g. `apps/api/src/routes/trips.ts`.
- "Canonical field" = a normalized trip/rider attribute the import engine maps vendor columns onto.
- Roles are always one of: **admin**, **dispatcher**, **driver**.
