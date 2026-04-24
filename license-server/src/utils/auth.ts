/** Verify admin API key from request header */
export function verifyAdminKey(request: Request, env: { ADMIN_API_KEY: string }): boolean {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader) return false;
  const token = authHeader.replace('Bearer ', '');
  return token === env.ADMIN_API_KEY;
}

/** Return 401 JSON response */
export function unauthorizedResponse(): Response {
  return Response.json(
    { error: 'Unauthorized', message: 'Invalid or missing admin API key' },
    { status: 401 },
  );
}
