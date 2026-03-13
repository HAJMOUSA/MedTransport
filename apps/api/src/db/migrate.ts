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

    logger.info('Migration completed successfully');
  } catch (err) {
    logger.error('Migration failed', { error: (err as Error).message });
    process.exit(1);
  } finally {
    await db.end();
  }
}

migrate();
