import type { D1Database } from '@cloudflare/workers-types';
import { generateLicenseKey, generateId } from '../utils/key-generator';
import { verifyAdminKey, unauthorizedResponse } from '../utils/auth';

interface Env { DB: D1Database; ADMIN_API_KEY: string; }

/** GET /admin/licenses — List all licenses */
export async function handleListLicenses(request: Request, env: Env): Promise<Response> {
  if (!verifyAdminKey(request, env)) return unauthorizedResponse();

  const { results } = await env.DB.prepare(
    'SELECT * FROM licenses ORDER BY created_at DESC'
  ).all();

  return Response.json({ licenses: results, total: results.length });
}

/** POST /admin/licenses — Create a new license */
export async function handleCreateLicense(request: Request, env: Env): Promise<Response> {
  if (!verifyAdminKey(request, env)) return unauthorizedResponse();

  const body = await request.json() as {
    tenantName: string;
    plan?: string;
    expiresAt?: string;
    notes?: string;
    // v2: Tenant account sync fields
    tenantEmail?: string;
    tenantUsername?: string;
    passwordHash?: string;   // bcrypt hash, format: $2a$/$2b$/$2y$
    maxScripts?: number;
    subscriptionExpiry?: string;
  };

  if (!body.tenantName) {
    return Response.json({ error: 'tenantName is required' }, { status: 400 });
  }

  // Validate passwordHash format if provided (must be bcrypt)
  if (body.passwordHash && !/^\$2[aby]\$\d{2}\$/.test(body.passwordHash)) {
    return Response.json({ error: 'Invalid passwordHash format (must be bcrypt)' }, { status: 400 });
  }

  const plan = body.plan || 'basic';
  // 2026-04-21 · WAhubX 套餐 (CLAUDE.md 决策): Basic 10 / Pro 30 / Enterprise 50
  const planDefaults: Record<string, { slotLimit: number; maxTasks: number; maxScripts: number }> = {
    basic:      { slotLimit: 10, maxTasks: 50,  maxScripts: 10 },
    pro:        { slotLimit: 30, maxTasks: 200, maxScripts: 50 },
    enterprise: { slotLimit: 50, maxTasks: 500, maxScripts: 100 },
    admin:      { slotLimit: 9999, maxTasks: 9999, maxScripts: 9999 },
  };
  const defaults = planDefaults[plan] || planDefaults.basic;

  const id = generateId();
  const licenseKey = generateLicenseKey();

  await env.DB.prepare(
    `INSERT INTO licenses (
      id, license_key, tenant_name, plan, slot_limit, max_tasks, max_scripts,
      expires_at, subscription_expiry, notes,
      tenant_email, tenant_username, password_hash
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id, licenseKey, body.tenantName, plan,
    defaults.slotLimit, defaults.maxTasks, body.maxScripts ?? defaults.maxScripts,
    body.expiresAt || null,
    body.subscriptionExpiry || null,
    body.notes || null,
    body.tenantEmail || null,
    body.tenantUsername || null,
    body.passwordHash || null,
  ).run();

  return Response.json({
    success: true,
    license: {
      id,
      licenseKey,
      tenantName: body.tenantName,
      tenantEmail: body.tenantEmail || null,
      tenantUsername: body.tenantUsername || null,
      plan,
      slotLimit: defaults.slotLimit,
      maxTasks: defaults.maxTasks,
      maxScripts: body.maxScripts ?? defaults.maxScripts,
      expiresAt: body.expiresAt || null,
      subscriptionExpiry: body.subscriptionExpiry || null,
    },
  }, { status: 201 });
}

/** PATCH /admin/licenses/:id — Update a license */
export async function handleUpdateLicense(request: Request, env: Env, id: string): Promise<Response> {
  if (!verifyAdminKey(request, env)) return unauthorizedResponse();

  const body = await request.json() as {
    active?: boolean;
    plan?: string;
    expiresAt?: string | null;
    subscriptionExpiry?: string | null;
    tenantName?: string;
    tenantEmail?: string;
    tenantUsername?: string;
    passwordHash?: string;
    notes?: string;
    slotLimit?: number;
    maxTasks?: number;
    maxScripts?: number;
  };

  if (body.passwordHash && !/^\$2[aby]\$\d{2}\$/.test(body.passwordHash)) {
    return Response.json({ error: 'Invalid passwordHash format (must be bcrypt)' }, { status: 400 });
  }

  // Build dynamic update
  const sets: string[] = [];
  const values: any[] = [];

  if (body.active !== undefined) { sets.push('active = ?'); values.push(body.active ? 1 : 0); }
  if (body.tenantName) { sets.push('tenant_name = ?'); values.push(body.tenantName); }
  if (body.tenantEmail !== undefined) { sets.push('tenant_email = ?'); values.push(body.tenantEmail); }
  if (body.tenantUsername !== undefined) { sets.push('tenant_username = ?'); values.push(body.tenantUsername); }
  if (body.passwordHash !== undefined) { sets.push('password_hash = ?'); values.push(body.passwordHash); }
  if (body.notes !== undefined) { sets.push('notes = ?'); values.push(body.notes); }
  if ('expiresAt' in body) { sets.push('expires_at = ?'); values.push(body.expiresAt); }
  if ('subscriptionExpiry' in body) { sets.push('subscription_expiry = ?'); values.push(body.subscriptionExpiry); }

  if (body.plan) {
    sets.push('plan = ?'); values.push(body.plan);
    const planDefaults: Record<string, { slotLimit: number; maxTasks: number; maxScripts: number }> = {
      basic: { slotLimit: 10,   maxTasks: 50,   maxScripts: 10 },
      pro:   { slotLimit: 30,   maxTasks: 200,  maxScripts: 50 },
      admin: { slotLimit: 9999, maxTasks: 9999, maxScripts: 9999 },
    };
    const d = planDefaults[body.plan] || planDefaults.basic;
    if (!body.slotLimit) { sets.push('slot_limit = ?'); values.push(d.slotLimit); }
    if (!body.maxTasks)    { sets.push('max_tasks = ?');    values.push(d.maxTasks); }
    if (!body.maxScripts)  { sets.push('max_scripts = ?');  values.push(d.maxScripts); }
  }
  if (body.slotLimit) { sets.push('slot_limit = ?'); values.push(body.slotLimit); }
  if (body.maxTasks)    { sets.push('max_tasks = ?');    values.push(body.maxTasks); }
  if (body.maxScripts)  { sets.push('max_scripts = ?');  values.push(body.maxScripts); }

  if (sets.length === 0) {
    return Response.json({ error: 'No fields to update' }, { status: 400 });
  }

  values.push(id);
  await env.DB.prepare(`UPDATE licenses SET ${sets.join(', ')} WHERE id = ?`).bind(...values).run();

  const updated = await env.DB.prepare('SELECT * FROM licenses WHERE id = ?').bind(id).first();
  return Response.json({ success: true, license: updated });
}

/** DELETE /admin/licenses/:id — Delete a license */
export async function handleDeleteLicense(request: Request, env: Env, id: string): Promise<Response> {
  if (!verifyAdminKey(request, env)) return unauthorizedResponse();

  await env.DB.prepare('DELETE FROM licenses WHERE id = ?').bind(id).run();
  return Response.json({ success: true });
}

/** POST /admin/licenses/:id/unbind — Unbind machine from license */
export async function handleUnbindLicense(request: Request, env: Env, id: string): Promise<Response> {
  if (!verifyAdminKey(request, env)) return unauthorizedResponse();

  await env.DB.prepare('UPDATE licenses SET machine_id = NULL WHERE id = ?').bind(id).run();

  return Response.json({ success: true, message: 'Machine unbound. Tenant can activate on a new machine.' });
}

/** GET /admin/dashboard — Overview stats */
export async function handleDashboard(request: Request, env: Env): Promise<Response> {
  if (!verifyAdminKey(request, env)) return unauthorizedResponse();

  const total = await env.DB.prepare('SELECT COUNT(*) as c FROM licenses').first();
  const active = await env.DB.prepare('SELECT COUNT(*) as c FROM licenses WHERE active = 1').first();
  const expired = await env.DB.prepare(
    "SELECT COUNT(*) as c FROM licenses WHERE expires_at IS NOT NULL AND expires_at < datetime('now')"
  ).first();
  const online = await env.DB.prepare(
    "SELECT COUNT(*) as c FROM licenses WHERE last_heartbeat > datetime('now', '-1 hour')"
  ).first();

  return Response.json({
    totalLicenses: (total as any)?.c || 0,
    activeLicenses: (active as any)?.c || 0,
    expiredLicenses: (expired as any)?.c || 0,
    onlineNow: (online as any)?.c || 0,
  });
}
