import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { SecretsService } from '../../shared/vault/secrets.service';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      useFactory: async (secrets: SecretsService) => ({
        secret: await secrets.get('JWT_SECRET'),
        signOptions: {
          expiresIn: '15m',   // Short-lived access tokens
          issuer: 'enterprise-app',
          audience: 'enterprise-app-clients',
        },
      }),
      inject: [SecretsService],
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, SecretsService],
  exports: [AuthService, JwtModule],
})
export class AuthModule {}
