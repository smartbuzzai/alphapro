import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  HttpHealthIndicator,
  TypeOrmHealthIndicator,
  MemoryHealthIndicator,
  DiskHealthIndicator,
} from '@nestjs/terminus';
import { Public } from '../decorators/public.decorator';
import { ApiTags, ApiOperation } from '@nestjs/swagger';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly http: HttpHealthIndicator,
    private readonly db: TypeOrmHealthIndicator,
    private readonly memory: MemoryHealthIndicator,
    private readonly disk: DiskHealthIndicator,
  ) {}

  /**
   * Kubernetes LIVENESS probe — is the process alive?
   * A failure here causes K8s to RESTART the pod.
   * Keep this lightweight — do NOT check external dependencies.
   */
  @Get('live')
  @Public()
  @HealthCheck()
  @ApiOperation({ summary: 'Kubernetes liveness probe' })
  liveness() {
    return this.health.check([
      // Memory leak guard — restart if heap > 512MB
      () => this.memory.checkHeap('memory_heap', 512 * 1024 * 1024),
      // RSS guard — restart if RSS > 1GB
      () => this.memory.checkRSS('memory_rss', 1024 * 1024 * 1024),
    ]);
  }

  /**
   * Kubernetes READINESS probe — is the pod ready to receive traffic?
   * A failure here REMOVES the pod from the load balancer without restart.
   * Check all external dependencies here.
   */
  @Get('ready')
  @Public()
  @HealthCheck()
  @ApiOperation({ summary: 'Kubernetes readiness probe' })
  readiness() {
    return this.health.check([
      // Database connectivity
      () => this.db.pingCheck('database', { timeout: 3000 }),
      // Unleash feature flag service
      () =>
        this.http.pingCheck(
          'unleash',
          `${process.env.UNLEASH_URL}/health`,
          { timeout: 2000 },
        ),
      // Disk space — warn if less than 10% free
      () =>
        this.disk.checkStorage('storage', {
          path: '/',
          thresholdPercent: 0.9,
        }),
    ]);
  }

  /**
   * Deep health check — full system status for dashboards/ops.
   * Not used by K8s probes — for manual inspection only.
   */
  @Get('status')
  @Public()
  @HealthCheck()
  @ApiOperation({ summary: 'Full system health status' })
  status() {
    return this.health.check([
      () => this.db.pingCheck('database'),
      () => this.memory.checkHeap('memory_heap', 512 * 1024 * 1024),
      () => this.disk.checkStorage('storage', { path: '/', thresholdPercent: 0.9 }),
    ]);
  }
}
