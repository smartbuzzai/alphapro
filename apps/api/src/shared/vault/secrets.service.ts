import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface VaultSecret {
  value: string;
  expiresAt?: number;
}

/**
 * SecretsService wraps HashiCorp Vault for all secret retrieval.
 * Falls back to environment variables in development mode.
 *
 * In production, configure:
 *   VAULT_ADDR=https://vault.internal:8200
 *   VAULT_TOKEN=<kubernetes service account token>
 *   VAULT_MOUNT_PATH=secret/data/enterprise-app
 */
@Injectable()
export class SecretsService implements OnModuleInit {
  private readonly logger = new Logger(SecretsService.name);
  private readonly cache = new Map<string, VaultSecret>();
  private readonly isDev: boolean;
  private readonly vaultAddr: string;
  private readonly mountPath: string;

  constructor(private readonly config: ConfigService) {
    this.isDev = config.get('NODE_ENV') !== 'production';
    this.vaultAddr = config.get('VAULT_ADDR', 'http://localhost:8200');
    this.mountPath = config.get('VAULT_MOUNT_PATH', 'secret/data/enterprise-app');
  }

  async onModuleInit() {
    if (this.isDev) {
      this.logger.warn(
        '⚠️  SecretsService running in DEV mode — using environment variables',
      );
    } else {
      this.logger.log(`🔐 SecretsService connected to Vault: ${this.vaultAddr}`);
    }
  }

  /**
   * Retrieve a secret by key.
   * Cached with TTL to reduce Vault API calls.
   */
  async get(key: string): Promise<string> {
    // Check cache first
    const cached = this.cache.get(key);
    if (cached && (!cached.expiresAt || Date.now() < cached.expiresAt)) {
      return cached.value;
    }

    if (this.isDev) {
      return this.getFromEnv(key);
    }

    return this.getFromVault(key);
  }

  /**
   * Rotate a secret — clears from cache so next read fetches fresh value.
   */
  async rotate(key: string): Promise<void> {
    this.cache.delete(key);
    this.logger.log(`🔄 Secret rotated: ${key}`);
  }

  private async getFromVault(key: string): Promise<string> {
    try {
      const token = this.config.get<string>('VAULT_TOKEN');
      const url = `${this.vaultAddr}/v1/${this.mountPath}/${key}`;

      const response = await fetch(url, {
        headers: { 'X-Vault-Token': token! },
      });

      if (!response.ok) {
        throw new Error(`Vault returned ${response.status} for key: ${key}`);
      }

      const data = await response.json();
      const value = data?.data?.data?.[key];

      if (!value) {
        throw new Error(`Key "${key}" not found in Vault`);
      }

      // Cache for 5 minutes (Vault leases typically longer, but we renew early)
      this.cache.set(key, {
        value,
        expiresAt: Date.now() + 5 * 60 * 1000,
      });

      return value;
    } catch (error) {
      this.logger.error(`Failed to fetch secret "${key}" from Vault`, error);
      throw error;
    }
  }

  private getFromEnv(key: string): string {
    const value = process.env[key];
    if (!value) {
      throw new Error(
        `DEV: Environment variable "${key}" not set. Add it to your .env file.`,
      );
    }

    // Cache indefinitely in dev (no rotation needed)
    this.cache.set(key, { value });
    return value;
  }
}
