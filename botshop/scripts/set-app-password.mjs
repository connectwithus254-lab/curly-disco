#!/usr/bin/env node
/**
 * Sets the password of the RLS-enforcing application role from APP_DB_PASSWORD.
 *
 * Migration 0001 creates `botshop_app` with a development password so that local setups work with
 * zero configuration. Production deployments must override it — this script does that without
 * requiring psql in the image, and never logs the password.
 */
import pg from 'pg';

const adminUrl = process.env.DATABASE_ADMIN_URL;
const password = process.env.APP_DB_PASSWORD;

if (!adminUrl) throw new Error('DATABASE_ADMIN_URL is required');
if (!password) throw new Error('APP_DB_PASSWORD is required');
if (password.length < 12) throw new Error('APP_DB_PASSWORD must be at least 12 characters');

const pool = new pg.Pool({ connectionString: adminUrl, max: 1 });
try {
  // Identifiers cannot be bound as parameters, so quote explicitly and keep the name constant.
  await pool.query(`alter role botshop_app with password '${password.replace(/'/g, "''")}'`);
  console.log('[set-app-password] application role password updated');
} finally {
  await pool.end();
}
