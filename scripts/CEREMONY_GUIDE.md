# Practical Trusted Setup Ceremony Guide

## Quick Start

### Prerequisites

1. **Install snarkjs**:
```bash
npm install -g snarkjs
```

2. **Compile circuits** (if not already done):
```bash
cd circuits
./build.sh  # Unix/Mac
# or
build-circuits.bat  # Windows
```

3. **Verify circuits are compiled**:
```bash
ls circuits/*.r1cs
# Should see: transfer.r1cs, balance.r1cs, ring_signature.r1cs
```

## Option 1: Local Test Ceremony (Development/Testing)

For testing purposes, run a local ceremony with simulated participants:

### Windows:
```cmd
cd scripts
run-ceremony.bat
```

### Linux/Mac:
```bash
cd scripts
chmod +x run-ceremony.sh
./run-ceremony.sh
```

**When prompted:**
- Number of participants: Enter `3` (minimum for testing)
- Beacon value: Press Enter to auto-generate

This will create production-quality keys locally in about 5-10 minutes.

## Option 2: Real Multi-Party Ceremony (Production)

For production deployment with real participants:

### Step 1: Coordinator Setup

**Create ceremony repository:**
```bash
mkdir ghost-ceremony
cd ghost-ceremony
git init
```

**Initialize Phase 1:**
```bash
snarkjs powersoftau new bn128 20 pot20_0000.ptau -v
```

**Upload to public location:**
```bash
# Option 1: GitHub Release
gh release create ceremony-v1 pot20_0000.ptau

# Option 2: IPFS
ipfs add pot20_0000.ptau

# Option 3: Web server
scp pot20_0000.ptau user@ceremony.example.com:/public/
```

**Calculate and publish hash:**
```bash
sha256sum pot20_0000.ptau > hashes.txt
cat hashes.txt
```

### Step 2: Participant Contribution (Each Participant)

**Download latest contribution:**
```bash
# Get current contribution number from coordinator
CURRENT=0  # Or 1, 2, 3... based on position
wget https://ceremony.example.com/pot20_$(printf "%04d" $CURRENT).ptau
```

**Verify previous contribution (if CURRENT > 0):**
```bash
snarkjs powersoftau verify pot20_$(printf "%04d" $CURRENT).ptau
```

**Add your contribution:**
```bash
NEXT=$((CURRENT + 1))

# Generate strong entropy
ENTROPY=$(head -c 1024 /dev/urandom | sha256sum | head -c 64)

# Contribute
snarkjs powersoftau contribute \
  pot20_$(printf "%04d" $CURRENT).ptau \
  pot20_$(printf "%04d" $NEXT).ptau \
  --name="Your Name or Organization" \
  -v -e="$ENTROPY"
```

**Verify your contribution:**
```bash
snarkjs powersoftau verify pot20_$(printf "%04d" $NEXT).ptau
```

**Calculate hash and upload:**
```bash
sha256sum pot20_$(printf "%04d" $NEXT).ptau

# Upload to coordinator
# Send hash + attestation
```

**CRITICAL: Destroy local files:**
```bash
# Linux/Mac
shred -vfz -n 10 pot20_$(printf "%04d" $CURRENT).ptau

# Windows (use cipher)
cipher /w:pot20_000X.ptau

# Or just delete if no sensitive tools available
# (but shredding is highly recommended)
```

**Write attestation:**
```
I, [Your Name], participated in the Shadow Privacy Trusted Setup.

Contribution: Phase 1 #X
Date: 2024-XX-XX
Entropy source: /dev/urandom
File hash: sha256(...)

I verify that I:
1. Generated fresh, high-quality randomness
2. Destroyed all intermediate files after contribution
3. Did not retain any toxic waste
4. Used secure hardware and environment

Signature: [GPG signature or contact info]
```

### Step 3: Finalize Phase 1 (Coordinator)

After all Phase 1 participants contribute:

**Apply random beacon:**
```bash
# Wait for future Bitcoin block
# Example: Use block #870000 (scheduled for specific date/time)

# When block is mined, get hash
BEACON="<64-char hex block hash>"

# Apply beacon
snarkjs powersoftau beacon \
  pot20_FINAL.ptau \
  pot20_beacon.ptau \
  "$BEACON" \
  10 \
  -n="Bitcoin Block #870000"
```

**Prepare for Phase 2:**
```bash
snarkjs powersoftau prepare phase2 pot20_beacon.ptau pot20_final.ptau -v
snarkjs powersoftau verify pot20_final.ptau
```

**Publish:**
```bash
sha256sum pot20_final.ptau
# Upload to permanent storage (IPFS, Arweave, etc.)
```

### Step 4: Phase 2 - Circuit-Specific Setup

Repeat for each circuit (transfer, balance, ring_signature).

**Example: Transfer Circuit**

**Initialize (Coordinator):**
```bash
snarkjs groth16 setup circuits/transfer.r1cs pot20_final.ptau transfer_0000.zkey
# Upload transfer_0000.zkey
```

**Each Participant:**
```bash
# Download
wget https://ceremony.example.com/transfer_$(printf "%04d" $CURRENT).zkey

# Contribute
snarkjs zkey contribute \
  transfer_$(printf "%04d" $CURRENT).zkey \
  transfer_$(printf "%04d" $NEXT).zkey \
  --name="Your Name Transfer" \
  -v -e="$ENTROPY"

# Upload and destroy
sha256sum transfer_$(printf "%04d" $NEXT).zkey
shred -vfz -n 10 transfer_$(printf "%04d" $CURRENT).zkey
```

**Finalize (Coordinator):**
```bash
# Apply beacon
snarkjs zkey beacon transfer_FINAL.zkey transfer_beacon.zkey "$BEACON" 10

# Verify
snarkjs zkey verify circuits/transfer.r1cs pot20_final.ptau transfer_beacon.zkey

# Export VK
snarkjs zkey export verificationkey transfer_beacon.zkey transfer_verification_key.json

# Rename
mv transfer_beacon.zkey transfer_final.zkey

# Publish
sha256sum transfer_final.zkey
```

**Repeat for balance.circom and ring_signature.circom**

## Step 5: Deploy to Solana

**Copy production keys to build directory:**
```bash
cp ceremony/transfer_final.zkey circuits/build/
cp ceremony/transfer_verification_key.json circuits/build/
cp ceremony/balance_final.zkey circuits/build/
cp ceremony/balance_verification_key.json circuits/build/
cp ceremony/ring_sig_final.zkey circuits/build/ring_signature_final.zkey
cp ceremony/ring_signature_verification_key.json circuits/build/
```

**Upload verification keys to Solana:**
```bash
cd privacy-integration
npx ts-node store-verification-keys.ts
```

**Verify deployment:**
```bash
# Check VK accounts exist on-chain
solana account <VK_PDA_ADDRESS>
```

## Step 6: Publish Ceremony Artifacts

**Create ceremony transcript:**
```markdown
# Shadow Privacy Trusted Setup - Final Report

## Timeline
- Start: 2024-XX-XX
- End: 2024-XX-XX
- Duration: X weeks

## Participants
Phase 1 (Powers of Tau):
1. Alice (alice@example.com) - Contribution #1
2. Bob (bob@example.com) - Contribution #2
...

Phase 2 Transfer:
1. Alice - Contribution #1
...

## Beacon
Bitcoin Block #870000
Hash: 0x...

## Final Parameters

### Powers of Tau
- File: pot20_final.ptau
- Size: XXX MB
- SHA256: abc123...
- IPFS: QmXXX...

### Transfer Circuit
- File: transfer_final.zkey
- Size: XXX MB
- SHA256: def456...
- IPFS: QmYYY...
- VK SHA256: ghi789...
- Solana VK PDA: xxxxx...

### Balance Circuit
- File: balance_final.zkey
- Size: XXX MB
- SHA256: jkl012...
- IPFS: QmZZZ...
- VK SHA256: mno345...
- Solana VK PDA: yyyyy...

### Ring Signature Circuit
- File: ring_sig_final.zkey
- Size: XXX MB
- SHA256: pqr678...
- IPFS: QmAAA...
- VK SHA256: stu901...
- Solana VK PDA: zzzzz...

## Verification
All parameters verified with snarkjs.
Security assumption: At least ONE participant was honest.
```

**Upload to permanent storage:**
```bash
# IPFS
ipfs add -r ceremony/

# Arweave (using arkb)
arkb deploy ceremony/

# GitHub Release
gh release create production-keys-v1 \
  ceremony/transfer_final.zkey \
  ceremony/balance_final.zkey \
  ceremony/ring_sig_final.zkey \
  ceremony/pot20_final.ptau
```

## Verification for Users

Anyone can verify the ceremony:

```bash
# Download files
wget https://setup.ghostprivacy.io/transfer_final.zkey
wget https://setup.ghostprivacy.io/pot20_final.ptau

# Verify
snarkjs zkey verify circuits/transfer.r1cs pot20_final.ptau transfer_final.zkey

# Should output: [OK] Valid Key
```

## Timeline Recommendation

**Minimum (3 participants):** 1 week
- Day 1-2: Phase 1 (3 contributions)
- Day 3: Apply beacon, prepare Phase 2
- Day 4-5: Transfer circuit (3 contributions)
- Day 6: Balance + Ring Sig circuits
- Day 7: Finalize, verify, publish

**Recommended (10+ participants):** 4-6 weeks
- Week 1-2: Phase 1 contributions
- Week 3: Phase 2 Transfer circuit
- Week 4: Phase 2 Balance circuit
- Week 5: Phase 2 Ring Sig circuit
- Week 6: Finalize, verify, publish

**Production (20+ participants):** 8-12 weeks
- Allow time for coordination
- Participant scheduling
- Verification delays
- Documentation

## Security Checklist

**Before Ceremony:**
- [ ] Circuits finalized and audited
- [ ] Participants selected (diverse, independent)
- [ ] Coordinator chosen (will NOT participate)
- [ ] Communication channels established
- [ ] Ceremony schedule published

**During Ceremony:**
- [ ] Each contribution verified before next
- [ ] Hashes published publicly
- [ ] Participants confirm receipt/upload
- [ ] Attestations collected
- [ ] Toxic waste destroyed

**After Ceremony:**
- [ ] All keys verified
- [ ] Transcript published
- [ ] Keys uploaded to IPFS/Arweave
- [ ] VKs deployed to Solana
- [ ] Ceremony artifacts archived
- [ ] Community verification period

## Troubleshooting

**Verification fails:**
```bash
# Re-verify previous contribution
snarkjs powersoftau verify pot20_000X.ptau

# Check file integrity
sha256sum pot20_000X.ptau
```

**Out of memory:**
```bash
# Use smaller circuit or more RAM
# For 2^20 constraints, need ~8GB RAM
# For 2^25 constraints, need ~32GB RAM
```

**Contribution takes too long:**
```bash
# Normal times:
# Phase 1 contribution: 10-30 minutes
# Phase 2 contribution: 5-15 minutes per circuit

# If > 1 hour, check:
# - CPU speed
# - Available RAM
# - Disk speed
```

## Questions?

- Review: `TRUSTED_SETUP.md` for detailed theory
- Issues: https://github.com/Shadow-Sdk/Shadow-Sdk/issues
- Community: [Your Discord/Telegram]

## Summary

1. **Local test**: Run `run-ceremony.bat` or `run-ceremony.sh`
2. **Production**: Follow multi-party process with real participants
3. **Deploy**: Upload VKs to Solana with `store-verification-keys.ts`
4. **Verify**: Anyone can verify ceremony was performed correctly

**Remember:** Only ONE honest participant is needed for security!
