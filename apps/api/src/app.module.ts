import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { TerminusModule } from '@nestjs/terminus';
import { PrometheusModule } from '@willsoto/nestjs-prometheus';

import { HealthModule } from './core/health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';

// Feature-flagged modules - loaded based on environment config
import { AuditModule } from './modules/audit/audit.module';
import { NotificationsModule } from './modules/notifications/notifications.module';

import appConfig from './core/config/app.config';
import featureFlagsConfig from './core/config/feature-flags.config';

function getFeatureModules() {
  const modules = [];
  if (process.env.FEATURE_AUDIT === 'true') {
    modules.push(AuditModule);
    console.log('✅ Module ENABLED: Audit');
  }
  if (process.env.FEATURE_NOTIFICATIONS === 'true') {
    modules.push(NotificationsModule);
    console.log('✅ Module ENABLED: Notifications');
  }
  return modules;
}

@Module({
  imports: [
    // Config - global so all modules can inject ConfigService
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, featureFlagsConfig],
      cache: true,
    }),

    // Rate limiting - global guard applied in main.ts
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [
        {
          name: 'short',
          ttl: 1000,
          limit: config.get('THROTTLE_SHORT_LIMIT', 10),
        },
        {
          name: 'medium',
          ttl: 10000,
          limit: config.get('THROTTLE_MEDIUM_LIMIT', 50),
        },
        {
          name: 'long',
          ttl: 60000,
          limit: config.get('THROTTLE_LONG_LIMIT', 100),
        },
      ],
    }),

    // Prometheus metrics endpoint
    PrometheusModule.register({
      path: '/metrics',
      defaultMetrics: { enabled: true },
    }),

    // Always-on core modules
    HealthModule,
    AuthModule,
    UsersModule,

    // Conditionally loaded feature modules
    ...getFeatureModules(),
  ],
})
export class AppModule {}
