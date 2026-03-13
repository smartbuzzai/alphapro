import {
  Injectable,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { SecretsService } from '../../shared/vault/secrets.service';

export interface TokenPayload {
  sub: string;
  email: string;
  roles: string[];
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly secretsService: SecretsService,
  ) {}

  async validateUser(email: string, password: string): Promise<TokenPayload | null> {
    // TODO: Replace with real user lookup from UsersService
    // This is a stub — wire up your user repository here
    const mockUser = {
      id: '1',
      email: 'admin@example.com',
      passwordHash: await bcrypt.hash('changeme', 12),
      roles: ['admin'],
    };

    if (email !== mockUser.email) return null;

    const isValid = await bcrypt.compare(password, mockUser.passwordHash);
    if (!isValid) {
      this.logger.warn(`Failed login attempt for: ${email}`);
      return null;
    }

    return { sub: mockUser.id, email: mockUser.email, roles: mockUser.roles };
  }

  async login(payload: TokenPayload): Promise<AuthTokens> {
    const refreshSecret = await this.secretsService.get('JWT_REFRESH_SECRET');

    const [accessToken, refreshToken] = await Promise.all([
      // Access token: short-lived (15 min)
      this.jwtService.signAsync(payload),

      // Refresh token: long-lived (7 days), separate secret
      this.jwtService.signAsync(
        { sub: payload.sub, type: 'refresh' },
        { secret: refreshSecret, expiresIn: '7d' },
      ),
    ]);

    this.logger.log(`User logged in: ${payload.email}`);

    return { accessToken, refreshToken, expiresIn: 900 }; // 900s = 15 min
  }

  async refreshTokens(refreshToken: string): Promise<AuthTokens> {
    try {
      const refreshSecret = await this.secretsService.get('JWT_REFRESH_SECRET');
      const payload = await this.jwtService.verifyAsync<{ sub: string; type: string }>(
        refreshToken,
        { secret: refreshSecret },
      );

      if (payload.type !== 'refresh') {
        throw new UnauthorizedException('Invalid token type');
      }

      // TODO: Check refresh token is not in revocation list (Redis)
      // TODO: Fetch fresh user roles from DB on refresh

      const newPayload: TokenPayload = {
        sub: payload.sub,
        email: '', // fetch from DB
        roles: [], // fetch from DB
      };

      return this.login(newPayload);
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
  }

  async logout(userId: string): Promise<void> {
    // TODO: Add refresh token to Redis revocation list
    this.logger.log(`User logged out: ${userId}`);
  }
}
