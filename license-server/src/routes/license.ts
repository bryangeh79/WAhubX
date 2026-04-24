import type { D1Database } from '@cloudflare/workers-types';

interface Env { DB: D1Database; }

/** POST /activate — Activate a license key and bind to machine */
export async function handleActivate(request: Request, env: Env): Promise<Response> {
  const body = await request.json() as { licenseKey?: string; machineId?: string };
  const { licenseKey, machineId } = body;

  if (!licenseKey || !machineId) {
    return Response.json({ error: 'Missing licenseKey or machineId' }, { status: 400 });
  }

  // Find the license
  const license = await env.DB.prepare(
    'SELECT * FROM licenses WHERE license_key = ?'
  ).bind(licenseKey).first();

  if (!license) {
    return Response.json({ error: 'Invalid license key' }, { status: 404 });
  }

  if (!license.active) {
    return Response.json({ error: 'License has been deactivated. Please contact support.' }, { status: 403 });
  }

  // Check expiry
  if (license.expires_at && new Date(license.expires_at as string) < new Date()) {
    return Response.json({ error: 'License has expired. Please contact support to renew.' }, { status: 403 });
  }

  // Check machine binding
  if (license.machine_id && license.machine_id !== machineId) {
    return Response.json({
      error: 'This license is already bound to another machine. Contact support to unbind.',
    }, { status: 403 });
  }

  // Bind machine if not yet bound
  const now = new Date().toISOString();
  await env.DB.prepare(
    'UPDATE licenses SET machine_id = ?, last_heartbeat = ?, last_ip = ? WHERE id = ?'
  ).bind(
    machineId,
    now,
    request.headers.get('CF-Connecting-IP') || 'unknown',
    license.id,
  ).run();

  return Response.json({
    success: true,
    license: {
      plan: license.plan,
      slotLimit: license.slot_limit,
      maxTasks: license.max_tasks,
      expiresAt: license.expires_at,
      subscriptionExpiry: license.subscription_expiry ?? null,
      tenantName: license.tenant_name,
      // 租户 user sync info (激活时自动建本地 admin user)
      tenantEmail: license.tenant_email ?? null,
      tenantUsername: license.tenant_username ?? null,
      passwordHash: license.password_hash ?? null,
    },
  });
}

/** POST /heartbeat — Periodic heartbeat from client */
export async function handleHeartbeat(request: Request, env: Env): Promise<Response> {
  const body = await request.json() as {
    licenseKey?: string;
    machineId?: string;
    currentSlots?: number;
    currentTasks?: number;
    version?: string;
  };
  const { licenseKey, machineId, currentSlots, currentTasks, version } = body;

  if (!licenseKey || !machineId) {
    return Response.json({ valid: false, error: 'Missing licenseKey or machineId' }, { status: 400 });
  }

  const license = await env.DB.prepare(
    'SELECT * FROM licenses WHERE license_key = ?'
  ).bind(licenseKey).first();

  if (!license) {
    return Response.json({ valid: false, error: 'Invalid license key' });
  }

  // Check active
  if (!license.active) {
    return Response.json({ valid: false, error: 'License deactivated' });
  }

  // Check expiry
  if (license.expires_at && new Date(license.expires_at as string) < new Date()) {
    return Response.json({ valid: false, error: 'License expired' });
  }

  // Check machine binding
  if (license.machine_id && license.machine_id !== machineId) {
    return Response.json({ valid: false, error: 'Machine mismatch' });
  }

  // Update heartbeat info
  const now = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE licenses SET
      last_heartbeat = ?, last_ip = ?,
      current_slots = ?, current_tasks = ?, app_version = ?
    WHERE id = ?`
  ).bind(
    now,
    request.headers.get('CF-Connecting-IP') || 'unknown',
    currentSlots ?? 0,
    currentTasks ?? 0,
    version ?? null,
    license.id,
  ).run();

  return Response.json({
    valid: true,
    expiresAt: license.expires_at,
    slotLimit: license.slot_limit,
    maxTasks: license.max_tasks,
    plan: license.plan,
    message: null,
  });
}
