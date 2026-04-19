export interface CreateSessionParams {
  userId: string;
  accessToken: string;
  refreshToken: string;
  deviceInfo?: Record<string, unknown> | null;
  userAgent?: string | null;
  ipAddress?: string | null;
}
