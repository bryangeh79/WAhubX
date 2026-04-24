/** Generate a license key in WA-XXXX-XXXX-XXXX-XXXX format (4x4 · align existing local gen) */
export function generateLicenseKey(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1 to avoid confusion
  const segment = () => Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `WA-${segment()}-${segment()}-${segment()}-${segment()}`;
}

/** Generate a UUID v4 */
export function generateId(): string {
  return crypto.randomUUID();
}
