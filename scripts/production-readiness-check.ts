#!/usr/bin/env ts-node

/**
 * Production Readiness Checker
 *
 * Comprehensive pre-deployment validation
 * Ensures all requirements are met before mainnet deployment
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { createHash } from 'crypto';
import config from '../config/production.config';

interface CheckResult {
  category: string;
  name: string;
  status: 'PASS' | 'FAIL' | 'WARN';
  message: string;
  critical: boolean;
}

class ProductionReadinessChecker {
  private results: CheckResult[] = [];
  private readonly BUILD_DIR = path.join(__dirname, '..', 'circuits', 'build');
  private readonly PROGRAM_DIR = path.join(__dirname, '..', 'programs', 'shadow-privacy');

  async runAllChecks(): Promise<void> {
    console.log('========================================');
    console.log('Production Readiness Check');
    console.log('========================================\n');

    await this.checkConfiguration();
    await this.checkCeremony();
    await this.checkCircuits();
    await this.checkProgram();
    await this.checkSecurity();
    await this.checkRelayers();
    await this.checkDocumentation();

    this.printResults();
    this.exitIfCriticalFailures();
  }

  private async checkConfiguration(): Promise<void> {
    console.log('Checking Configuration...\n');

    try {
      const cfg = config.load();

      this.addResult({
        category: 'Configuration',
        name: 'Config Load',
        status: 'PASS',
        message: 'Configuration loaded successfully',
        critical: true
      });

      // Check environment
      if (cfg.environment === 'mainnet') {
        this.addResult({
          category: 'Configuration',
          name: 'Environment',
          status: 'PASS',
          message: 'Environment set to mainnet',
          critical: true
        });
      } else {
        this.addResult({
          category: 'Configuration',
          name: 'Environment',
          status: 'FAIL',
          message: `Environment is ${cfg.environment}, expected mainnet`,
          critical: true
        });
      }

      // Check program ID
      if (cfg.network.programId && cfg.network.programId !== '3wiFPaYTQZZD71rd4pohPRr8JaFaGN3XaNWLoGSk31Ck') {
        this.addResult({
          category: 'Configuration',
          name: 'Program ID',
          status: 'PASS',
          message: `Program ID configured: ${cfg.network.programId}`,
          critical: true
        });
      } else {
        this.addResult({
          category: 'Configuration',
          name: 'Program ID',
          status: 'FAIL',
          message: 'Program ID not set or using development ID',
          critical: true
        });
      }

      // Check RPC
      if (cfg.network.rpcUrl.includes('mainnet')) {
        this.addResult({
          category: 'Configuration',
          name: 'RPC URL',
          status: 'PASS',
          message: `RPC URL: ${cfg.network.rpcUrl}`,
          critical: true
        });
      } else {
        this.addResult({
          category: 'Configuration',
          name: 'RPC URL',
          status: 'FAIL',
          message: `RPC URL not set to mainnet: ${cfg.network.rpcUrl}`,
          critical: true
        });
      }

    } catch (error: any) {
      this.addResult({
        category: 'Configuration',
        name: 'Config Load',
        status: 'FAIL',
        message: `Failed to load configuration: ${error.message}`,
        critical: true
      });
    }
  }

  private async checkCeremony(): Promise<void> {
    console.log('Checking Trusted Setup Ceremony...\n');

    const cfg = config.load();

    // Check if ceremony completion is required
    if (!cfg.security.requireCeremonyComplete) {
      this.addResult({
        category: 'Ceremony',
        name: 'Ceremony Required',
        status: 'FAIL',
        message: 'Ceremony completion check is disabled - MUST be enabled for production',
        critical: true
      });
      return;
    }

    // Check verification hash is set
    if (!cfg.security.ceremonyVerificationHash) {
      this.addResult({
        category: 'Ceremony',
        name: 'Verification Hash',
        status: 'FAIL',
        message: 'Ceremony verification hash not set',
        critical: true
      });
      return;
    }

    // Check ceremony transcript exists
    const transcriptPath = path.join(__dirname, '..', 'ceremony-coordinator', 'data', 'ceremony-transcript.json');
    if (fs.existsSync(transcriptPath)) {
      this.addResult({
        category: 'Ceremony',
        name: 'Transcript',
        status: 'PASS',
        message: 'Ceremony transcript found',
        critical: true
      });

      // Validate transcript
      const transcript = JSON.parse(fs.readFileSync(transcriptPath, 'utf-8'));
      if (transcript.participants && transcript.participants.length >= 3) {
        this.addResult({
          category: 'Ceremony',
          name: 'Participants',
          status: 'PASS',
          message: `${transcript.participants.length} participants verified`,
          critical: true
        });
      } else {
        this.addResult({
          category: 'Ceremony',
          name: 'Participants',
          status: 'FAIL',
          message: 'Insufficient participants (minimum 3 required)',
          critical: true
        });
      }
    } else {
      this.addResult({
        category: 'Ceremony',
        name: 'Transcript',
        status: 'FAIL',
        message: 'Ceremony transcript not found',
        critical: true
      });
    }

    // Verify ceremony keys
    try {
      const verified = await config.verifyCeremony();
      if (verified) {
        this.addResult({
          category: 'Ceremony',
          name: 'Key Verification',
          status: 'PASS',
          message: 'Ceremony keys verified against hash',
          critical: true
        });
      } else {
        this.addResult({
          category: 'Ceremony',
          name: 'Key Verification',
          status: 'FAIL',
          message: 'Ceremony key verification failed',
          critical: true
        });
      }
    } catch (error: any) {
      this.addResult({
        category: 'Ceremony',
        name: 'Key Verification',
        status: 'FAIL',
        message: `Verification error: ${error.message}`,
        critical: true
      });
    }
  }

  private async checkCircuits(): Promise<void> {
    console.log('Checking Circuits...\n');

    const circuits = ['transfer_final.zkey', 'balance_final.zkey', 'ring_signature_final.zkey'];

    for (const circuit of circuits) {
      const circuitPath = path.join(this.BUILD_DIR, circuit);

      if (fs.existsSync(circuitPath)) {
        // Check file size (should be substantial)
        const stats = fs.statSync(circuitPath);
        if (stats.size > 1000000) { // > 1MB
          this.addResult({
            category: 'Circuits',
            name: circuit,
            status: 'PASS',
            message: `Found (${(stats.size / 1024 / 1024).toFixed(2)} MB)`,
            critical: true
          });
        } else {
          this.addResult({
            category: 'Circuits',
            name: circuit,
            status: 'WARN',
            message: `File size suspicious (${stats.size} bytes)`,
            critical: false
          });
        }
      } else {
        this.addResult({
          category: 'Circuits',
          name: circuit,
          status: 'FAIL',
          message: 'Circuit file not found',
          critical: true
        });
      }
    }

    // Check VK files
    const vkFiles = ['transfer_verification_key.json', 'balance_verification_key.json', 'ring_signature_verification_key.json'];

    for (const vk of vkFiles) {
      const vkPath = path.join(this.BUILD_DIR, vk);

      if (fs.existsSync(vkPath)) {
        this.addResult({
          category: 'Circuits',
          name: vk,
          status: 'PASS',
          message: 'Verification key found',
          critical: true
        });
      } else {
        this.addResult({
          category: 'Circuits',
          name: vk,
          status: 'FAIL',
          message: 'Verification key not found',
          critical: true
        });
      }
    }
  }

  private async checkProgram(): Promise<void> {
    console.log('Checking Solana Program...\n');

    // Check if program is built
    const programPath = path.join(this.PROGRAM_DIR, 'target', 'deploy', 'shadow_privacy.so');

    if (fs.existsSync(programPath)) {
      this.addResult({
        category: 'Program',
        name: 'Build',
        status: 'PASS',
        message: 'Program binary found',
        critical: true
      });
    } else {
      this.addResult({
        category: 'Program',
        name: 'Build',
        status: 'FAIL',
        message: 'Program not built - run: cargo build-bpf',
        critical: true
      });
    }

    // Check Cargo.toml version
    const cargoPath = path.join(this.PROGRAM_DIR, 'Cargo.toml');
    if (fs.existsSync(cargoPath)) {
      const cargo = fs.readFileSync(cargoPath, 'utf-8');
      const versionMatch = cargo.match(/version\s*=\s*"([^"]+)"/);

      if (versionMatch) {
        this.addResult({
          category: 'Program',
          name: 'Version',
          status: 'PASS',
          message: `Version: ${versionMatch[1]}`,
          critical: false
        });
      }
    }
  }

  private async checkSecurity(): Promise<void> {
    console.log('Checking Security...\n');

    const cfg = config.load();

    // Check note encryption
    if (cfg.security.encryptNotes) {
      this.addResult({
        category: 'Security',
        name: 'Note Encryption',
        status: 'PASS',
        message: 'Note encryption enabled',
        critical: true
      });
    } else {
      this.addResult({
        category: 'Security',
        name: 'Note Encryption',
        status: 'FAIL',
        message: 'Note encryption disabled - MUST be enabled for production',
        critical: true
      });
    }

    // Check for sensitive files
    const sensitivePatterns = [
      '.env',
      '*wallet.json',
      '*-wallet.json',
      'data/wallet.json',
      'relayer-wallet.json'
    ];

    const foundSensitive = sensitivePatterns.filter(pattern => {
      // Simple check - in production use proper glob
      return fs.existsSync(path.join(__dirname, '..', pattern.replace('*', '')));
    });

    if (foundSensitive.length === 0) {
      this.addResult({
        category: 'Security',
        name: 'Sensitive Files',
        status: 'PASS',
        message: 'No sensitive files found in repository',
        critical: false
      });
    } else {
      this.addResult({
        category: 'Security',
        name: 'Sensitive Files',
        status: 'WARN',
        message: `Found potentially sensitive files: ${foundSensitive.join(', ')}`,
        critical: false
      });
    }

    // Check .gitignore
    const gitignorePath = path.join(__dirname, '..', '.gitignore');
    if (fs.existsSync(gitignorePath)) {
      const gitignore = fs.readFileSync(gitignorePath, 'utf-8');
      const requiredPatterns = ['*.key', '*.pem', 'wallet.json', '.env'];

      const missingPatterns = requiredPatterns.filter(p => !gitignore.includes(p));

      if (missingPatterns.length === 0) {
        this.addResult({
          category: 'Security',
          name: '.gitignore',
          status: 'PASS',
          message: 'All sensitive patterns in .gitignore',
          critical: false
        });
      } else {
        this.addResult({
          category: 'Security',
          name: '.gitignore',
          status: 'WARN',
          message: `Missing patterns: ${missingPatterns.join(', ')}`,
          critical: false
        });
      }
    }
  }

  private async checkRelayers(): Promise<void> {
    console.log('Checking Relayers...\n');

    const cfg = config.load();

    if (!cfg.relayer.enabled) {
      this.addResult({
        category: 'Relayers',
        name: 'Enabled',
        status: 'WARN',
        message: 'Relayer network disabled',
        critical: false
      });
      return;
    }

    if (cfg.relayer.endpoints.length >= 3) {
      this.addResult({
        category: 'Relayers',
        name: 'Endpoints',
        status: 'PASS',
        message: `${cfg.relayer.endpoints.length} relayers configured`,
        critical: false
      });
    } else {
      this.addResult({
        category: 'Relayers',
        name: 'Endpoints',
        status: 'WARN',
        message: `Only ${cfg.relayer.endpoints.length} relayers (recommend 3+)`,
        critical: false
      });
    }

    if (cfg.relayer.minReputation >= 70) {
      this.addResult({
        category: 'Relayers',
        name: 'Min Reputation',
        status: 'PASS',
        message: `Minimum reputation: ${cfg.relayer.minReputation}`,
        critical: false
      });
    } else {
      this.addResult({
        category: 'Relayers',
        name: 'Min Reputation',
        status: 'WARN',
        message: `Low minimum reputation: ${cfg.relayer.minReputation} (recommend 70+)`,
        critical: false
      });
    }
  }

  private async checkDocumentation(): Promise<void> {
    console.log('Checking Documentation...\n');

    const docs = ['README.md', 'TRUSTED_SETUP.md', 'ceremony-coordinator/README.md'];

    for (const doc of docs) {
      const docPath = path.join(__dirname, '..', doc);

      if (fs.existsSync(docPath)) {
        const content = fs.readFileSync(docPath, 'utf-8');

        if (content.length > 1000) {
          this.addResult({
            category: 'Documentation',
            name: doc,
            status: 'PASS',
            message: 'Documentation found',
            critical: false
          });
        } else {
          this.addResult({
            category: 'Documentation',
            name: doc,
            status: 'WARN',
            message: 'Documentation exists but may be incomplete',
            critical: false
          });
        }
      } else {
        this.addResult({
          category: 'Documentation',
          name: doc,
          status: 'FAIL',
          message: 'Documentation missing',
          critical: false
        });
      }
    }
  }

  private addResult(result: CheckResult): void {
    this.results.push(result);
  }

  private printResults(): void {
    console.log('\n========================================');
    console.log('Results Summary');
    console.log('========================================\n');

    const byCategory = this.results.reduce((acc, result) => {
      if (!acc[result.category]) {
        acc[result.category] = [];
      }
      acc[result.category].push(result);
      return acc;
    }, {} as Record<string, CheckResult[]>);

    for (const [category, results] of Object.entries(byCategory)) {
      console.log(`\n${category}:`);
      console.log('─'.repeat(40));

      for (const result of results) {
        const icon = result.status === 'PASS' ? '✓' : result.status === 'FAIL' ? '✗' : '⚠';
        const color = result.status === 'PASS' ? '\x1b[32m' : result.status === 'FAIL' ? '\x1b[31m' : '\x1b[33m';
        const reset = '\x1b[0m';

        console.log(`  ${color}${icon}${reset} ${result.name}: ${result.message}`);
      }
    }

    // Summary counts
    const passed = this.results.filter(r => r.status === 'PASS').length;
    const failed = this.results.filter(r => r.status === 'FAIL').length;
    const warnings = this.results.filter(r => r.status === 'WARN').length;

    console.log('\n========================================');
    console.log(`Passed: ${passed} | Failed: ${failed} | Warnings: ${warnings}`);
    console.log('========================================\n');
  }

  private exitIfCriticalFailures(): void {
    const criticalFailures = this.results.filter(r => r.critical && r.status === 'FAIL');

    if (criticalFailures.length > 0) {
      console.log('\x1b[31m✗ CRITICAL FAILURES DETECTED\x1b[0m');
      console.log('Cannot proceed to production with critical failures.\n');
      console.log('Failed checks:');

      for (const failure of criticalFailures) {
        console.log(`  - ${failure.category}: ${failure.name} - ${failure.message}`);
      }

      console.log('\nFix these issues before deploying to mainnet.');
      process.exit(1);
    } else {
      console.log('\x1b[32m✓ PRODUCTION READY\x1b[0m');
      console.log('All critical checks passed. Review warnings before deployment.\n');
      process.exit(0);
    }
  }
}

// Run checks
const checker = new ProductionReadinessChecker();
checker.runAllChecks().catch(error => {
  console.error('Error running production checks:', error.message);
  process.exit(1);
});
