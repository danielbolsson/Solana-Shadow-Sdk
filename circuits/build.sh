#!/bin/bash

# Build script for ZK circuits
# Compiles circom circuits and generates proving/verification keys

set -e

# Ensure ~/.cargo/bin is in PATH (standard location for rust binaries)
export PATH="$HOME/.cargo/bin:$PATH"

# Check circom version
if ! command -v circom &> /dev/null; then
    echo "❌ Error: 'circom' could not be found."
    echo "Please install it using: cargo install --git https://github.com/iden3/circom.git"
    exit 1
fi

CIRCOM_VERSION=$(circom --version | head -n 1 | awk '{print $3}')
if [[ "$CIRCOM_VERSION" != 2.* ]]; then
    echo "❌ Error: circom version ${CIRCOM_VERSION} is too old or invalid."
    echo "Please install the Rust-based circom 2.x (not the npm package)."
    echo "Run: npm uninstall -g circom && cargo install --git https://github.com/iden3/circom.git"
    exit 1
fi

echo "✅ Using circom version: ${CIRCOM_VERSION}"

# Create build directory
mkdir -p build

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Circuit names
CIRCUITS=("transfer" "balance" "ring_signature")

for CIRCUIT in "${CIRCUITS[@]}"; do
    echo -e "${BLUE}Building ${CIRCUIT} circuit...${NC}"

    # Compile circuit
    echo "  📝 Compiling circuit..."
    circom ${CIRCUIT}.circom -l node_modules --r1cs --wasm --sym -o build/

    # Generate witness calculator
    echo "  🔨 Generating witness calculator..."
    cd build/${CIRCUIT}_js
    node generate_witness.js ${CIRCUIT}.wasm ../../input.json witness.wtns || true
    cd ../..

    # Powers of tau ceremony (use existing ptau or generate)
    PTAU_FILE="build/powersOfTau28_hez_final_16.ptau"
    if [ ! -f "$PTAU_FILE" ]; then
        echo "  ⚡ Downloading powers of tau file..."
        wget -q -O $PTAU_FILE https://hermez.s3-eu-west-1.amazonaws.com/powersOfTau28_hez_final_16.ptau
    fi

    # Generate zkey (proving key)
    echo "  🔑 Generating proving key..."
    snarkjs groth16 setup build/${CIRCUIT}.r1cs $PTAU_FILE build/${CIRCUIT}_0000.zkey

    # Contribute to ceremony (in production, do proper ceremony)
    echo "  🎲 Contributing to ceremony..."
    snarkjs zkey contribute build/${CIRCUIT}_0000.zkey build/${CIRCUIT}_final.zkey \
        --name="Shadow SDK" -v -e="$(openssl rand -base64 32)"

    # Export verification key
    echo "  📤 Exporting verification key..."
    snarkjs zkey export verificationkey build/${CIRCUIT}_final.zkey build/${CIRCUIT}_verification_key.json

    # Generate Solana verifier (for on-chain verification)
    echo "  🔐 Generating Solana verifier..."
    snarkjs zkey export solidityverifier build/${CIRCUIT}_final.zkey build/${CIRCUIT}_verifier.sol

    echo -e "${GREEN}✅ ${CIRCUIT} circuit built successfully!${NC}"
    echo ""
done

echo -e "${GREEN}🎉 All circuits built successfully!${NC}"
echo ""
echo "📦 Output files in build/ directory:"
echo "  - *.r1cs: Constraint systems"
echo "  - *.wasm: Witness generators"
echo "  - *_final.zkey: Proving keys"
echo "  - *_verification_key.json: Verification keys"
echo "  - *_verifier.sol: Solana verifiers"
echo ""
echo "🚀 Next steps:"
echo "  1. Copy verification keys to Solana program"
echo "  2. Test circuits with: npm test"
echo "  3. Deploy Solana program"
