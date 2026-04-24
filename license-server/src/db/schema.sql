-- WAhubX License Server Database Schema
-- Cloudflare D1 (SQLite-compatible)
-- 2026-04-21 · 复用 FAhubX schema · 字段适配 WhatsApp (maxAccounts→slotLimit)

CREATE TABLE IF NOT EXISTS licenses (
  id TEXT PRIMARY KEY,
  license_key TEXT UNIQUE NOT NULL,
  tenant_name TEXT NOT NULL,

  -- 租户账户同步字段 (激活时自动建本地 admin user)
  tenant_email TEXT,
  tenant_username TEXT,
  password_hash TEXT,        -- bcrypt hash · 不存明文
  subscription_expiry TEXT,

  -- WAhubX 套餐字段 · Basic=10 / Pro=30 / Enterprise=50 (来自 CLAUDE.md 决策速查)
  plan TEXT NOT NULL DEFAULT 'basic',
  slot_limit INTEGER NOT NULL DEFAULT 10,
  max_tasks INTEGER NOT NULL DEFAULT 50,
  -- 保留 FAhubX 继承字段 · admin.ts INSERT 仍引用 · WAhubX 不暴露给客户
  max_scripts INTEGER DEFAULT 10,
  machine_id TEXT,
  expires_at TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  last_heartbeat TEXT,
  last_ip TEXT,
  current_slots INTEGER DEFAULT 0,
  current_tasks INTEGER DEFAULT 0,
  app_version TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_license_key ON licenses(license_key);
CREATE INDEX IF NOT EXISTS idx_active ON licenses(active);
CREATE INDEX IF NOT EXISTS idx_tenant_email ON licenses(tenant_email);
CREATE INDEX IF NOT EXISTS idx_tenant_username ON licenses(tenant_username);
