/**
 * WAhubX License Server
 * Cloudflare Workers + D1 Database
 * 2026-04-21 · 复用 FAhubX license-server 代码 · 改品牌 + 字段适配 (maxAccounts → slotLimit)
 *
 * Client endpoints:
 *   POST /activate    — Activate license & bind machine
 *   POST /heartbeat   — Periodic heartbeat from client
 *
 * Admin endpoints (require Bearer token):
 *   GET    /admin/licenses           — List all licenses
 *   POST   /admin/licenses           — Create new license
 *   PATCH  /admin/licenses/:id       — Update license
 *   DELETE /admin/licenses/:id       — Delete license
 *   POST   /admin/licenses/:id/unbind — Unbind machine
 *   GET    /admin/dashboard          — Stats overview
 */

import { handleActivate, handleHeartbeat } from './routes/license';
import {
  handleListLicenses, handleCreateLicense, handleUpdateLicense,
  handleDeleteLicense, handleUnbindLicense, handleDashboard,
} from './routes/admin';

interface Env {
  DB: D1Database;
  ADMIN_API_KEY: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // CORS headers (allow all for API)
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    // Handle preflight
    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    try {
      let response: Response;

      // ── Client endpoints ──────────────────────────────────────────────
      if (path === '/activate' && method === 'POST') {
        response = await handleActivate(request, env);

      } else if (path === '/heartbeat' && method === 'POST') {
        response = await handleHeartbeat(request, env);

      // ── Admin endpoints ───────────────────────────────────────────────
      } else if (path === '/admin/licenses' && method === 'GET') {
        response = await handleListLicenses(request, env);

      } else if (path === '/admin/licenses' && method === 'POST') {
        response = await handleCreateLicense(request, env);

      } else if (path === '/admin/dashboard' && method === 'GET') {
        response = await handleDashboard(request, env);

      } else if (path.match(/^\/admin\/licenses\/[\w-]+\/unbind$/) && method === 'POST') {
        const id = path.split('/')[3];
        response = await handleUnbindLicense(request, env, id);

      } else if (path.match(/^\/admin\/licenses\/[\w-]+$/) && method === 'PATCH') {
        const id = path.split('/')[3];
        response = await handleUpdateLicense(request, env, id);

      } else if (path.match(/^\/admin\/licenses\/[\w-]+$/) && method === 'DELETE') {
        const id = path.split('/')[3];
        response = await handleDeleteLicense(request, env, id);

      // ── Health / Welcome ──────────────────────────────────────────────
      } else if (path === '/' || path === '/health') {
        response = Response.json({
          service: 'WAhubX License Server',
          status: 'ok',
          time: new Date().toISOString(),
        });

      } else {
        response = Response.json({ error: 'Not found' }, { status: 404 });
      }

      // Add CORS headers to all responses
      const newHeaders = new Headers(response.headers);
      Object.entries(corsHeaders).forEach(([k, v]) => newHeaders.set(k, v));
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders,
      });

    } catch (err: any) {
      return Response.json(
        { error: 'Internal server error', message: err.message },
        { status: 500, headers: corsHeaders },
      );
    }
  },
};
