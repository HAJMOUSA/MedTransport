#!/usr/bin/env bash
# Local dev seed: creates a driver login + rider + a dispatched trip so the
# mobile driver app has something to exercise. Idempotent-ish (driver user
# upserts by email; a fresh trip is only added if the driver has no open one).
set -euo pipefail

DB_CONTAINER=midtransport_db
API_CONTAINER=midtransport_api
DB_USER=midtransport
DB_NAME=midtransport

DRIVER_EMAIL="driver@example.com"
DRIVER_PASS="Driver1234!"

echo "Computing bcrypt hash inside the api container..."
HASH=$(docker exec "$API_CONTAINER" node -e "console.log(require('bcryptjs').hashSync('$DRIVER_PASS',12))")
echo "hash ok"

SQL=$(cat <<SQL
WITH org AS (
  SELECT id FROM organizations WHERE slug='default' LIMIT 1
),
u AS (
  INSERT INTO users (org_id, email, password_hash, name, role, phone)
  SELECT id, '$DRIVER_EMAIL', '$HASH', 'Test Driver', 'driver', '2075550100' FROM org
  ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, role='driver'
  RETURNING id, org_id
),
d AS (
  INSERT INTO drivers (user_id, org_id, license_number, on_shift)
  SELECT id, org_id, 'DL-TEST-1', true FROM u
  ON CONFLICT (user_id) DO UPDATE SET on_shift = true
  RETURNING id, org_id
),
r AS (
  INSERT INTO riders (org_id, name, phone, home_address, home_lat, home_lng, mobility_type)
  SELECT org_id, 'Jane Rider', '2075550111', '1 Main St, Portland, ME', 43.6591, -70.2568, 'standard' FROM d
  RETURNING id, org_id
)
INSERT INTO trips (org_id, rider_id, driver_id, pickup_address, pickup_lat, pickup_lng,
                   scheduled_pickup_at, dropoff_address, dropoff_lat, dropoff_lng, status, mobility_type)
SELECT d.org_id, r.id, d.id,
       '1 Main St, Portland, ME', 43.6591, -70.2568,
       NOW() + interval '1 hour',
       '22 Monument Sq, Portland, ME', 43.6570, -70.2590,
       'dispatched', 'standard'
FROM d, r;
SQL
)

echo "Seeding driver + rider + trip..."
docker exec -i "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 <<PSQL
$SQL
PSQL

echo
echo "Seed complete. Driver login: $DRIVER_EMAIL / $DRIVER_PASS"
docker exec -i "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -c \
  "SELECT t.id, t.status, r.name AS rider, u.email AS driver FROM trips t JOIN riders r ON r.id=t.rider_id JOIN drivers dr ON dr.id=t.driver_id JOIN users u ON u.id=dr.user_id ORDER BY t.id DESC LIMIT 3;"
