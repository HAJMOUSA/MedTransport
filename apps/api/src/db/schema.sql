-- MidTransport Database Schema
-- PostgreSQL 16 + PostGIS 3.4
-- Privacy-first: stores PII (contact info) only — NO medical records

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─────────────────────────────────────────────────────────────────────────────
-- ORGANIZATIONS (multi-tenant ready from day 1)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS organizations (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(200) NOT NULL,
  slug        VARCHAR(100) UNIQUE NOT NULL,
  phone       VARCHAR(20),
  address     TEXT,
  email       VARCHAR(200),
  created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- USERS (dispatchers, admins, drivers)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TYPE user_role AS ENUM ('admin', 'dispatcher', 'driver');

CREATE TABLE IF NOT EXISTS users (
  id              SERIAL PRIMARY KEY,
  org_id          INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email           VARCHAR(200) UNIQUE NOT NULL,
  password_hash   VARCHAR(255) NOT NULL,
  name            VARCHAR(200) NOT NULL,
  role            user_role NOT NULL DEFAULT 'dispatcher',
  phone           VARCHAR(20),
  is_active       BOOLEAN DEFAULT TRUE,
  last_login_at   TIMESTAMP WITH TIME ZONE,
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX idx_users_org ON users(org_id);
CREATE INDEX idx_users_email ON users(email);

-- ─────────────────────────────────────────────────────────────────────────────
-- REFRESH TOKENS
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  VARCHAR(255) UNIQUE NOT NULL,
  expires_at  TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX idx_refresh_tokens_user ON refresh_tokens(user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- RIDERS (contact info ONLY — no medical records)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TYPE mobility_type AS ENUM ('standard', 'wheelchair', 'stretcher', 'bariatric');

CREATE TABLE IF NOT EXISTS riders (
  id                  SERIAL PRIMARY KEY,
  org_id              INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name                VARCHAR(200) NOT NULL,
  phone               VARCHAR(20) NOT NULL,
  phone_alt           VARCHAR(20),
  email               VARCHAR(200),
  home_address        TEXT,
  home_lat            DECIMAL(10, 8),
  home_lng            DECIMAL(11, 8),
  emergency_contact   VARCHAR(200),
  emergency_phone     VARCHAR(20),
  mobility_type       mobility_type DEFAULT 'standard',
  -- Operational notes ONLY (e.g., "prefers pickup at side door") — NOT medical
  dispatcher_notes    TEXT,
  is_active           BOOLEAN DEFAULT TRUE,
  created_at          TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at          TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX idx_riders_org ON riders(org_id);
CREATE INDEX idx_riders_phone ON riders(phone);
CREATE INDEX idx_riders_name ON riders(name);

-- ─────────────────────────────────────────────────────────────────────────────
-- VEHICLES
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TYPE vehicle_type AS ENUM ('sedan', 'suv', 'van', 'wheelchair_van', 'stretcher_van', 'bus');

CREATE TABLE IF NOT EXISTS vehicles (
  id              SERIAL PRIMARY KEY,
  org_id          INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            VARCHAR(100) NOT NULL,
  license_plate   VARCHAR(20) NOT NULL,
  vehicle_type    vehicle_type DEFAULT 'sedan',
  capacity        INTEGER DEFAULT 1,
  make            VARCHAR(50),
  model           VARCHAR(50),
  year            INTEGER,
  color           VARCHAR(50),
  is_active       BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX idx_vehicles_org ON vehicles(org_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- DRIVERS (users with role='driver' + driver-specific fields)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS drivers (
  id                  SERIAL PRIMARY KEY,
  user_id             INTEGER UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id              INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  vehicle_id          INTEGER REFERENCES vehicles(id),
  license_number      VARCHAR(50),
  license_expiry      DATE,
  on_shift            BOOLEAN DEFAULT FALSE,
  shift_started_at    TIMESTAMP WITH TIME ZONE,
  created_at          TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at          TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX idx_drivers_org ON drivers(org_id);
CREATE INDEX idx_drivers_user ON drivers(user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- TRIPS
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TYPE trip_status AS ENUM (
  'scheduled',
  'dispatched',
  'en_route_pickup',
  'arrived_pickup',
  'picked_up',
  'en_route_dropoff',
  'arrived_dropoff',
  'completed',
  'cancelled',
  'no_show'
);

CREATE TABLE IF NOT EXISTS trips (
  id                    SERIAL PRIMARY KEY,
  org_id                INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  rider_id              INTEGER NOT NULL REFERENCES riders(id),
  driver_id             INTEGER REFERENCES drivers(id),
  vehicle_id            INTEGER REFERENCES vehicles(id),

  -- Pickup details
  pickup_address        TEXT NOT NULL,
  pickup_lat            DECIMAL(10, 8),
  pickup_lng            DECIMAL(11, 8),
  scheduled_pickup_at   TIMESTAMP WITH TIME ZONE NOT NULL,
  actual_pickup_at      TIMESTAMP WITH TIME ZONE,

  -- Dropoff details
  dropoff_address       TEXT NOT NULL,
  dropoff_lat           DECIMAL(10, 8),
  dropoff_lng           DECIMAL(11, 8),
  scheduled_dropoff_at  TIMESTAMP WITH TIME ZONE,
  actual_dropoff_at     TIMESTAMP WITH TIME ZONE,

  -- Trip state
  status                trip_status DEFAULT 'scheduled',
  mobility_type         mobility_type DEFAULT 'standard',

  -- Recurring trip
  is_recurring          BOOLEAN DEFAULT FALSE,
  recurrence_rule       VARCHAR(100), -- e.g. "FREQ=WEEKLY;BYDAY=MO,WE,FR"
  parent_trip_id        INTEGER REFERENCES trips(id),

  -- Operational
  dispatcher_notes      TEXT,
  distance_miles        DECIMAL(8, 2),
  duration_minutes      INTEGER,

  created_by            INTEGER REFERENCES users(id),
  created_at            TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at            TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX idx_trips_org ON trips(org_id);
CREATE INDEX idx_trips_rider ON trips(rider_id);
CREATE INDEX idx_trips_driver ON trips(driver_id);
CREATE INDEX idx_trips_status ON trips(status);
CREATE INDEX idx_trips_pickup_time ON trips(scheduled_pickup_at);

-- ─────────────────────────────────────────────────────────────────────────────
-- DRIVER LOCATIONS (real-time GPS tracking)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS driver_locations (
  id              BIGSERIAL PRIMARY KEY,
  driver_id       INTEGER NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  trip_id         INTEGER REFERENCES trips(id),
  latitude        DECIMAL(10, 8) NOT NULL,
  longitude       DECIMAL(11, 8) NOT NULL,
  -- PostGIS geography point for geofence queries
  geog            GEOGRAPHY(POINT, 4326) GENERATED ALWAYS AS (
                    ST_MakePoint(longitude, latitude)::geography
                  ) STORED,
  speed_mph       DECIMAL(5, 1),
  heading_deg     SMALLINT,          -- 0-359 degrees
  accuracy_m      SMALLINT,          -- GPS accuracy in meters
  recorded_at     TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX idx_driver_locations_driver ON driver_locations(driver_id, recorded_at DESC);
CREATE INDEX idx_driver_locations_trip ON driver_locations(trip_id, recorded_at DESC);
-- Spatial index for geofence queries
CREATE INDEX idx_driver_locations_geog ON driver_locations USING GIST(geog);

-- ─────────────────────────────────────────────────────────────────────────────
-- GEOFENCES (destinations with arrival detection zones)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS geofences (
  id              SERIAL PRIMARY KEY,
  org_id          INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            VARCHAR(200),
  address         TEXT NOT NULL,
  latitude        DECIMAL(10, 8) NOT NULL,
  longitude       DECIMAL(11, 8) NOT NULL,
  radius_m        INTEGER DEFAULT 100,   -- arrival detection radius in meters
  geog            GEOGRAPHY(POINT, 4326) GENERATED ALWAYS AS (
                    ST_MakePoint(longitude, latitude)::geography
                  ) STORED,
  is_active       BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX idx_geofences_org ON geofences(org_id);
CREATE INDEX idx_geofences_geog ON geofences USING GIST(geog);

-- ─────────────────────────────────────────────────────────────────────────────
-- OTP EVENTS (smart pickup/dropoff verification)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TYPE otp_event_type AS ENUM ('pickup', 'dropoff');
CREATE TYPE otp_status AS ENUM ('pending', 'verified', 'expired', 'fallback_photo');

CREATE TABLE IF NOT EXISTS otp_events (
  id              SERIAL PRIMARY KEY,
  trip_id         INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  driver_id       INTEGER NOT NULL REFERENCES drivers(id),
  event_type      otp_event_type NOT NULL,
  rider_phone     VARCHAR(20) NOT NULL,
  otp_hash        VARCHAR(255) NOT NULL,  -- bcrypt hash; plain OTP never stored
  -- GPS at time of OTP trigger
  trigger_lat     DECIMAL(10, 8),
  trigger_lng     DECIMAL(11, 8),
  -- Verification result
  status          otp_status DEFAULT 'pending',
  verified_at     TIMESTAMP WITH TIME ZONE,
  -- For fallback photo
  photo_filename  VARCHAR(255),
  -- Expiry
  expires_at      TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX idx_otp_events_trip ON otp_events(trip_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- AUDIT LOG (immutable log of all data access + trip events)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
  id              BIGSERIAL PRIMARY KEY,
  org_id          INTEGER REFERENCES organizations(id),
  user_id         INTEGER REFERENCES users(id),
  user_role       VARCHAR(50),
  entity_type     VARCHAR(50) NOT NULL,  -- 'trip', 'rider', 'driver', 'otp', 'auth'
  entity_id       INTEGER,
  action          VARCHAR(50) NOT NULL,  -- 'created', 'updated', 'viewed', 'deleted', 'otp_sent', 'otp_verified', 'login'
  details         JSONB,                 -- additional context (changed fields, etc.)
  ip_address      INET,
  user_agent      TEXT,
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX idx_audit_log_org ON audit_log(org_id, created_at DESC);
CREATE INDEX idx_audit_log_entity ON audit_log(entity_type, entity_id);
CREATE INDEX idx_audit_log_user ON audit_log(user_id, created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- CSV IMPORT LOG
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS import_jobs (
  id              SERIAL PRIMARY KEY,
  org_id          INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  imported_by     INTEGER REFERENCES users(id),
  import_type     VARCHAR(50) NOT NULL,  -- 'riders' or 'trips'
  filename        VARCHAR(255),
  total_rows      INTEGER DEFAULT 0,
  imported_rows   INTEGER DEFAULT 0,
  skipped_rows    INTEGER DEFAULT 0,
  error_rows      INTEGER DEFAULT 0,
  errors          JSONB,                 -- array of { row, error } objects
  status          VARCHAR(20) DEFAULT 'processing',  -- processing/completed/failed
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  completed_at    TIMESTAMP WITH TIME ZONE
);
CREATE INDEX idx_import_jobs_org ON import_jobs(org_id, created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- SEED: Default organization for single-tenant deployment
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO organizations (name, slug, email)
VALUES ('My Transport Company', 'default', 'admin@example.com')
ON CONFLICT (slug) DO NOTHING;

-- Seed default admin user (password: Admin1234! — change after first login)
INSERT INTO users (org_id, email, password_hash, name, role)
SELECT o.id,
       'admin@example.com',
       crypt('Admin1234!', gen_salt('bf', 12)),
       'Admin User',
       'admin'
FROM   organizations o
WHERE  o.slug = 'default'
ON CONFLICT (email) DO NOTHING;
