
import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction, SystemProgram, sendAndConfirmTransaction } from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';
import * as snarkjs from 'snarkjs';

const PROGRAM_ID = new PublicKey('FwQ4vNgCPM51UKJYY6dsPyZQ4jrGQNQPipQfcJiK3kjX');

// Helper to convert BN to 32-byte BE Buffer
function bnToBuf(bnStr: string): Buffer {
    let hex = BigInt(bnStr).toString(16);
    if (hex.length % 2 !== 0) hex = '0' + hex;
    const buf = Buffer.from(hex, 'hex');
    const padded = Buffer.alloc(32);
    buf.copy(padded, 32 - buf.length);
    return padded;
}

function serializeVerificationKey(vk: any): Buffer {
    const parts: Buffer[] = [];

    // Alpha G1
    parts.push(bnToBuf(vk.vk_alpha_1[0]));
    parts.push(bnToBuf(vk.vk_alpha_1[1]));

    // Beta G2 - SWAPPED for alt_bn128 compatibility with snarkjs
    // [0][1], [0][0], [1][1], [1][0]
    parts.push(bnToBuf(vk.vk_beta_2[0][1]));
    parts.push(bnToBuf(vk.vk_beta_2[0][0]));
    parts.push(bnToBuf(vk.vk_beta_2[1][1]));
    parts.push(bnToBuf(vk.vk_beta_2[1][0]));

    // Gamma G2 - SWAPPED
    parts.push(bnToBuf(vk.vk_gamma_2[0][1]));
    parts.push(bnToBuf(vk.vk_gamma_2[0][0]));
    parts.push(bnToBuf(vk.vk_gamma_2[1][1]));
    parts.push(bnToBuf(vk.vk_gamma_2[1][0]));

    // Delta G2 - SWAPPED
    parts.push(bnToBuf(vk.vk_delta_2[0][1]));
    parts.push(bnToBuf(vk.vk_delta_2[0][0]));
    parts.push(bnToBuf(vk.vk_delta_2[1][1]));
    parts.push(bnToBuf(vk.vk_delta_2[1][0]));

    // IC
    for (const ic of vk.IC) {
        parts.push(bnToBuf(ic[0]));
        parts.push(bnToBuf(ic[1]));
    }

    return Buffer.concat(parts);
}

async function main() {
    const connection = new Connection('http://localhost:8899', 'confirmed');

    // Load wallet
    // Assuming default keypair for testing
    const payer = Keypair.generate();

    console.log('Payer:', payer.publicKey.toBase58());

    // Airdrop
    const sig = await connection.requestAirdrop(payer.publicKey, 2 * 1e9);
    await connection.confirmTransaction(sig);
    console.log('Airdropped 2 SOL');

    // Create a dummy pool (just a Keypair for authority/pool logic)
    // In reality, pool is an Account.
    // We need to InitPool first? 
    // StoreVerificationKey requires a PoolState account.

    /* implementation details from client.ts */
    // initPool creates a PDA "pool_state" derived from sender and internal count?
    // No, InitializePool takes a Keypair for the pool account and initializes it.

    const poolKeypair = Keypair.generate();
    console.log('Pool Address:', poolKeypair.publicKey.toBase58());

    // 1. Initialize Pool
    const initPoolIx = new TransactionInstruction({
        keys: [
            { pubkey: poolKeypair.publicKey, isSigner: true, isWritable: true },
            { pubkey: payer.publicKey, isSigner: true, isWritable: true },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        programId: PROGRAM_ID,
        data: Buffer.from([0]), // InitializePool discriminator = 0
    });

    const txInit = new Transaction().add(initPoolIx);
    await sendAndConfirmTransaction(connection, txInit, [payer, poolKeypair]);
    console.log('Pool Initialized');

    // 2. Derive VK Address
    const [vkAddress] = PublicKey.findProgramAddressSync(
        [Buffer.from('vk_transfer'), poolKeypair.publicKey.toBuffer()],
        PROGRAM_ID
    );
    console.log('VK Address:', vkAddress.toBase58());

    // 3. Load & Serialize VK
    const vkPath = path.resolve(__dirname, '../circuits/build/transfer_verification_key.json');
    const vkJson = JSON.parse(fs.readFileSync(vkPath, 'utf8'));
    const vkData = serializeVerificationKey(vkJson);
    console.log('VK Data Length:', vkData.length);

    // 4. Store VK
    // Layout: [7, circuit_type(0), len(4), data...]
    const buffer = Buffer.alloc(1 + 1 + 4 + vkData.length);
    let offset = 0;
    buffer.writeUInt8(7, offset); offset += 1;
    buffer.writeUInt8(0, offset); offset += 1; // Transfer circuit
    buffer.writeUInt32LE(vkData.length, offset); offset += 4;
    vkData.copy(buffer, offset);

    const storeIx = new TransactionInstruction({
        keys: [
            { pubkey: vkAddress, isSigner: false, isWritable: true },
            { pubkey: poolKeypair.publicKey, isSigner: false, isWritable: true },
            { pubkey: payer.publicKey, isSigner: true, isWritable: true },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        programId: PROGRAM_ID,
        data: buffer,
    });

    const maxRetries = 5;
    let txStoreSig;
    try {
        txStoreSig = await sendAndConfirmTransaction(connection, new Transaction().add(storeIx), [payer]);
        console.log('Store VK Transaction:', txStoreSig);
    } catch (e) {
        console.error('Store VK Failed:', e);
        process.exit(1);
    }

    // 5. Verify Account Exists
    const accountInfo = await connection.getAccountInfo(vkAddress);
    if (!accountInfo) {
        console.error('CRITICAL: Account does not exist after success!');
        process.exit(1);
    }

    console.log('Account exists!');
    console.log('Data Length:', accountInfo.data.length);
    console.log('Owner:', accountInfo.owner.toBase58());

    if (accountInfo.data.length === 0) {
        console.error('CRITICAL: Account data length is 0!');
    } else {
        console.log('Result: SUCCESS');
    }
}

main().catch(console.error);
