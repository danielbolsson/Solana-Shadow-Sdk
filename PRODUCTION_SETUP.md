# Production Setup Guide

Complete guide for deploying Shadow Privacy to Solana mainnet.

## Prerequisites

- Completed trusted setup ceremony
- All circuit files generated from ceremony
- Solana program deployed to mainnet
- Production configuration prepared
- Relayer infrastructure (optional but recommended)

## Configuration

### 1. Environment Variables

Create a `.env` file (NEVER commit this):

```bash
# Network
SHADOW_ENV=mainnet
SHADOW_RPC_URL=https://api.mainnet-beta.solana.com
SHADOW_PROGRAM_ID=<YOUR_DEPLOYED_PROGRAM_ID>
SHADOW_COMMITMENT=finalized

# Circuits (from ceremony output)
SHADOW_TRANSFER_CIRCUIT=./circuits/build/transfer_final.zkey
SHADOW_BALANCE_CIRCUIT=./circuits/build/balance_final.zkey
SHADOW_RING_SIG_CIRCUIT=./circuits/build/ring_signature_final.zkey

# Security
SHADOW_REQUIRE_CEREMONY=true
SHADOW_CEREMONY_HASH=<HASH_FROM_CEREMONY_TRANSCRIPT>
SHADOW_ENCRYPT_NOTES=true
SHADOW_STORAGE_PASSWORD=<STRONG_PASSWORD>

# Relayer
SHADOW_RELAYER_ENABLED=true
SHADOW_RELAYER_ENDPOINTS=https://relayer1.example.com,https://relayer2.example.com
SHADOW_MIN_REPUTATION=75
```

### 2. Configuration File

Alternatively, create `config/mainnet.json`:

```json
{
  "environment": "mainnet",
  "network": {
    "rpcUrl": "https://api.mainnet-beta.solana.com",
    "programId": "YOUR_PROGRAM_ID",
    "commitment": "finalized"
  },
  "circuits": {
    "transferCircuit": "./circuits/build/transfer_final.zkey",
    "balanceCircuit": "./circuits/build/balance_final.zkey",
    "ringSignatureCircuit": "./circuits/build/ring_signature_final.zkey",
    "transferVK": "./circuits/build/transfer_verification_key.json",
    "balanceVK": "./circuits/build/balance_verification_key.json",
    "ringSignatureVK": "./circuits/build/ring_signature_verification_key.json"
  },
  "relayer": {
    "enabled": true,
    "endpoints": [
      "https://relayer1.example.com",
      "https://relayer2.example.com",
      "https://relayer3.example.com"
    ],
    "minReputation": 75,
    "timeout": 30000
  },
  "security": {
    "requireCeremonyComplete": true,
    "ceremonyVerificationHash": "HASH_FROM_CEREMONY",
    "encryptNotes": true,
    "maxTransactionRetries": 3
  }
}
```

**IMPORTANT:** Add `config/mainnet.json` to `.gitignore` if it contains sensitive data.

## Deployment Steps

### 1. Complete Trusted Setup Ceremony

```bash
# Start ceremony coordinator
cd ceremony-coordinator
npm install
npm start

# Participants contribute using CLI
node participant-cli.js
```

See `TRUSTED_SETUP.md` for complete ceremony instructions.

### 2. Run Production Readiness Check

```bash
SHADOW_ENV=mainnet ts-node scripts/production-readiness-check.ts
```

This validates:
- Configuration correctness
- Ceremony completion
- Circuit files exist
- Program built
- Security settings enabled
- Documentation complete

All critical checks must pass.

### 3. Deploy Solana Program

```bash
# Build
cd programs/shadow-privacy
cargo build-bpf --release

# Deploy
solana config set --url mainnet-beta
solana program deploy target/deploy/shadow_privacy.so

# Note the program ID from output
```

### 4. Update Configuration

Update `config/mainnet.json` or environment variables with:
- Deployed program ID
- Ceremony verification hash from transcript
- Production RPC endpoints
- Relayer URLs

### 5. Automated Deployment

Use the deployment script:

```bash
SHADOW_ENV=mainnet bash scripts/deploy-mainnet.sh
```

This runs all checks and deploys if validation passes.

## SDK Usage in Production

### Initialize SDK

```typescript
import { ShadowPrivacySDK } from './privacy-integration/privacy-sdk';

// Configuration loaded automatically from environment or config file
const sdk = new ShadowPrivacySDK({
  password: process.env.SHADOW_STORAGE_PASSWORD // For encrypted storage
});

await sdk.initialize();
```

### Storage Security

Notes are encrypted with AES-256-GCM when password is provided:

```typescript
// Encrypted storage (production)
const sdk = new ShadowPrivacySDK({
  password: 'strong-password'
});

// Plaintext storage (development only)
const sdk = new ShadowPrivacySDK();
```

**NEVER use plaintext storage in production.**

## Security Checklist

- [ ] Trusted setup ceremony completed with 3+ participants
- [ ] Ceremony transcript published and verified
- [ ] All keys from ceremony securely deleted
- [ ] Note encryption enabled (`encryptNotes: true`)
- [ ] Storage password set (`SHADOW_STORAGE_PASSWORD`)
- [ ] Ceremony verification required (`requireCeremonyComplete: true`)
- [ ] Configuration uses environment variables (no hardcoded values)
- [ ] Mainnet RPC URL configured
- [ ] Program ID updated after deployment
- [ ] No sensitive files in repository (.env, wallets)
- [ ] Relayer endpoints secured with HTTPS
- [ ] Production readiness check passes

## Environment Separation

Use different configurations for each environment:

```bash
# Development
SHADOW_ENV=devnet npm start

# Testnet
SHADOW_ENV=testnet npm start

# Production
SHADOW_ENV=mainnet npm start
```

## Monitoring

After deployment:

1. Monitor program logs
2. Track transaction success rates
3. Monitor relayer uptime
4. Verify proof verification on-chain
5. Check nullifier double-spend protection

## Troubleshooting

### Configuration Validation Failed

```
Configuration validation failed:
CRITICAL: security.requireCeremonyComplete must be true for mainnet
```

Solution: Update configuration to enforce ceremony completion.

### Ceremony Verification Failed

```
Ceremony key verification failed
```

Solution: Verify `ceremonyVerificationHash` matches transcript. Regenerate circuits if needed.

### Storage Decryption Failed

```
Failed to decrypt notes. Invalid password or corrupted data.
```

Solution: Verify password is correct. Check backup if data corrupted.

## Backup and Recovery

### Backup Encrypted Notes

```typescript
import { EncryptedNoteStorage } from './privacy-integration/encrypted-note-storage';

const storage = new EncryptedNoteStorage();
await storage.backup('/secure/path/notes-backup.enc');
```

### Restore from Backup

```typescript
await storage.restore('/secure/path/notes-backup.enc', password);
```

## Support

For deployment issues:
- Review production readiness check output
- Verify ceremony transcript
- Check Solana program logs
- Ensure correct network configuration
