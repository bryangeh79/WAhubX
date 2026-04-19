import { UserRole } from '../../users/user.entity';

export interface AuthenticatedUserSummary {
  id: string;
  email: string;
  username: string;
  role: UserRole;
  tenantId: number | null;
  fullName: string | null;
  avatarUrl: string | null;
}

export class TokenResponseDto {
  accessToken!: string;
  refreshToken!: string;
  expiresIn!: string;
  tokenType!: 'Bearer';
  user!: AuthenticatedUserSummary;
}
