/**
 * Production Configuration
 *
 * Centralized configuration management for production deployment
 * NO HARDCODED VALUES - all loaded from environment or config files
 */

import * as fs from 'fs';
import * as path from 'path';

export interface NetworkConfig {
  rpcUrl: string;
  programId: string;
  commitment: 'processed' | 'confirmed' | 'finalized';
}

export interface CircuitConfig {
  transferCircuit: string;
  balanceCircuit: string;
  ringSignatureCircuit: string;
  transferVK: string;
  balanceVK: string;
  ringSignatureVK: string;
}

export interface RelayerConfig {
  enabled: boolean;
  endpoints: string[];
  minReputation: number;
  timeout: number;
}

export interface SecurityConfig {
  requireCeremonyComplete: boolean;
  ceremonyVerificationHash: string;
  encryptNotes: boolean;
  maxTransactionRetries: number;
}

export interface ShadowConfig {
  network: NetworkConfig;
  circuits: CircuitConfig;
  relayer: RelayerConfig;
  security: SecurityConfig;
  environment: 'mainnet' | 'devnet' | 'testnet' | 'localnet';
}

class ConfigurationManager {
  private config: ShadowConfig | null = null;
  private configPath: string;

  constructor() {
    this.configPath = process.env.SHADOW_CONFIG_PATH ||
      path.join(__dirname, '..', 'config', `${this.getEnvironment()}.json`);
  }

  private getEnvironment(): string {
    return process.env.SHADOW_ENV || process.env.NODE_ENV || 'devnet';
  }

  /**
   * Load configuration
   */
  load(): ShadowConfig {
    if (this.config) {
      return this.config;
    }

    // Load from file
    if (fs.existsSync(this.configPath)) {
      const fileConfig = JSON.parse(fs.readFileSync(this.configPath, 'utf-8'));
      this.config = this.mergeWithEnv(fileConfig);
    } else {
      // Use environment variables only
      this.config = this.loadFromEnv();
    }

    // Validate configuration
    this.validate(this.config);

    return this.config;
  }

  /**
   * Merge file config with environment variables (env takes precedence)
   */
  private mergeWithEnv(fileConfig: Partial<ShadowConfig>): ShadowConfig {
    return {
      environment: (process.env.SHADOW_ENV as any) || fileConfig.environment || 'devnet',

      network: {
        rpcUrl: process.env.SHADOW_RPC_URL || fileConfig.network?.rpcUrl || this.getDefaultRpcUrl(),
        programId: process.env.SHADOW_PROGRAM_ID || fileConfig.network?.programId || '',
        commitment: (process.env.SHADOW_COMMITMENT as any) || fileConfig.network?.commitment || 'confirmed',
      },

      circuits: {
        transferCircuit: process.env.SHADOW_TRANSFER_CIRCUIT || fileConfig.circuits?.transferCircuit || '',
        balanceCircuit: process.env.SHADOW_BALANCE_CIRCUIT || fileConfig.circuits?.balanceCircuit || '',
        ringSignatureCircuit: process.env.SHADOW_RING_SIG_CIRCUIT || fileConfig.circuits?.ringSignatureCircuit || '',
        transferVK: process.env.SHADOW_TRANSFER_VK || fileConfig.circuits?.transferVK || '',
        balanceVK: process.env.SHADOW_BALANCE_VK || fileConfig.circuits?.balanceVK || '',
        ringSignatureVK: process.env.SHADOW_RING_SIG_VK || fileConfig.circuits?.ringSignatureVK || '',
      },

      relayer: {
        enabled: process.env.SHADOW_RELAYER_ENABLED === 'true' || fileConfig.relayer?.enabled || false,
        endpoints: process.env.SHADOW_RELAYER_ENDPOINTS?.split(',') || fileConfig.relayer?.endpoints || [],
        minReputation: parseInt(process.env.SHADOW_MIN_REPUTATION || '50') || fileConfig.relayer?.minReputation || 50,
        timeout: parseInt(process.env.SHADOW_RELAYER_TIMEOUT || '30000') || fileConfig.relayer?.timeout || 30000,
      },

      security: {
        requireCeremonyComplete: process.env.SHADOW_REQUIRE_CEREMONY === 'true' || fileConfig.security?.requireCeremonyComplete || false,
        ceremonyVerificationHash: process.env.SHADOW_CEREMONY_HASH || fileConfig.security?.ceremonyVerificationHash || '',
        encryptNotes: process.env.SHADOW_ENCRYPT_NOTES !== 'false' || fileConfig.security?.encryptNotes !== false,
        maxTransactionRetries: parseInt(process.env.SHADOW_MAX_RETRIES || '3') || fileConfig.security?.maxTransactionRetries || 3,
      },
    };
  }

  /**
   * Load configuration entirely from environment variables
   */
  private loadFromEnv(): ShadowConfig {
    return this.mergeWithEnv({});
  }

  /**
   * Get default RPC URL based on environment
   */
  private getDefaultRpcUrl(): string {
    const env = this.getEnvironment();
    switch (env) {
      case 'mainnet':
        return 'https://api.mainnet-beta.solana.com';
      case 'devnet':
        return 'https://api.devnet.solana.com';
      case 'testnet':
        return 'https://api.testnet.solana.com';
      case 'localnet':
        return 'http://localhost:8899';
      default:
        return 'https://api.devnet.solana.com';
    }
  }

  /**
   * Validate configuration
   */
  private validate(config: ShadowConfig): void {
    const errors: string[] = [];

    // Network validation
    if (!config.network.rpcUrl) {
      errors.push('network.rpcUrl is required');
    }

    if (!config.network.programId) {
      errors.push('network.programId is required - set SHADOW_PROGRAM_ID environment variable');
    }

    // Circuit validation disabled for now

    // Security validation for production
    if (config.environment === 'mainnet') {
      if (!config.security.requireCeremonyComplete) {
        errors.push('CRITICAL: security.requireCeremonyComplete must be true for mainnet');
      }

      if (!config.security.ceremonyVerificationHash) {
        errors.push('CRITICAL: security.ceremonyVerificationHash must be set for mainnet');
      }

      if (!config.security.encryptNotes) {
        errors.push('WARNING: security.encryptNotes should be true for mainnet');
      }
    }

    // Relayer validation
    if (config.relayer.enabled && config.relayer.endpoints.length === 0) {
      errors.push('relayer.endpoints must be provided when relayer is enabled');
    }

    if (errors.length > 0) {
      throw new Error(`Configuration validation failed:\n${errors.join('\n')}`);
    }
  }

  /**
   * Check if ceremony is complete and verified
   */
  async verifyCeremony(): Promise<boolean> {
    const config = this.load();

    if (!config.security.requireCeremonyComplete) {
      return true; // Not required
    }

    if (!config.security.ceremonyVerificationHash) {
      throw new Error('Ceremony verification hash not configured');
    }

    // Verify circuit files match expected hash
    const { createHash } = await import('crypto');
    const transferHash = createHash('sha256')
      .update(fs.readFileSync(config.circuits.transferCircuit))
      .digest('hex');

    // Check if hash matches ceremony output
    // In production, this should verify against published ceremony transcript
    return transferHash === config.security.ceremonyVerificationHash;
  }

  /**
   * Get config value safely
   */
  get<K extends keyof ShadowConfig>(key: K): ShadowConfig[K] {
    const config = this.load();
    return config[key];
  }

  /**
   * Check if running in production
   */
  isProduction(): boolean {
    return this.load().environment === 'mainnet';
  }

  /**
   * Export current configuration (for backup)
   */
  export(outputPath: string): void {
    const config = this.load();
    fs.writeFileSync(outputPath, JSON.stringify(config, null, 2));
  }

  /**
   * Reload configuration (useful after config file changes)
   */
  reload(): ShadowConfig {
    this.config = null;
    return this.load();
  }
}

// Singleton instance
export const config = new ConfigurationManager();

export default config;
