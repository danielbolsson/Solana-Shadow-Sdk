# Ghost Privacy - Real Multi-Party Trusted Setup Ceremony

**Production-grade ceremony coordinator for real independent participants.**

This is **NOT** a simulation. This system facilitates an actual multi-party ceremony where real, independent participants contribute randomness to generate production keys.

## System Overview

### Architecture

```
┌─────────────────┐
│   Coordinator   │ ◄─── Manages ceremony flow
│   Web Server    │      Verifies contributions
│   (Public)      │      Tracks participants
└────────┬────────┘
         │
    ┌────┴────┬────────┬────────┐
    │         │        │        │
┌───▼───┐ ┌──▼────┐ ┌─▼─────┐ ┌▼──────┐
│Part. 1│ │Part. 2│ │Part. 3│ │Part. N│
└───────┘ └───────┘ └───────┘ └───────┘
Real independent participants
Using CLI tool from different locations
```

### Security Model

- **Coordinator**: Trusted to manage workflow, NOT trusted with ceremony security
- **Participants**: Independent parties, only ONE needs to be honest for security
- **Verification**: Every contribution is cryptographically verified before acceptance

## Prerequisites

```bash
# Install Node.js 16+
node --version

# Install snarkjs globally
npm install -g snarkjs

# Install coordinator dependencies
npm install
```

## For Coordinators

### 1. Setup

```bash
cd ceremony-coordinator
npm install

# Set coordinator secret (keep this private!)
export COORDINATOR_SECRET="your-random-secret-here"
```

### 2. Start Server

```bash
npm start

# Server runs on http://localhost:4000
# Dashboard: http://localhost:4000
```

### 3. Initialize Ceremony

```bash
# Initialize Phase 1
curl -X POST http://localhost:4000/api/coordinator/initialize \
  -H "Content-Type: application/json" \
  -d '{"secret":"your-coordinator-secret"}'
```

### 4. Monitor Progress

Open dashboard in browser: `http://localhost:4000`

- View participant queue
- See contribution hashes
- Track ceremony progress
- Monitor verification status

### 5. Finalize Phase 1

After all Phase 1 participants contribute:

```bash
# Get Bitcoin block hash or DRAND beacon
BEACON="000000000000000000024bead8df69990852c202db0e0097c1a12ea637d7e96d"

curl -X POST http://localhost:4000/api/coordinator/finalize-phase1 \
  -H "Content-Type: application/json" \
  -d "{\"secret\":\"your-coordinator-secret\",\"beacon\":\"$BEACON\"}"
```

### 6. Initialize Phase 2 Circuits

```bash
# Transfer circuit
curl -X POST http://localhost:4000/api/coordinator/init-phase2 \
  -H "Content-Type: application/json" \
  -d '{"secret":"your-coordinator-secret","circuit":"transfer"}'

# Repeat for balance and ring_signature circuits
```

### 7. Publish Final Keys

After all contributions:

```bash
# Keys are in ceremony-coordinator/data/current/
# - pot20_final.ptau
# - transfer_final.zkey
# - balance_final.zkey
# - ring_sig_final.zkey

# Upload to IPFS/Arweave
ipfs add -r data/current/

# Copy to circuits/build/
cp data/current/*_final.zkey ../circuits/build/
cp data/current/*_verification_key.json ../circuits/build/
```

## For Participants

### 1. Setup

```bash
cd ceremony-coordinator
npm install

# If coordinator is remote, set URL
export COORDINATOR_URL="https://ceremony.ghostprivacy.io"
```

### 2. Run Participant CLI

```bash
npm run participant
```

### 3. Register

First time: CLI will ask for your details

```
Your name or organization: Alice Crypto
Your email: alice@example.com
Your PGP key (optional): [paste key]
```

### 4. Wait for Your Turn

Check status regularly:

```
Choice: 1 (Check ceremony status)
```

You'll see your position in the queue.

### 5. Download Current File

When it's your turn:

```
Choice: 2 (Download contribution file)
```

### 6. Make Contribution

**CRITICAL: Use a secure, air-gapped machine if possible!**

```
Choice: 3 (Make contribution)
```

This will:
1. Add your random entropy to the ceremony
2. Generate the next contribution file
3. Securely delete the input file (toxic waste)

**Entropy sources:**
- `/dev/urandom` (automatic)
- Physical dice rolls (recommended)
- Atmospheric noise
- Multiple sources XOR'd together

### 7. Upload Contribution

```
Choice: 4 (Upload contribution)
```

Provide a signed attestation:

```
I, Alice Crypto, participated in Ghost Privacy ceremony Phase 1.
Date: 2024-12-15
Entropy: /dev/urandom + 100 dice rolls
I destroyed all intermediate files.

GPG Signature:
-----BEGIN PGP SIGNATURE-----
...
-----END PGP SIGNATURE-----
```

### 8. Destroy Local Files

**EXTREMELY IMPORTANT:**

```bash
# Securely wipe all ceremony files
shred -vfz -n 10 participant-data/*.ptau
shred -vfz -n 10 participant-data/*.zkey

# Or on Windows
cipher /w:participant-data
```

## Participant Best Practices

### ✅ DO

- Use fresh, high-quality randomness
- Run ceremony on air-gapped machine
- Destroy ALL intermediate files after uploading
- Provide signed attestation
- Use unique entropy for Phase 1 and each Phase 2 circuit
- Verify downloaded files before contributing

### ❌ DON'T

- Reuse randomness across phases
- Keep copies of contribution files
- Use predictable entropy (timestamps, etc.)
- Run ceremony on compromised machine
- Skip verification steps
- Trust previous participants blindly

## API Reference

### Public Endpoints

**GET /api/status**
```json
{
  "phase": "phase1",
  "currentParticipant": 5,
  "totalParticipants": 20,
  "participants": [...],
  "progress": {
    "phase1": false,
    "transfer": false,
    "balance": false,
    "ring": false
  }
}
```

**POST /api/register**
```json
{
  "name": "Alice",
  "email": "alice@example.com",
  "pgpKey": "optional"
}
```

**GET /api/download/current**
```
?participantId=abc123
```

**POST /api/upload/contribution**
```
multipart/form-data:
  - file: contribution.ptau
  - participantId: abc123
  - attestation: "I, Alice..."
```

### Coordinator-Only Endpoints

Require `COORDINATOR_SECRET` in request body.

**POST /api/coordinator/initialize**

**POST /api/coordinator/finalize-phase1**

**POST /api/coordinator/init-phase2**

## Timeline Example

### Real Ceremony with 15 Participants

| Week | Activity |
|------|----------|
| 0 | Setup coordinator, recruit participants |
| 1-2 | Phase 1 contributions (15 participants) |
| 3 | Finalize Phase 1, apply beacon |
| 4 | Phase 2 Transfer circuit (15 participants) |
| 5 | Phase 2 Balance circuit (15 participants) |
| 6 | Phase 2 Ring Signature (15 participants) |
| 7 | Finalize all circuits, publish keys |
| 8 | Deploy to production, archive ceremony |

**Total: ~8 weeks for 15 real participants**

## Verification

Anyone can verify the ceremony was performed correctly:

```bash
# Verify Powers of Tau
snarkjs powersoftau verify data/current/pot20_final.ptau

# Verify each circuit
snarkjs zkey verify \
  ../circuits/build/transfer.r1cs \
  data/current/pot20_final.ptau \
  data/current/transfer_final.zkey
```

## Troubleshooting

### Contribution verification failed

- Check file integrity (SHA256 hash)
- Ensure you downloaded correct file
- Verify snarkjs version matches

### Upload rejected (not your turn)

- Check your position with `Choice: 1`
- Wait for notification
- Coordinator may have paused ceremony

### File too large

- Phase 1 .ptau files: ~100-200 MB
- Phase 2 .zkey files: ~50-150 MB
- Increase `limits.fileSize` in server.js if needed

## Security Considerations

### Threat Model

**Protected against:**
- Malicious ceremony coordinator
- All-but-one malicious participants
- Network attacks (MITM)

**NOT protected against:**
- Bugs in circuits (requires audit)
- All participants colluding
- Physical attacks on participant machines

### Recommendations

1. **Diverse participants**: Different countries, organizations, expertise levels
2. **Time-separated contributions**: Prevents collusion
3. **Public randomness beacon**: Bitcoin blocks, DRAND
4. **Transparent process**: Live stream, public attestations
5. **Multiple verification tools**: Independent verification of outputs

## After Ceremony

1. **Publish artifacts** to IPFS, Arweave, GitHub releases
2. **Collect all attestations** in public repository
3. **Create ceremony transcript** with participant list, hashes, beacon
4. **Archive coordinator logs** for transparency
5. **Deploy keys** to Solana program
6. **Announce completion** with verification instructions

## Support

- Issues: https://github.com/Ghost-Sdk/Ghost-Sdk/issues
- Documentation: `../TRUSTED_SETUP.md`
- Community: [Your Discord/Telegram]

## License

MIT

---

**Remember: Only ONE honest participant is needed for security!**
