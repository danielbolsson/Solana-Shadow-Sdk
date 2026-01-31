# Deployment Guide

Complete guide for deploying Shadow Privacy to Localnet, Devnet, and Mainnet.

## 1. Prerequisites

Before starting, ensure you have:
- **Rust & Solana Toolchain**: Installed and updated.
- **Node.js**: v18+.
- **Dependencies**: Run `npm install` in root, `circuits`, and `privacy-integration`.
- **Wallet**: A Solana keypair (`~/.config/solana/id.json`) with sufficient funds.

---

## 2. Local Development (Localnet)

Run a full local stack for development and testing.

### Step 1: Start Local Validator
```bash
solana-test-validator
```

### Step 2: Build & Deploy Program
```bash
# Build
cd programs/shadow-privacy
cargo build-bpf

# Deploy
solana config set --url localhost
solana program deploy target/deploy/shadow_privacy.so
# Note the Program ID!
```

### Step 3: Run Dashboard & Relayer
```bash
# In a new terminal
cd web-dashboard
export SHADOW_ENV=localnet
export SHADOW_PROGRAM_ID=<YOUR_PROGRAM_ID> 
npm start
```
*   Dashboard: `http://localhost:5000`
*   Demo: `http://localhost:5000/transfer.html`

---

## 3. Staging (Devnet)

Deploy to the public Devnet for integration testing.

### Step 1: Deployment Script
We provide a helper script to automate this:

```bash
# 1. Switch to Devnet
solana config set --url devnet

# 2. Get Faucet Funds (need ~3-5 SOL)
# You can use https://faucet.solana.com if solana airdrop is rate limited
solana airdrop 2
solana airdrop 2

# 3. Run Deploy Script
./scripts/deploy-devnet.sh
```

### Step 2: Update Configuration
1.  Copy the **Program ID** from the script output.
2.  Open `config/devnet.json`.
3.  Update `"programId": "YOUR_NEW_PROGRAM_ID"`.

### Step 3: Configure & Fund Relayer
The dashboard includes a built-in relayer for fee abstraction. On Devnet, you must manually fund its account.

1.  **Find the Relayer Address**:
    ```bash
    solana address -k ~/.config/solana/relayer.json
    ```
    *(If this file doesn't exist, start the dashboard once to generate it)*

2.  **Fund the Relayer**:
    Transfer ~1-2 SOL to this address so it can pay for relayed withdrawal transactions.
    ```bash
    solana transfer <RELAYER_ADDRESS> 1
    ```

### Step 4: Run Public Dashboard
```bash
export SHADOW_ENV=devnet
npm start
```

---

## 4. Production (Mainnet Beta)

**⚠️ CRITICAL**: Deploying to mainnet requires a completed Trusted Setup Ceremony and strict security checks.

### Step 1: Complete Trusted Setup
Follow the [Trusted Setup Guide](TRUSTED_SETUP.md) to generate production `zkey` files. **Do not use devnet/test keys.**

### Step 2: Configuration
Create a secure `.env` file or `config/mainnet.json` (gitignored):

```bash
# .env
SHADOW_ENV=mainnet
SHADOW_RPC_URL=https://api.mainnet-beta.solana.com
SHADOW_PROGRAM_ID=<YOUR_DEPLOYED_PROGRAM_ID>
SHADOW_REQUIRE_CEREMONY=true
SHADOW_ENCRYPT_NOTES=true
SHADOW_STORAGE_PASSWORD=<STRONG_PASSWORD>
```

### Step 3: Production Readiness Check
This script verifies your configuration, ceremony files, and security settings:
```bash
SHADOW_ENV=mainnet ts-node scripts/production-readiness-check.ts
```
*You cannot proceed until this passes with exit code 0.*

### Step 4: Secure Deployment
Use the automated script to deploy safely:
```bash
SHADOW_ENV=mainnet bash scripts/deploy-mainnet.sh
```

### Step 5: Post-Deployment Verification
1.  **Verify Program**: Ensure on-chain bytecode matches your build.
2.  **Verify Keys**: Check that the deployed program is using the correct Verifying Keys (VKs) from the ceremony.
3.  **Monitor**: Start the dashboard in production mode:
    ```bash
    pm2 start web-dashboard/dashboard-server.ts --name shadow-monitor
    ```

---

## 5. Troubleshooting common issues

### "Stack offset exceeded"
If you see this during `cargo build-bpf`, it is a known issue with some Rust/Solana versions.
**Fix**: Ensure you are using the Solana toolchain's cargo:
```bash
~/.local/share/solana/install/active_release/bin/cargo build-bpf
```

### "Program not found" on Frontend
Ensure:
1.  `SHADOW_PROGRAM_ID` matches the deployed ID.
2.  Your wallet is connected to the same network (Devnet vs Localnet).
3.  The `config/<env>.json` file is updated.

### "Custom: 0x1" (Insufficient Funds)
The Relayer or User does not have enough SOL for the transaction fee.
*   **Devnet**: `solana airdrop 1`
*   **Mainnet**: Fund the relayer wallet.
