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
GHOST_ENV=mainnet
GHOST_RPC_URL=https://api.mainnet-beta.solana.com
GHOST_PROGRAM_ID=<YOUR_DEPLOYED_PROGRAM_ID>
GHOST_COMMITMENT=finalized

# Circuits (from ceremony output)
GHOST_TRANSFER_CIRCUIT=./circuits/build/transfer_final.zkey
GHOST_BALANCE_CIRCUIT=./circuits/build/balance_final.zkey
GHOST_RING_SIG_CIRCUIT=./circuits/build/ring_signature_final.zkey

# Security
GHOST_REQUIRE_CEREMONY=true
GHOST_CEREMONY_HASH=<HASH_FROM_CEREMONY_TRANSCRIPT>
GHOST_ENCRYPT_NOTES=true
GHOST_STORAGE_PASSWORD=<STRONG_PASSWORD>

# Relayer
GHOST_RELAYER_ENABLED=true
GHOST_RELAYER_ENDPOINTS=https://relayer1.example.com,https://relayer2.example.com
GHOST_MIN_REPUTATION=75
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
GHOST_ENV=mainnet ts-node scripts/production-readiness-check.ts
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
cd programs/ghost-privacy
cargo build-bpf --release

# Deploy
solana config set --url mainnet-beta
solana program deploy target/deploy/ghost_privacy.so

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
GHOST_ENV=mainnet bash scripts/deploy-mainnet.sh
```

This runs all checks and deploys if validation passes.

## SDK Usage in Production

### Initialize SDK

```typescript
import { ShadowPrivacySDK } from './privacy-integration/privacy-sdk';

// Configuration loaded automatically from environment or config file
const sdk = new ShadowPrivacySDK({
  password: process.env.GHOST_STORAGE_PASSWORD // For encrypted storage
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
- [ ] Storage password set (`GHOST_STORAGE_PASSWORD`)
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
GHOST_ENV=devnet npm start

# Testnet
GHOST_ENV=testnet npm start

# Production
GHOST_ENV=mainnet npm start
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
