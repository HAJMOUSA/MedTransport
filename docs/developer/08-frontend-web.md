# 08 — Web Frontend (Dispatcher Dashboard)

`apps/web` — a React 18 + Vite + TypeScript single-page app styled with TailwindCSS. Served in production by nginx (which also proxies `/api` and `/socket.io`).

## Structure

```
apps/web/src/
├── main.tsx                 React entry
├── App.tsx                  Router + query client + auth guards
├── index.css                Tailwind + Leaflet CSS
├── lib/
│   └── api.ts               Axios instance: auth header + auto-refresh interceptors
├── hooks/
│   ├── useAuth.ts           Zustand auth store (persisted to localStorage)
│   └── useSocket.ts         Socket.io client singleton hook
├── components/
│   ├── Layout.tsx           Sidebar nav + top bar + rider-CSV modal shortcut
│   ├── TripBoard/           Kanban board (TripBoard, TripCard, AddTripModal)
│   ├── LiveMap/             Leaflet map (LiveMap, DriverPanel)
│   └── CSVImport/           Rider CSV drag-and-drop modal
└── pages/
    ├── Login.tsx
    ├── Dashboard.tsx        KPI cards + driver performance
    ├── Trips.tsx            Board / map view switcher
    ├── Riders.tsx           Rider list + add/edit + import button
    ├── Drivers.tsx          Driver cards + live metrics
    ├── Reports.tsx          Date-range analytics + CSV export
    ├── Settings.tsx         Change password
    ├── ImportTrips/         Trip import wizard (see below)
    └── ImportProfiles/      Vendor profile manager
```

## Routing & auth guards (`App.tsx`)

React Router v6. `/login` is wrapped in `RequireGuest`; everything else is nested under a `RequireAuth` → `Layout` route:

| Path | Page |
|---|---|
| `/` (index) | Dashboard |
| `/trips` | Trips (board/map) |
| `/riders` | Riders |
| `/import` | Trip import wizard |
| `/import/profiles` | Vendor profile manager |
| `/drivers` | Drivers |
| `/reports` | Reports |
| `/settings` | Settings |

Unknown paths redirect to `/`. `RequireAuth` checks `useAuthStore().isAuthenticated()`.

## State management

- **Server state:** `@tanstack/react-query` (`QueryClient` with `staleTime: 30s`, `retry: 1`). Query keys are resource-scoped (e.g. `['riders']`, `['import-profiles']`, `['import-profile', id]`, `['canonical-fields']`). Mutations invalidate the relevant keys.
- **Auth state:** Zustand store (`useAuth.ts`), persisted. Holds `user`, tokens, `isAuthenticated()`, `logout()`.
- **Realtime:** `useSocket.ts` maintains a single Socket.io connection authenticated with the access token; components subscribe to `driver:position`, `trip:status-changed`, etc., to update the map/board live.

## API client (`lib/api.ts`)

Axios instance with:
- a request interceptor adding `Authorization: Bearer <access>`,
- a response interceptor that, on `401`, calls `/api/auth/refresh` once and retries the original request; on refresh failure it clears auth and routes to `/login`.

## The trip import wizard (`pages/ImportTrips/`)

A stepper (`index.tsx`) driving a `WizardState` (`types.ts`):

| Step file | Purpose |
|---|---|
| `UploadStep` | Upload CSV → `POST /api/import/trips/upload`; stores `upload` (headers, `suggestedMap`, detected profile). |
| `MapStep.tsx` | Column mapping. `effective = { ...suggestedMap, ...savedMap, ...mappingOverrides }`. Shows "auto" pills, a Reset link; admins can save as profile/version. |
| `PreviewStep` | Masked sample of mapped rows. |
| `ValidateStep` | `POST /analyze` dry-run: counts, notices, issues. |
| `ResultsStep` | `POST /execute` outcome + error CSV download. |

`WizardState` carries `profileId`, `profileVersionId`, `inlineConfig` (profileless), `mappingOverrides`, `analysis`, `mode`, `duplicatePolicy`, `jobId`. See [05 — Import Engine](05-import-engine.md).

## Rider CSV import (`components/CSVImport/`)

A modal reachable from the sidebar ("Import Riders CSV") — drag-and-drop upload to `POST /api/import/riders`, then invalidates `['riders']`.

## Maps (`components/LiveMap/`)

Leaflet + OpenStreetMap tiles (no key). `LiveMap` renders driver pins updated from `driver:position` socket events and pickup/drop-off markers; `DriverPanel` shows a selected driver's live metrics.

## Conventions

- Tailwind utility classes inline; icons from `lucide-react`.
- Keep API calls in React Query hooks/queries, not scattered in components.
- New protected page: add the route in `App.tsx` under the `Layout` route and a nav item in `Layout.tsx` (`navItems`).
- Types shared with the backend (e.g. `VendorProfileConfig`) come from `@midtransport/shared`.

## Build & run

- Dev: `npm run dev -w @midtransport/web` (Vite dev server, proxying `/api` to the local API — see [10](10-development-setup.md)).
- Prod: multi-stage `apps/web/Dockerfile` builds static assets served by nginx (`apps/web/nginx.conf`). Build arg `VITE_API_URL` is empty so the app is same-origin.
