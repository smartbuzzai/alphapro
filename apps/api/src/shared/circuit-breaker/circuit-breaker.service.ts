import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import * as CircuitBreaker from 'opossum';
import {
  makeCounterProvider,
  makeGaugeProvider,
} from '@willsoto/nestjs-prometheus';

export interface CircuitBreakerOptions {
  timeout?: number;
  errorThresholdPercentage?: number;
  resetTimeout?: number;
  volumeThreshold?: number;
}

const DEFAULT_OPTIONS: CircuitBreakerOptions = {
  timeout: 3000,               // Consider request failed if > 3s
  errorThresholdPercentage: 50, // Open circuit when 50% of requests fail
  resetTimeout: 30000,          // Try again after 30s
  volumeThreshold: 5,           // Minimum calls before evaluating error rate
};

@Injectable()
export class CircuitBreakerService implements OnModuleDestroy {
  private readonly logger = new Logger(CircuitBreakerService.name);
  private readonly breakers = new Map<string, CircuitBreaker<unknown[], unknown>>();

  /**
   * Wrap an async function with a circuit breaker.
   * Re-uses the same breaker instance for the same `name`.
   *
   * @example
   * const result = await this.cb.fire('payment-service', () =>
   *   this.paymentClient.charge(dto)
   * );
   */
  async fire<T>(
    name: string,
    fn: () => Promise<T>,
    options: CircuitBreakerOptions = {},
    fallback?: () => T | Promise<T>,
  ): Promise<T> {
    const breaker = this.getOrCreate(name, fn, options, fallback);
    return breaker.fire() as Promise<T>;
  }

  getStatus(name: string) {
    const breaker = this.breakers.get(name);
    if (!breaker) return null;
    return {
      name,
      state: breaker.opened ? 'OPEN' : breaker.halfOpen ? 'HALF_OPEN' : 'CLOSED',
      stats: breaker.stats,
    };
  }

  getAllStatuses() {
    return Array.from(this.breakers.keys()).map((name) => this.getStatus(name));
  }

  private getOrCreate<T>(
    name: string,
    fn: () => Promise<T>,
    options: CircuitBreakerOptions,
    fallback?: () => T | Promise<T>,
  ): CircuitBreaker<unknown[], unknown> {
    if (this.breakers.has(name)) {
      return this.breakers.get(name)!;
    }

    const mergedOptions = { ...DEFAULT_OPTIONS, ...options };
    const breaker = new CircuitBreaker(fn, mergedOptions);

    if (fallback) {
      breaker.fallback(fallback);
    } else {
      breaker.fallback(() => {
        throw new Error(`Service "${name}" is currently unavailable (circuit open)`);
      });
    }

    // Logging on state transitions
    breaker.on('open', () => {
      this.logger.error(`🔴 Circuit OPENED: ${name}`);
    });
    breaker.on('halfOpen', () => {
      this.logger.warn(`🟡 Circuit HALF-OPEN: ${name} — probing...`);
    });
    breaker.on('close', () => {
      this.logger.log(`🟢 Circuit CLOSED: ${name} — service recovered`);
    });
    breaker.on('fallback', (result) => {
      this.logger.warn(`⚡ Fallback triggered for: ${name}`);
    });
    breaker.on('timeout', () => {
      this.logger.warn(`⏱ Timeout for: ${name}`);
    });

    this.breakers.set(name, breaker);
    return breaker;
  }

  onModuleDestroy() {
    for (const [name, breaker] of this.breakers) {
      breaker.shutdown();
      this.logger.log(`Circuit breaker shut down: ${name}`);
    }
  }
}
