-- ═══════════════════════════════════════════════════════════════════════════
-- MidTransport DEMO TEARDOWN
-- ───────────────────────────────────────────────────────────────────────────
-- Removes ALL demo data in one shot. Every demo row lives under an organization
-- whose slug starts with 'demo-', and every table cascades on org_id — so
-- deleting the org(s) wipes riders, drivers, vehicles, trips, geofences,
-- driver_locations, otp_events, vendor profiles, import jobs, etc.
--
-- audit_log is the only table without ON DELETE CASCADE on org_id, so we clear
-- its demo rows first.
--
-- Run on the server:
--   cd MedTransport
--   sudo docker compose exec -T db psql -U midtransport -d midtransport < deploy/demo-teardown.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DELETE FROM audit_log
WHERE org_id IN (SELECT id FROM organizations WHERE slug LIKE 'demo-%');

DELETE FROM organizations
WHERE slug LIKE 'demo-%';

COMMIT;

-- Verify nothing remains (should return 0)
SELECT count(*) AS remaining_demo_orgs FROM organizations WHERE slug LIKE 'demo-%';
