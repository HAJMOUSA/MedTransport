# 03 — Data Model

**Source of truth:** `apps/api/src/db/schema.sql`. It is applied to a fresh database on first container boot (mounted into the Postgres init dir) and re-applied idempotently by `apps/api/src/db/migrate.ts` on every API start. Extensions required: `uuid-ossp`, `postgis`, `pgcrypto`.

All domain tables carry `org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE`. Deleting an organization removes all of its data (except `audit_log`, which references orgs without cascade — clear it first; see the demo teardown for the pattern).

## Enums

| Enum | Values |
|---|---|
| `user_role` | `admin`, `dispatcher`, `driver` |
| `mobility_type` | `standard`, `wheelchair`, `stretcher`, `bariatric` |
| `vehicle_type` | `sedan`, `suv`, `van`, `wheelchair_van`, `stretcher_van`, `bus` |
| `trip_status` | `scheduled`, `dispatched`, `en_route_pickup`, `arrived_pickup`, `picked_up`, `en_route_dropoff`, `arrived_dropoff`, `completed`, `cancelled`, `no_show` |
| `otp_event_type` | `pickup`, `dropoff` |
| `otp_status` | `pending`, `verified`, `expired`, `fallback_photo` |

## Tables

### organizations
Tenant root. `id`, `name`, `slug` (unique), `phone`, `address`, `email`, `timezone` (IANA, default `America/New_York`), timestamps. The default single-tenant deployment seeds one org with slug `default`.

### users
`id`, `org_id`, `email` (unique), `password_hash` (bcrypt), `name`, `role` (`user_role`), `phone`, `is_active`, `last_login_at`, timestamps. Drivers are users with `role='driver'` plus a `drivers` row.

### refresh_tokens
`id`, `user_id` (cascade), `token_hash` (unique), `expires_at`, `created_at`. Refresh tokens are stored hashed; rotation happens in `routes/auth.ts`.

### riders
Contact info only — **no medical data**. `id`, `org_id`, `name`, `first_name`, `last_name`, `phone`, `phone_alt`, `email`, `home_address`, `home_lat`, `home_lng`, `emergency_contact`, `emergency_phone`, `mobility_type`, `dispatcher_notes` (operational only), `date_of_birth`, `medical_id` (an external identifier string — not clinical data), `is_active`, timestamps.

### vehicles
`id`, `org_id`, `name`, `license_plate`, `vehicle_type`, `capacity`, `make`, `model`, `year`, `color`, `is_active`, timestamps.

### drivers
Driver-specific extension of a user. `id`, `user_id` (unique, cascade), `org_id`, `vehicle_id` (nullable ref), `license_number`, `license_expiry`, `on_shift`, `shift_started_at`, timestamps.

### trips
Central entity. Key columns:
- Links: `org_id`, `rider_id`, `driver_id` (nullable), `vehicle_id` (nullable), `created_by`.
- Pickup: `pickup_address`, `pickup_lat/lng`, `scheduled_pickup_at` (NULL when will-call), `actual_pickup_at`, `will_call`.
- Drop-off: `dropoff_address`, `dropoff_lat/lng`, `scheduled_dropoff_at`, `actual_dropoff_at`.
- State: `status` (`trip_status`), `mobility_type`.
- Recurrence: `is_recurring`, `recurrence_rule` (RRULE-ish), `parent_trip_id`.
- Operational: `dispatcher_notes`, `distance_miles`, `duration_minutes`.
- Import/vendor: `external_trip_id`, `appointment_at`, `level_of_service`, `additional_passengers`, `assistance_needs`, `trip_type`, `source_vendor_profile_id`, `import_job_id`.
- Unique index `trips_external_id_unique` on `(org_id, source_vendor_profile_id, external_trip_id)` where `external_trip_id IS NOT NULL` — the basis of duplicate detection on import.

### driver_locations
GPS breadcrumbs for route replay. `id` (bigserial), `driver_id` (cascade), `trip_id` (nullable), `latitude`, `longitude`, `geog` (generated `GEOGRAPHY(POINT,4326)` from lng/lat), `speed_mph`, `heading_deg`, `accuracy_m`, `recorded_at`. GIST index on `geog` for spatial queries.

### geofences
Destinations with arrival zones. `id`, `org_id`, `name`, `address`, `latitude`, `longitude`, `radius_m` (default 100), generated `geog`, `is_active`. GIST index on `geog`.

### otp_events
Tamper-evident verification log. `id`, `trip_id` (cascade), `driver_id`, `event_type` (`otp_event_type`), `rider_phone`, `otp_hash` (bcrypt — plain OTP never stored), `trigger_lat/lng`, `status` (`otp_status`), `verified_at`, `photo_filename` (fallback), `expires_at`, `created_at`.

### audit_log
Append-only access/action log. `id` (bigserial), `org_id` (ref, **no cascade**), `user_id`, `user_role`, `entity_type`, `entity_id`, `action`, `details` (JSONB), `ip_address` (INET), `user_agent`, `created_at`. Used for Medicaid-billing traceability of OTP events.

### import_jobs
Record of each import run. `id`, `org_id`, `imported_by`, `import_type` (`riders`|`trips`), `filename`, `total_rows`, `imported_rows`, `skipped_rows`, `error_rows`, `errors` (JSONB), `status` (`processing`|`completed`|`failed`), timestamps. Trip-import adds: `mode`, `file_hash`, `vendor_profile_version_id`, `updated_rows`, `duplicate_rows`, `duplicate_policy`, `result_trip_ids` (int[]).

### vendor_profiles / vendor_profile_versions
A vendor profile is a named, versioned CSV mapping.
- `vendor_profiles`: `id`, `org_id`, `name`, `is_active`, `created_by`, timestamps. Unique `(org_id, name)`.
- `vendor_profile_versions`: `id`, `profile_id` (cascade), `version`, `config` (JSONB — see `VendorProfileConfig`), `created_by`, `created_at`. Unique `(profile_id, version)`.

`trips.source_vendor_profile_id` references `vendor_profiles(id)`.

### levels_of_service
Org-controlled vocabulary. `id`, `org_id`, `code`, `label`, `is_active`. Unique `(org_id, code)`. Imported `level_of_service` values are translated to these codes.

### import_uploads
Staged raw upload for the multi-step import wizard. `id`, `org_id`, `uploaded_by`, `filename`, `sha256`, `content` (BYTEA), `detected_encoding`, `row_count`, `expires_at` (2h TTL — purged lazily on new uploads), `created_at`.

## Entity relationships (summary)

```
organizations 1──* users 1──1 drivers *──1 vehicles
organizations 1──* riders
organizations 1──* trips  *──1 riders
                    trips *──1 drivers
                    trips 1──* otp_events
drivers 1──* driver_locations
organizations 1──* geofences
organizations 1──* vendor_profiles 1──* vendor_profile_versions
organizations 1──* import_jobs / import_uploads / levels_of_service
```

## Changing the schema

1. Edit `apps/api/src/db/schema.sql`. Use `CREATE TABLE IF NOT EXISTS` / `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` / guarded `DO $$ ... EXCEPTION WHEN duplicate_object` blocks so it stays idempotent.
2. `migrate.ts` runs the file on API start, so existing deployments pick up additive changes automatically on redeploy.
3. Destructive changes (drop/rename) need a manual migration — the idempotent runner won't perform them safely. Coordinate a backup first (see [12 — Deployment & Operations](12-deployment-operations.md)).
4. Update `packages/shared` types and this document.
