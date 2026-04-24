-- Migration v2: Add tenant account sync fields to existing licenses table
-- Run once on deployed License Server: npx wrangler d1 execute <DB_NAME> --file=./src/db/migration_v2.sql
-- SQLite does not support IF NOT EXISTS on ALTER TABLE ADD COLUMN, so run each one.
-- If a column already exists, the statement will error — that's fine, just skip to the next.

ALTER TABLE licenses ADD COLUMN tenant_email TEXT;
ALTER TABLE licenses ADD COLUMN tenant_username TEXT;
ALTER TABLE licenses ADD COLUMN password_hash TEXT;
ALTER TABLE licenses ADD COLUMN max_scripts INTEGER DEFAULT 10;
ALTER TABLE licenses ADD COLUMN subscription_expiry TEXT;

CREATE INDEX IF NOT EXISTS idx_tenant_email ON licenses(tenant_email);
CREATE INDEX IF NOT EXISTS idx_tenant_username ON licenses(tenant_username);
