#!/bin/bash

# Devnet Deployment Script
# Simplified workflow for testing on Devnet

set -e

echo "========================================="
echo "Shadow Privacy - Devnet Deployment"
echo "========================================="
echo ""

# Build Solana program
echo "Building Solana program..."
cd programs/shadow-privacy
cargo build-bpf

if [ $? -ne 0 ]; then
  echo "Program build FAILED"
  exit 1
fi

cd ../..

# Deploy program
echo ""
echo "Deploying program to devnet..."

# Ensure we are on devnet
solana config set --url devnet

# Optional: Try to airdrop some SOL if balance is low
BALANCE=$(solana balance | awk '{print $1}')
echo "Current balance: $BALANCE SOL"

solana program deploy programs/shadow-privacy/target/deploy/shadow_privacy.so

if [ $? -ne 0 ]; then
  echo "Program deployment FAILED"
  echo "Make sure you have enough SOL (try: solana airdrop 2)"
  exit 1
fi

# Get program ID
PROGRAM_ID=$(solana program show programs/shadow-privacy/target/deploy/shadow_privacy.so --output json | jq -r '.programId')

echo ""
echo "========================================="
echo "Deployment Complete"
echo "========================================="
echo "Program ID: $PROGRAM_ID"
echo ""
echo "Next steps:"
echo "1. Update config/devnet.json with program ID: $PROGRAM_ID"
echo "2. Run dashboard: export SHADOW_ENV=devnet && npm start"
echo ""
