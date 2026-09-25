-- ═══════════════════════════════════════════════════════════════════════════
-- MidTransport DEMO SEED DATA
-- ───────────────────────────────────────────────────────────────────────────
-- ALL demo data lives inside ONE organization (slug 'demo-sunrise', name ends
-- in "(DEMO)"). To remove every trace later, run deploy/demo-teardown.sql —
-- deleting the org cascades to all riders/drivers/vehicles/trips/geofences/etc.
--
-- Re-running this file is safe: it wipes and recreates the demo org each time.
-- Demo login:  demo@sunrise.demo / Demo1234!   (admin)
--              dispatch@sunrise.demo / Demo1234! (dispatcher)
-- All times are relative to NOW() so the board always looks "live today".
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── Clean slate: remove any prior demo org (audit_log has no cascade) ────────
DELETE FROM audit_log     WHERE org_id IN (SELECT id FROM organizations WHERE slug = 'demo-sunrise');
DELETE FROM organizations WHERE slug = 'demo-sunrise';

-- ── Organization ─────────────────────────────────────────────────────────────
INSERT INTO organizations (name, slug, email, phone, address, timezone)
VALUES ('Sunrise Medical Transport (DEMO)', 'demo-sunrise', 'dispatch@sunrise.demo',
        '(804) 555-0100', '100 Main St, Richmond, VA 23219', 'America/New_York');

-- ── Users (admin, dispatcher, 4 drivers) — password: Demo1234! ───────────────
INSERT INTO users (org_id, email, password_hash, name, role, phone)
SELECT o.id, x.email, crypt('Demo1234!', gen_salt('bf', 12)), x.name, x.role::user_role, x.phone
FROM   organizations o,
       (VALUES
         ('demo@sunrise.demo',          'Dana Owens',      'admin',      '(804) 555-0101'),
         ('dispatch@sunrise.demo',      'Riley Chen',      'dispatcher', '(804) 555-0102'),
         ('marcus.driver@sunrise.demo', 'Marcus Bell',     'driver',     '(804) 555-0111'),
         ('latoya.driver@sunrise.demo', 'Latoya Jackson',  'driver',     '(804) 555-0112'),
         ('danny.driver@sunrise.demo',  'Danny Kowalski',  'driver',     '(804) 555-0113'),
         ('priya.driver@sunrise.demo',  'Priya Patel',     'driver',     '(804) 555-0114')
       ) AS x(email, name, role, phone)
WHERE  o.slug = 'demo-sunrise';

-- ── Vehicles ─────────────────────────────────────────────────────────────────
INSERT INTO vehicles (org_id, name, license_plate, vehicle_type, capacity, make, model, year, color)
SELECT o.id, x.name, x.plate, x.vtype::vehicle_type, x.cap, x.make, x.model, x.year, x.color
FROM   organizations o,
       (VALUES
         ('Sedan 1',          'SUN-101', 'sedan',          3, 'Toyota',        'Camry',         2022, 'White'),
         ('Wheelchair Van 1', 'SUN-201', 'wheelchair_van', 2, 'Ford',          'Transit',       2021, 'Blue'),
         ('Van 2',            'SUN-202', 'van',            5, 'Dodge',         'Grand Caravan', 2020, 'Silver'),
         ('Stretcher Van 1',  'SUN-301', 'stretcher_van',  1, 'Mercedes-Benz', 'Sprinter',      2023, 'White'),
         ('Sedan 2',          'SUN-102', 'sedan',          3, 'Honda',         'Accord',        2021, 'Black')
       ) AS x(name, plate, vtype, cap, make, model, year, color)
WHERE  o.slug = 'demo-sunrise';

-- ── Drivers (link user → vehicle) ────────────────────────────────────────────
INSERT INTO drivers (user_id, org_id, vehicle_id, license_number, license_expiry, on_shift, shift_started_at)
SELECT u.id, u.org_id, v.id, d.lic, d.exp::date, d.shift,
       CASE WHEN d.shift THEN now() - interval '3 hours' ELSE NULL END
FROM   (VALUES
         ('marcus.driver@sunrise.demo', 'Wheelchair Van 1', 'VA-DL-44710', '2027-06-30', true),
         ('latoya.driver@sunrise.demo', 'Sedan 1',          'VA-DL-51820', '2026-11-30', true),
         ('danny.driver@sunrise.demo',  'Van 2',            'VA-DL-33920', '2027-02-28', true),
         ('priya.driver@sunrise.demo',  'Stretcher Van 1',  'VA-DL-62410', '2028-01-31', false)
       ) AS d(email, vehicle_name, lic, exp, shift)
JOIN   users u          ON u.email = d.email
JOIN   organizations o  ON o.id = u.org_id AND o.slug = 'demo-sunrise'
LEFT   JOIN vehicles v  ON v.org_id = o.id AND v.name = d.vehicle_name;

-- ── Riders (contact info only — no medical records) ──────────────────────────
INSERT INTO riders (org_id, name, first_name, last_name, phone, phone_alt, email,
                    home_address, home_lat, home_lng, emergency_contact, emergency_phone,
                    mobility_type, dispatcher_notes)
SELECT o.id, x.name, x.first, x.last, x.phone, x.phone_alt, x.email,
       x.addr, x.lat, x.lng, x.emg, x.emgp, x.mob::mobility_type, NULLIF(x.notes, '')
FROM   organizations o,
       (VALUES
         ('Eleanor Whitfield','Eleanor','Whitfield','(804) 555-0201',NULL::varchar,NULL::varchar,'4210 Monument Ave, Richmond, VA 23230',37.55800,-77.48200,'Susan Whitfield','(804) 555-0301','wheelchair','Prefers side-door pickup'),
         ('Harold Simmons','Harold','Simmons','(804) 555-0202',NULL,NULL,'812 N 25th St, Richmond, VA 23223',37.53350,-77.42000,'Grace Simmons','(804) 555-0302','standard',''),
         ('Gloria Nguyen','Gloria','Nguyen','(804) 555-0203',NULL,NULL,'2100 Hull St, Richmond, VA 23224',37.51550,-77.45250,'Tom Nguyen','(804) 555-0303','standard','Daughter is primary contact'),
         ('Delores Bryant','Delores','Bryant','(804) 555-0204',NULL,NULL,'5500 Patterson Ave, Richmond, VA 23226',37.57600,-77.50900,'Michael Bryant','(804) 555-0304','wheelchair','Wheelchair securement required'),
         ('Walter Franklin','Walter','Franklin','(804) 555-0205',NULL,NULL,'1000 Westwood Ave, Richmond, VA 23227',37.58600,-77.45600,'Anita Franklin','(804) 555-0305','stretcher','Bed-to-bed transfer'),
         ('Mabel Carter','Mabel','Carter','(804) 555-0206',NULL,NULL,'300 W Broad St, Richmond, VA 23220',37.54700,-77.44700,'Joan Carter','(804) 555-0306','standard',''),
         ('Raymond Ortiz','Raymond','Ortiz','(804) 555-0207',NULL,NULL,'6200 Jahnke Rd, Richmond, VA 23225',37.52100,-77.51200,'Elena Ortiz','(804) 555-0307','bariatric','Bariatric equipment needed'),
         ('Josephine Reed','Josephine','Reed','(804) 555-0208',NULL,NULL,'900 Lombardy St, Richmond, VA 23220',37.55200,-77.45600,'Carl Reed','(804) 555-0308','wheelchair','Meet at building lobby'),
         ('Clifford Hayes','Clifford','Hayes','(804) 555-0209',NULL,NULL,'4500 Forest Hill Ave, Richmond, VA 23225',37.52850,-77.49300,'Denise Hayes','(804) 555-0309','standard',''),
         ('Beatrice Long','Beatrice','Long','(804) 555-0210',NULL,NULL,'1700 Chamberlayne Ave, Richmond, VA 23222',37.57200,-77.43600,'Harold Long','(804) 555-0310','standard','')
       ) AS x(name, first, last, phone, phone_alt, email, addr, lat, lng, emg, emgp, mob, notes)
WHERE  o.slug = 'demo-sunrise';

-- ── Geofences (common destinations with arrival zones) ───────────────────────
INSERT INTO geofences (org_id, name, address, latitude, longitude, radius_m)
SELECT o.id, x.name, x.addr, x.lat, x.lng, x.radius
FROM   organizations o,
       (VALUES
         ('VCU Medical Center',            '1250 E Marshall St, Richmond, VA 23298', 37.54073, -77.42704, 120),
         ('Fresenius Kidney Care',         '5400 W Broad St, Richmond, VA 23230',    37.59010, -77.49990, 100),
         ('Bon Secours St. Mary''s Hospital','5801 Bremo Rd, Richmond, VA 23226',    37.58540, -77.51480, 150),
         ('Richmond Community Hospital',   '1500 N 28th St, Richmond, VA 23223',     37.54690, -77.41520, 120),
         ('Family Practice Clinic',        '8100 Midlothian Tpke, Richmond, VA 23235',37.50990, -77.56010, 100)
       ) AS x(name, addr, lat, lng, radius)
WHERE  o.slug = 'demo-sunrise';

-- ── Trips (every status; times relative to NOW) ──────────────────────────────
INSERT INTO trips (org_id, rider_id, driver_id, vehicle_id,
                   pickup_address, pickup_lat, pickup_lng, scheduled_pickup_at, will_call,
                   dropoff_address, dropoff_lat, dropoff_lng, scheduled_dropoff_at,
                   actual_pickup_at, actual_dropoff_at,
                   status, mobility_type, level_of_service, dispatcher_notes,
                   distance_miles, duration_minutes, external_trip_id, created_by)
SELECT o.id, r.id, dr.id, dr.vehicle_id,
       t.paddr, t.plat, t.plng,
       CASE WHEN t.will_call THEN NULL ELSE now() + (t.pickup_off || ' minutes')::interval END,
       t.will_call,
       t.daddr, t.dlat, t.dlng,
       CASE WHEN t.will_call THEN NULL ELSE now() + ((t.pickup_off + t.dur) || ' minutes')::interval END,
       CASE WHEN t.apick IS NULL THEN NULL ELSE now() + (t.apick || ' minutes')::interval END,
       CASE WHEN t.adrop IS NULL THEN NULL ELSE now() + (t.adrop || ' minutes')::interval END,
       t.pstatus::trip_status, t.pmob::mobility_type, t.los, NULLIF(t.notes, ''),
       t.dist, t.dur, t.ext, disp.id
FROM   (VALUES
  -- ext,      rider,               driver_email,                  mob,          status,             wc,    pickup addr / lat / lng,                                        dropoff addr / lat / lng,                                              poff, dur, dist, los,          notes,                                          apick, adrop
  ('DEMO-1001','Harold Simmons',    'latoya.driver@sunrise.demo',  'standard',   'completed',        false, '812 N 25th St, Richmond, VA 23223',37.53350,-77.42000,        'VCU Medical Center, 1250 E Marshall St, Richmond, VA 23298',37.54073,-77.42704, -300,25,3.10,'AMB',       'On-time pickup',                              -300,-275),
  ('DEMO-1002','Mabel Carter',      'danny.driver@sunrise.demo',   'standard',   'completed',        false, '300 W Broad St, Richmond, VA 23220',37.54700,-77.44700,       'Family Practice Clinic, 8100 Midlothian Tpke, Richmond, VA 23235',37.50990,-77.56010, -240,35,9.40,'AMB','Routine appointment',                         -240,-205),
  ('DEMO-1003','Eleanor Whitfield', 'marcus.driver@sunrise.demo',  'wheelchair', 'completed',        false, '4210 Monument Ave, Richmond, VA 23230',37.55800,-77.48200,    'Fresenius Kidney Care, 5400 W Broad St, Richmond, VA 23230',37.59010,-77.49990, -210,20,2.60,'WHEELCHAIR','Dialysis M/W/F',                          -210,-190),
  ('DEMO-1004','Clifford Hayes',    'latoya.driver@sunrise.demo',  'standard',   'completed',        false, '4500 Forest Hill Ave, Richmond, VA 23225',37.52850,-77.49300, 'VCU Medical Center, 1250 E Marshall St, Richmond, VA 23298',37.54073,-77.42704, -180,22,5.00,'AMB',       '',                                            -180,-158),
  ('DEMO-1005','Beatrice Long',     'danny.driver@sunrise.demo',   'standard',   'completed',        false, '1700 Chamberlayne Ave, Richmond, VA 23222',37.57200,-77.43600,'Richmond Community Hospital, 1500 N 28th St, Richmond, VA 23223',37.54690,-77.41520, -150,18,2.40,'AMB', '',                                            -150,-132),
  ('DEMO-1006','Delores Bryant',    'marcus.driver@sunrise.demo',  'wheelchair', 'en_route_dropoff', false, '5500 Patterson Ave, Richmond, VA 23226',37.57600,-77.50900,   'Bon Secours St. Mary''s Hospital, 5801 Bremo Rd, Richmond, VA 23226',37.58540,-77.51480, -35,15,1.90,'WHEELCHAIR','Wheelchair securement required',        -30,NULL),
  ('DEMO-1007','Gloria Nguyen',     'latoya.driver@sunrise.demo',  'standard',   'arrived_pickup',   false, '2100 Hull St, Richmond, VA 23224',37.51550,-77.45250,         'VCU Medical Center, 1250 E Marshall St, Richmond, VA 23298',37.54073,-77.42704, -5,18,2.30,'AMB',        'Meet rider at lobby',                         NULL,NULL),
  ('DEMO-1008','Raymond Ortiz',     'danny.driver@sunrise.demo',   'bariatric',  'en_route_pickup',  false, '6200 Jahnke Rd, Richmond, VA 23225',37.52100,-77.51200,       'Family Practice Clinic, 8100 Midlothian Tpke, Richmond, VA 23235',37.50990,-77.56010, 10,28,6.20,'BARIATRIC','Bariatric transport',                     NULL,NULL),
  ('DEMO-1009','Walter Franklin',   NULL,                          'stretcher',  'scheduled',        false, '1000 Westwood Ave, Richmond, VA 23227',37.58600,-77.45600,    'VCU Medical Center, 1250 E Marshall St, Richmond, VA 23298',37.54073,-77.42704, 45,25,4.10,'STRETCHER',   'Requires stretcher; bed-to-bed',              NULL,NULL),
  ('DEMO-1010','Josephine Reed',    NULL,                          'wheelchair', 'scheduled',        false, '900 Lombardy St, Richmond, VA 23220',37.55200,-77.45600,      'Fresenius Kidney Care, 5400 W Broad St, Richmond, VA 23230',37.59010,-77.49990, 60,22,3.80,'WHEELCHAIR', '',                                            NULL,NULL),
  ('DEMO-1011','Delores Bryant',    'marcus.driver@sunrise.demo',  'wheelchair', 'dispatched',       false, 'Bon Secours St. Mary''s Hospital, 5801 Bremo Rd, Richmond, VA 23226',37.58540,-77.51480,'5500 Patterson Ave, Richmond, VA 23226',37.57600,-77.50900, 120,15,1.90,'WHEELCHAIR','Return leg',                              NULL,NULL),
  ('DEMO-1012','Harold Simmons',    'latoya.driver@sunrise.demo',  'standard',   'dispatched',       false, 'VCU Medical Center, 1250 E Marshall St, Richmond, VA 23298',37.54073,-77.42704,'812 N 25th St, Richmond, VA 23223',37.53350,-77.42000, 150,25,3.10,'AMB',        'Return leg',                                  NULL,NULL),
  ('DEMO-1013','Beatrice Long',     'danny.driver@sunrise.demo',   'standard',   'dispatched',       false, 'Richmond Community Hospital, 1500 N 28th St, Richmond, VA 23223',37.54690,-77.41520,'1700 Chamberlayne Ave, Richmond, VA 23222',37.57200,-77.43600, 180,18,2.40,'AMB','Return leg',                                  NULL,NULL),
  ('DEMO-1014','Clifford Hayes',    NULL,                          'standard',   'scheduled',        true,  'VCU Medical Center, 1250 E Marshall St, Richmond, VA 23298',37.54073,-77.42704,'4500 Forest Hill Ave, Richmond, VA 23225',37.52850,-77.49300, 0,22,5.00,'AMB',       'Will-call return; rider calls when discharged',NULL,NULL),
  ('DEMO-1015','Mabel Carter',      NULL,                          'standard',   'scheduled',        true,  'Family Practice Clinic, 8100 Midlothian Tpke, Richmond, VA 23235',37.50990,-77.56010,'300 W Broad St, Richmond, VA 23220',37.54700,-77.44700, 0,35,9.40,'AMB',    'Will-call return',                            NULL,NULL),
  ('DEMO-1016','Raymond Ortiz',     NULL,                          'bariatric',  'cancelled',        false, '6200 Jahnke Rd, Richmond, VA 23225',37.52100,-77.51200,       'VCU Medical Center, 1250 E Marshall St, Richmond, VA 23298',37.54073,-77.42704, -400,28,6.20,'BARIATRIC','Cancelled by facility',                     NULL,NULL),
  ('DEMO-1017','Gloria Nguyen',     'latoya.driver@sunrise.demo',  'standard',   'no_show',          false, '2100 Hull St, Richmond, VA 23224',37.51550,-77.45250,         'Family Practice Clinic, 8100 Midlothian Tpke, Richmond, VA 23235',37.50990,-77.56010, -350,30,7.10,'AMB','Rider not present at pickup',              NULL,NULL)
       ) AS t(ext, rider_name, driver_email, pmob, pstatus, will_call,
              paddr, plat, plng, daddr, dlat, dlng, pickup_off, dur, dist, los, notes, apick, adrop)
JOIN   organizations o  ON o.slug = 'demo-sunrise'
JOIN   riders r         ON r.org_id = o.id AND r.name = t.rider_name
LEFT   JOIN users du    ON du.org_id = o.id AND du.email = t.driver_email
LEFT   JOIN drivers dr  ON dr.user_id = du.id
LEFT   JOIN users disp  ON disp.org_id = o.id AND disp.email = 'dispatch@sunrise.demo';

-- ── Live driver GPS positions (for the on-shift drivers) ─────────────────────
INSERT INTO driver_locations (driver_id, trip_id, latitude, longitude, speed_mph, heading_deg, accuracy_m, recorded_at)
SELECT dr.id, NULL, l.lat, l.lng, l.spd, l.hd, 8, now() + (l.off || ' minutes')::interval
FROM   (VALUES
         ('marcus.driver@sunrise.demo', 37.58200, -77.51350, 24.0, 300, -2),
         ('marcus.driver@sunrise.demo', 37.58400, -77.51420, 18.0, 305, -1),
         ('latoya.driver@sunrise.demo', 37.51560, -77.45260,  0.0,   0, -1),
         ('danny.driver@sunrise.demo',  37.52500, -77.50000, 32.0, 210, -2),
         ('danny.driver@sunrise.demo',  37.52300, -77.50600, 28.0, 215, -1)
       ) AS l(driver_email, lat, lng, spd, hd, off)
JOIN   users du   ON du.email = l.driver_email
JOIN   drivers dr ON dr.user_id = du.id;

COMMIT;

-- ── Summary ──────────────────────────────────────────────────────────────────
SELECT 'organizations' AS entity, count(*) FROM organizations WHERE slug='demo-sunrise'
UNION ALL SELECT 'users',    count(*) FROM users    WHERE org_id=(SELECT id FROM organizations WHERE slug='demo-sunrise')
UNION ALL SELECT 'vehicles', count(*) FROM vehicles WHERE org_id=(SELECT id FROM organizations WHERE slug='demo-sunrise')
UNION ALL SELECT 'drivers',  count(*) FROM drivers  WHERE org_id=(SELECT id FROM organizations WHERE slug='demo-sunrise')
UNION ALL SELECT 'riders',   count(*) FROM riders   WHERE org_id=(SELECT id FROM organizations WHERE slug='demo-sunrise')
UNION ALL SELECT 'geofences',count(*) FROM geofences WHERE org_id=(SELECT id FROM organizations WHERE slug='demo-sunrise')
UNION ALL SELECT 'trips',    count(*) FROM trips    WHERE org_id=(SELECT id FROM organizations WHERE slug='demo-sunrise')
UNION ALL SELECT 'driver_locations', count(*) FROM driver_locations dl JOIN drivers d ON d.id=dl.driver_id WHERE d.org_id=(SELECT id FROM organizations WHERE slug='demo-sunrise');
