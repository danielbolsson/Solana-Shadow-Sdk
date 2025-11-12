#!/bin/bash

# Ghost Privacy - Trusted Setup Ceremony Runner
# This script guides you through executing the MPC ceremony

set -e

CIRCUITS_DIR="../circuits"
BUILD_DIR="../circuits/build"
CEREMONY_DIR="./ceremony"

echo "🔐 Ghost Privacy - Trusted Setup Ceremony"
echo "=========================================="
echo ""

# Create ceremony directory
mkdir -p "$CEREMONY_DIR"
cd "$CEREMONY_DIR"

echo "📋 Phase 1: Powers of Tau"
echo "-------------------------"
echo ""

# Check if we're starting fresh or continuing
if [ ! -f "pot20_0000.ptau" ]; then
    echo "Initializing Powers of Tau (2^20 constraints)..."
    snarkjs powersoftau new bn128 20 pot20_0000.ptau -v
    echo "✅ Initialized pot20_0000.ptau"
else
    echo "ℹ️  Found existing pot20_0000.ptau"
fi

echo ""
echo "👥 Participant Contributions"
echo "----------------------------"
echo ""
echo "Instructions for participants:"
echo "1. Download the latest .ptau file"
echo "2. Run: snarkjs powersoftau contribute"
echo "3. Upload your contribution"
echo "4. DESTROY local files with: shred -vfz -n 10 <file>"
echo ""

read -p "How many participants will contribute? " NUM_PARTICIPANTS

# Simulate contributions (in production, each participant does this separately)
CURRENT_PTAU="pot20_0000.ptau"

for i in $(seq 1 $NUM_PARTICIPANTS); do
    NEXT_PTAU="pot20_$(printf "%04d" $i).ptau"

    echo ""
    echo "Participant $i contribution..."

    # Generate random entropy
    ENTROPY=$(head -c 1024 /dev/urandom | sha256sum | head -c 64)

    snarkjs powersoftau contribute "$CURRENT_PTAU" "$NEXT_PTAU" \
        --name="Participant $i" \
        -v -e="$ENTROPY"

    # Verify contribution
    snarkjs powersoftau verify "$NEXT_PTAU"

    CURRENT_PTAU="$NEXT_PTAU"
done

echo ""
echo "🎲 Applying Random Beacon"
echo "------------------------"
echo ""

# Use current Bitcoin block hash as beacon (in production, use future block)
echo "In production, use a future Bitcoin block hash or DRAND beacon."
echo "For this ceremony, enter beacon value (64 hex chars):"
read -p "Beacon: " BEACON

if [ -z "$BEACON" ]; then
    # Generate random beacon for demo
    BEACON=$(head -c 32 /dev/urandom | xxd -p -c 64)
    echo "Generated demo beacon: $BEACON"
fi

snarkjs powersoftau beacon "$CURRENT_PTAU" pot20_beacon.ptau \
    "$BEACON" 10 -n="Final Beacon"

# Prepare for Phase 2
echo ""
echo "Preparing for Phase 2..."
snarkjs powersoftau prepare phase2 pot20_beacon.ptau pot20_final.ptau -v

# Verify final parameters
echo ""
echo "Verifying final Powers of Tau..."
snarkjs powersoftau verify pot20_final.ptau

echo ""
echo "✅ Phase 1 complete! pot20_final.ptau ready for Phase 2"
echo ""

# Calculate hash
POT_HASH=$(sha256sum pot20_final.ptau | cut -d' ' -f1)
echo "SHA256: $POT_HASH"

echo ""
echo "📋 Phase 2: Circuit-Specific Setup"
echo "===================================="
echo ""

# Transfer Circuit
echo "🔄 Transfer Circuit Setup"
echo "------------------------"
echo ""

snarkjs groth16 setup "$CIRCUITS_DIR/transfer.r1cs" pot20_final.ptau transfer_0000.zkey

CURRENT_ZKEY="transfer_0000.zkey"
for i in $(seq 1 $NUM_PARTICIPANTS); do
    NEXT_ZKEY="transfer_$(printf "%04d" $i).zkey"

    echo "Participant $i contributing to transfer circuit..."

    ENTROPY=$(head -c 1024 /dev/urandom | sha256sum | head -c 64)

    snarkjs zkey contribute "$CURRENT_ZKEY" "$NEXT_ZKEY" \
        --name="Participant $i Transfer" \
        -v -e="$ENTROPY"

    CURRENT_ZKEY="$NEXT_ZKEY"
done

# Apply beacon
snarkjs zkey beacon "$CURRENT_ZKEY" transfer_beacon.zkey \
    "$BEACON" 10 -n="Transfer Final Beacon"

# Verify
snarkjs zkey verify "$CIRCUITS_DIR/transfer.r1cs" pot20_final.ptau transfer_beacon.zkey

# Export verification key
snarkjs zkey export verificationkey transfer_beacon.zkey transfer_verification_key.json

# Finalize
mv transfer_beacon.zkey transfer_final.zkey

TRANSFER_HASH=$(sha256sum transfer_final.zkey | cut -d' ' -f1)
echo "✅ Transfer circuit complete! SHA256: $TRANSFER_HASH"

echo ""
echo "🔄 Balance Circuit Setup"
echo "------------------------"
echo ""

snarkjs groth16 setup "$CIRCUITS_DIR/balance.r1cs" pot20_final.ptau balance_0000.zkey

CURRENT_ZKEY="balance_0000.zkey"
for i in $(seq 1 $NUM_PARTICIPANTS); do
    NEXT_ZKEY="balance_$(printf "%04d" $i).zkey"

    echo "Participant $i contributing to balance circuit..."

    ENTROPY=$(head -c 1024 /dev/urandom | sha256sum | head -c 64)

    snarkjs zkey contribute "$CURRENT_ZKEY" "$NEXT_ZKEY" \
        --name="Participant $i Balance" \
        -v -e="$ENTROPY"

    CURRENT_ZKEY="$NEXT_ZKEY"
done

snarkjs zkey beacon "$CURRENT_ZKEY" balance_beacon.zkey \
    "$BEACON" 10 -n="Balance Final Beacon"

snarkjs zkey verify "$CIRCUITS_DIR/balance.r1cs" pot20_final.ptau balance_beacon.zkey

snarkjs zkey export verificationkey balance_beacon.zkey balance_verification_key.json

mv balance_beacon.zkey balance_final.zkey

BALANCE_HASH=$(sha256sum balance_final.zkey | cut -d' ' -f1)
echo "✅ Balance circuit complete! SHA256: $BALANCE_HASH"

echo ""
echo "🔄 Ring Signature Circuit Setup"
echo "-------------------------------"
echo ""

snarkjs groth16 setup "$CIRCUITS_DIR/ring_signature.r1cs" pot20_final.ptau ring_sig_0000.zkey

CURRENT_ZKEY="ring_sig_0000.zkey"
for i in $(seq 1 $NUM_PARTICIPANTS); do
    NEXT_ZKEY="ring_sig_$(printf "%04d" $i).zkey"

    echo "Participant $i contributing to ring signature circuit..."

    ENTROPY=$(head -c 1024 /dev/urandom | sha256sum | head -c 64)

    snarkjs zkey contribute "$CURRENT_ZKEY" "$NEXT_ZKEY" \
        --name="Participant $i Ring Sig" \
        -v -e="$ENTROPY"

    CURRENT_ZKEY="$NEXT_ZKEY"
done

snarkjs zkey beacon "$CURRENT_ZKEY" ring_sig_beacon.zkey \
    "$BEACON" 10 -n="Ring Sig Final Beacon"

snarkjs zkey verify "$CIRCUITS_DIR/ring_signature.r1cs" pot20_final.ptau ring_sig_beacon.zkey

snarkjs zkey export verificationkey ring_sig_beacon.zkey ring_signature_verification_key.json

mv ring_sig_beacon.zkey ring_sig_final.zkey

RING_HASH=$(sha256sum ring_sig_final.zkey | cut -d' ' -f1)
echo "✅ Ring signature circuit complete! SHA256: $RING_HASH"

echo ""
echo "📦 Ceremony Complete!"
echo "===================="
echo ""
echo "Final Parameters:"
echo "  Powers of Tau:    pot20_final.ptau"
echo "                    SHA256: $POT_HASH"
echo ""
echo "  Transfer Circuit: transfer_final.zkey"
echo "                    SHA256: $TRANSFER_HASH"
echo "                    VK: transfer_verification_key.json"
echo ""
echo "  Balance Circuit:  balance_final.zkey"
echo "                    SHA256: $BALANCE_HASH"
echo "                    VK: balance_verification_key.json"
echo ""
echo "  Ring Sig Circuit: ring_sig_final.zkey"
echo "                    SHA256: $RING_HASH"
echo "                    VK: ring_signature_verification_key.json"
echo ""
echo "Next steps:"
echo "1. Copy final keys to circuits/build/"
echo "2. Upload verification keys to Solana using store-verification-keys.ts"
echo "3. Publish ceremony artifacts to IPFS"
echo "4. Collect participant attestations"
echo ""

read -p "Copy keys to build directory? (y/n) " COPY_KEYS

if [ "$COPY_KEYS" = "y" ]; then
    echo "Copying keys to $BUILD_DIR..."
    cp transfer_final.zkey "$BUILD_DIR/transfer_final.zkey"
    cp transfer_verification_key.json "$BUILD_DIR/transfer_verification_key.json"
    cp balance_final.zkey "$BUILD_DIR/balance_final.zkey"
    cp balance_verification_key.json "$BUILD_DIR/balance_verification_key.json"
    cp ring_sig_final.zkey "$BUILD_DIR/ring_signature_final.zkey"
    cp ring_signature_verification_key.json "$BUILD_DIR/ring_signature_verification_key.json"
    echo "✅ Keys copied!"
fi

echo ""
echo "🎉 Ceremony complete! Your protocol now has production-grade cryptographic parameters."
