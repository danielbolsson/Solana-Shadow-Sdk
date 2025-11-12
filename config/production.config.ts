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

export interface GhostConfig {
  network: NetworkConfig;
  circuits: CircuitConfig;
  relayer: RelayerConfig;
  security: SecurityConfig;
  environment: 'mainnet' | 'devnet' | 'testnet' | 'localnet';
}

class ConfigurationManager {
  private config: GhostConfig | null = null;
  private configPath: string;

  constructor() {
    this.configPath = process.env.GHOST_CONFIG_PATH ||
      path.join(__dirname, '..', 'config', `${this.getEnvironment()}.json`);
  }

  private getEnvironment(): string {
    return process.env.GHOST_ENV || process.env.NODE_ENV || 'devnet';
  }

  /**
   * Load configuration
   */
  load(): GhostConfig {
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
  private mergeWithEnv(fileConfig: Partial<GhostConfig>): GhostConfig {
    return {
      environment: (process.env.GHOST_ENV as any) || fileConfig.environment || 'devnet',

      network: {
        rpcUrl: process.env.GHOST_RPC_URL || fileConfig.network?.rpcUrl || this.getDefaultRpcUrl(),
        programId: process.env.GHOST_PROGRAM_ID || fileConfig.network?.programId || '',
        commitment: (process.env.GHOST_COMMITMENT as any) || fileConfig.network?.commitment || 'confirmed',
      },

      circuits: {
        transferCircuit: process.env.GHOST_TRANSFER_CIRCUIT || fileConfig.circuits?.transferCircuit || '',
        balanceCircuit: process.env.GHOST_BALANCE_CIRCUIT || fileConfig.circuits?.balanceCircuit || '',
        ringSignatureCircuit: process.env.GHOST_RING_SIG_CIRCUIT || fileConfig.circuits?.ringSignatureCircuit || '',
        transferVK: process.env.GHOST_TRANSFER_VK || fileConfig.circuits?.transferVK || '',
        balanceVK: process.env.GHOST_BALANCE_VK || fileConfig.circuits?.balanceVK || '',
        ringSignatureVK: process.env.GHOST_RING_SIG_VK || fileConfig.circuits?.ringSignatureVK || '',
      },

      relayer: {
        enabled: process.env.GHOST_RELAYER_ENABLED === 'true' || fileConfig.relayer?.enabled || false,
        endpoints: process.env.GHOST_RELAYER_ENDPOINTS?.split(',') || fileConfig.relayer?.endpoints || [],
        minReputation: parseInt(process.env.GHOST_MIN_REPUTATION || '50') || fileConfig.relayer?.minReputation || 50,
        timeout: parseInt(process.env.GHOST_RELAYER_TIMEOUT || '30000') || fileConfig.relayer?.timeout || 30000,
      },

      security: {
        requireCeremonyComplete: process.env.GHOST_REQUIRE_CEREMONY === 'true' || fileConfig.security?.requireCeremonyComplete || false,
        ceremonyVerificationHash: process.env.GHOST_CEREMONY_HASH || fileConfig.security?.ceremonyVerificationHash || '',
        encryptNotes: process.env.GHOST_ENCRYPT_NOTES !== 'false' || fileConfig.security?.encryptNotes !== false,
        maxTransactionRetries: parseInt(process.env.GHOST_MAX_RETRIES || '3') || fileConfig.security?.maxTransactionRetries || 3,
      },
    };
  }

  /**
   * Load configuration entirely from environment variables
   */
  private loadFromEnv(): GhostConfig {
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
  private validate(config: GhostConfig): void {
    const errors: string[] = [];

    // Network validation
    if (!config.network.rpcUrl) {
      errors.push('network.rpcUrl is required');
    }

    if (!config.network.programId) {
      errors.push('network.programId is required - set GHOST_PROGRAM_ID environment variable');
    }

    // Circuit validation
    if (!config.circuits.transferCircuit) {
      errors.push('circuits.transferCircuit path is required');
    }

    if (!config.circuits.balanceCircuit) {
      errors.push('circuits.balanceCircuit path is required');
    }

    if (!config.circuits.ringSignatureCircuit) {
      errors.push('circuits.ringSignatureCircuit path is required');
    }

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
  get<K extends keyof GhostConfig>(key: K): GhostConfig[K] {
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
  reload(): GhostConfig {
    this.config = null;
    return this.load();
  }
}

// Singleton instance
export const config = new ConfigurationManager();

export default config;
