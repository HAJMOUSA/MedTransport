/**
 * Database migration runner.
 * The schema is auto-applied by PostgreSQL via docker-entrypoint-initdb.d
 * This script can be used to apply incremental migrations in the future.
 */
import 'dotenv/config';
import { db } from './pool';
import { logger } from '../lib/logger';
import fs from 'fs';
import path from 'path';

async function migrate() {
  logger.info('Running database migrations...');

  try {
    // Test connection
    await db.query('SELECT 1');
    logger.info('Database connection established');

    // Apply schema if FORCE_MIGRATE env var is set
    if (process.env.FORCE_MIGRATE === 'true') {
      const schemaPath = path.join(__dirname, 'schema.sql');
      if (fs.existsSync(schemaPath)) {
        const sql = fs.readFileSync(schemaPath, 'utf8');
        await db.query(sql);
        logger.info('Schema applied successfully');
      }
    }

    // Seed admin user if none exists
    const existing = await db.query(
      "SELECT id FROM users WHERE role = 'admin' LIMIT 1"
    );

    if (existing.rows.length === 0) {
      const bcrypt = await import('bcryptjs');
      const passwordHash = await bcrypt.hash('Admin1234!', 12);

      // Ensure default org exists
      await db.query(`
        INSERT INTO organizations (name, slug, email)
        VALUES ('My Transport Company', 'default', 'admin@example.com')
        ON CONFLICT (slug) DO NOTHING
      `);

      const org = await db.query(
        "SELECT id FROM organizations WHERE slug = 'default' LIMIT 1"
      );
      const orgId = org.rows[0]?.id;

      if (orgId) {
        await db.query(
          `INSERT INTO users (org_id, email, password_hash, name, role)
           VALUES ($1, 'admin@example.com', $2, 'Admin User', 'admin')
           ON CONFLICT (email) DO NOTHING`,
          [orgId, passwordHash]
        );
        logger.info('Default admin user created: admin@example.com / Admin1234!');
        logger.info('IMPORTANT: Change the default password after first login!');

        // Seed sample riders for first-run demo
        await db.query(`
          INSERT INTO riders (org_id, name, phone, home_address, mobility_type)
          VALUES
            ($1, 'Mary Johnson',   '(555) 100-0001', '123 Oak Street, Springfield, IL 62701',    'standard'),
            ($1, 'Robert Davis',   '(555) 100-0002', '456 Maple Ave, Springfield, IL 62702',     'wheelchair'),
            ($1, 'Linda Martinez', '(555) 100-0003', '789 Pine Rd, Springfield, IL 62703',       'standard'),
            ($1, 'James Wilson',   '(555) 100-0004', '321 Elm Blvd, Springfield, IL 62704',      'bariatric'),
            ($1, 'Patricia Brown', '(555) 100-0005', '654 Cedar Lane, Springfield, IL 62705',    'standard')
          ON CONFLICT DO NOTHING
        `, [orgId]);
        logger.info('Sample riders seeded (5 riders)');
      }
    } else {
      logger.info('Admin user already exists, skipping seed');
    }

    // ── Incremental schema migrations ──────────────────────────────────────
    // Add insurance fields to riders (safe: IF NOT EXISTS)
    await db.query(`
      ALTER TABLE riders
        ADD COLUMN IF NOT EXISTS insurance_id   VARCHAR(100),
        ADD COLUMN IF NOT EXISTS insurance_name VARCHAR(100)
    `);
    logger.info('Schema migrations applied');

    // Trip import feature: canonical trip fields + vendor profiles + LOS + uploads
    await db.query(`
      ALTER TABLE organizations ADD COLUMN IF NOT EXISTS timezone VARCHAR(50) NOT NULL DEFAULT 'America/New_York';

      ALTER TABLE riders
        ADD COLUMN IF NOT EXISTS first_name VARCHAR(100),
        ADD COLUMN IF NOT EXISTS last_name  VARCHAR(100),
        ADD COLUMN IF NOT EXISTS date_of_birth DATE,
        ADD COLUMN IF NOT EXISTS medical_id VARCHAR(50);

      ALTER TABLE trips
        ADD COLUMN IF NOT EXISTS external_trip_id VARCHAR(100),
        ADD COLUMN IF NOT EXISTS appointment_at TIMESTAMP WITH TIME ZONE,
        ADD COLUMN IF NOT EXISTS level_of_service VARCHAR(20),
        ADD COLUMN IF NOT EXISTS additional_passengers INTEGER DEFAULT 0,
        ADD COLUMN IF NOT EXISTS assistance_needs TEXT,
        ADD COLUMN IF NOT EXISTS trip_type VARCHAR(50),
        ADD COLUMN IF NOT EXISTS source_vendor_profile_id INTEGER,
        ADD COLUMN IF NOT EXISTS import_job_id INTEGER,
        ADD COLUMN IF NOT EXISTS will_call BOOLEAN NOT NULL DEFAULT FALSE;

      -- Will-call trips have no scheduled pickup time (idempotent)
      ALTER TABLE trips ALTER COLUMN scheduled_pickup_at DROP NOT NULL;

      CREATE TABLE IF NOT EXISTS vendor_profiles (
        id SERIAL PRIMARY KEY,
        org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        name VARCHAR(200) NOT NULL,
        is_active BOOLEAN DEFAULT TRUE,
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        UNIQUE (org_id, name)
      );

      CREATE TABLE IF NOT EXISTS vendor_profile_versions (
        id SERIAL PRIMARY KEY,
        profile_id INTEGER NOT NULL REFERENCES vendor_profiles(id) ON DELETE CASCADE,
        version INTEGER NOT NULL,
        config JSONB NOT NULL,
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        UNIQUE (profile_id, version)
      );

      DO $$ BEGIN
        ALTER TABLE trips ADD CONSTRAINT trips_vendor_profile_fk
          FOREIGN KEY (source_vendor_profile_id) REFERENCES vendor_profiles(id);
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;

      CREATE TABLE IF NOT EXISTS levels_of_service (
        id SERIAL PRIMARY KEY,
        org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        code VARCHAR(20) NOT NULL,
        label VARCHAR(100) NOT NULL,
        is_active BOOLEAN DEFAULT TRUE,
        UNIQUE (org_id, code)
      );

      CREATE TABLE IF NOT EXISTS import_uploads (
        id SERIAL PRIMARY KEY,
        org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        uploaded_by INTEGER REFERENCES users(id),
        filename VARCHAR(255),
        sha256 CHAR(64) NOT NULL,
        content BYTEA NOT NULL,
        detected_encoding VARCHAR(20),
        row_count INTEGER,
        expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_import_uploads_org ON import_uploads(org_id, created_at DESC);

      ALTER TABLE import_jobs
        ADD COLUMN IF NOT EXISTS mode VARCHAR(20),
        ADD COLUMN IF NOT EXISTS file_hash CHAR(64),
        ADD COLUMN IF NOT EXISTS vendor_profile_version_id INTEGER REFERENCES vendor_profile_versions(id),
        ADD COLUMN IF NOT EXISTS updated_rows INTEGER DEFAULT 0,
        ADD COLUMN IF NOT EXISTS duplicate_rows INTEGER DEFAULT 0,
        ADD COLUMN IF NOT EXISTS duplicate_policy VARCHAR(20),
        ADD COLUMN IF NOT EXISTS result_trip_ids INTEGER[];

      CREATE UNIQUE INDEX IF NOT EXISTS trips_external_id_unique
        ON trips (org_id, source_vendor_profile_id, external_trip_id)
        WHERE external_trip_id IS NOT NULL;
    `);

    await db.query(
      `UPDATE organizations SET timezone = $1 WHERE slug = 'default' AND timezone = 'America/New_York'`,
      [process.env.ORG_TIMEZONE || 'America/New_York']
    );

    await db.query(
      `INSERT INTO levels_of_service (org_id, code, label)
       SELECT o.id, x.code, x.label FROM organizations o
       CROSS JOIN (VALUES ('AMB','Ambulatory'), ('STR','Stretcher'), ('WCH','Wheelchair')) AS x(code, label)
       WHERE NOT EXISTS (SELECT 1 FROM levels_of_service l WHERE l.org_id = o.id)`
    );
    logger.info('Trip import schema applied');

    // Trip events (signature / proof / no-show / cancellation audit log)
    await db.query(`
      DO $$ BEGIN
        CREATE TYPE trip_event_type AS ENUM ('signature', 'proof_photo', 'no_show', 'cancellation');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;

      CREATE TABLE IF NOT EXISTS trip_events (
        id            SERIAL PRIMARY KEY,
        org_id        INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        trip_id       INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
        driver_id     INTEGER REFERENCES drivers(id),
        event_type    trip_event_type NOT NULL,
        reason_code   VARCHAR(40),
        note          TEXT,
        file_filename VARCHAR(255),
        lat           DECIMAL(10, 8),
        lng           DECIMAL(11, 8),
        created_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_trip_events_trip ON trip_events(trip_id);
      CREATE INDEX IF NOT EXISTS idx_trip_events_org ON trip_events(org_id);
    `);
    logger.info('Trip events migration applied');

    logger.info('Migration completed successfully');
  } catch (err) {
    logger.error('Migration failed', { error: (err as Error).message });
    process.exit(1);
  } finally {
    await db.end();
  }
}

migrate();
