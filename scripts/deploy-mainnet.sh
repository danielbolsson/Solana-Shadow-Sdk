#!/bin/bash

# Mainnet Deployment Script
# Comprehensive deployment workflow with all safety checks

set -e

echo "========================================="
echo "Shadow Privacy - Mainnet Deployment"
echo "========================================="
echo ""

# Check environment
if [ "$GHOST_ENV" != "mainnet" ]; then
  echo "ERROR: GHOST_ENV must be set to 'mainnet'"
  echo "Current: $GHOST_ENV"
  exit 1
fi

# Run production readiness check
echo "Running production readiness checks..."
ts-node scripts/production-readiness-check.ts

if [ $? -ne 0 ]; then
  echo ""
  echo "Production readiness check FAILED"
  echo "Fix all critical issues before deploying"
  exit 1
fi

echo ""
echo "All checks passed. Proceeding with deployment..."
echo ""

# Build Solana program
echo "Building Solana program..."
cd programs/ghost-privacy
cargo build-bpf --release

if [ $? -ne 0 ]; then
  echo "Program build FAILED"
  exit 1
fi

cd ../..

# Deploy program
echo ""
echo "Deploying program to mainnet..."
echo "WARNING: This will deploy to Solana mainnet-beta"
read -p "Continue? (yes/no): " confirm

if [ "$confirm" != "yes" ]; then
  echo "Deployment cancelled"
  exit 0
fi

solana config set --url mainnet-beta
solana program deploy programs/ghost-privacy/target/deploy/ghost_privacy.so

if [ $? -ne 0 ]; then
  echo "Program deployment FAILED"
  exit 1
fi

# Get program ID
PROGRAM_ID=$(solana program show programs/ghost-privacy/target/deploy/ghost_privacy.so --output json | jq -r '.programId')

echo ""
echo "========================================="
echo "Deployment Complete"
echo "========================================="
echo "Program ID: $PROGRAM_ID"
echo ""
echo "Next steps:"
echo "1. Update config/mainnet.json with program ID: $PROGRAM_ID"
echo "2. Update relayer configuration"
echo "3. Test with small amounts first"
echo "4. Publish ceremony transcript"
echo ""
