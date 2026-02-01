import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { ShadowClient } from './client';
import * as fs from 'fs';
import * as path from 'path';

// Mock wallet
class MockWallet {
    constructor(public payer: Keypair) { }

    get publicKey() {
        return this.payer.publicKey;
    }

    async signTransaction(tx: any) {
        tx.partialSign(this.payer);
        return tx;
    }

    async signAllTransactions(txs: any[]) {
        return txs.map(t => {
            t.partialSign(this.payer);
            return t;
        });
    }
}

async function main() {
    console.log('🚀 Starting Shadow SDK Demo...');

    // Setup connection to local validator
    const connection = new Connection('http://localhost:8899', 'confirmed');

    // Setup wallets
    const alice = Keypair.generate();
    const bob = Keypair.generate();
    console.log('👤 Alice (Sender) wallet:  ', alice.publicKey.toString());
    console.log('👤 Bob (Recipient) wallet: ', bob.publicKey.toString());

    // Airdrop SOL to Alice
    console.log('\n💰 Funding Alice...');
    try {
        const airdropSig = await connection.requestAirdrop(alice.publicKey, 2 * 10 ** 9);
        await connection.confirmTransaction(airdropSig);
        console.log('✅ Alice funded with 2 SOL');
    } catch (e) {
        console.error('❌ Airdrop failed. Make sure solana-test-validator is running.');
        return;
    }

    const circuitsPath = path.resolve(__dirname, '../../../circuits/build');
    const programId = new PublicKey('FwQ4vNgCPM51UKJYY6dsPyZQ4jrGQNQPipQfcJiK3kjX');

    const client = new ShadowClient({
        connection,
        wallet: new MockWallet(alice),
        programId,
        circuitsPath,
        monitorUrl: 'http://127.0.0.1:5000',
        // relayerUrl: 'http://127.0.0.1:5000' // Disable relayer to test direct submission (avoid stale config in running relayer)
    });

    await client.initialize();

    // 1. (Implicit) Initialize Privacy Pool during Deposit
    // The client automatically derives the pool address based on denomination and initializes it if needed.
    // Use a unique denomination to ensure a fresh pool for the demo (avoids Merkle index issues without an indexer)
    const denomination = 100_000_000n + BigInt(Math.floor(Math.random() * 100000));


    // 2. Alice Deposits into Pool
    console.log('\n� Step 2: Alice depositing 0.1 SOL into Privacy Pool...');
    // 2. Alice Deposits into Pool
    console.log('\n🏗️ Step 2: Alice depositing 0.1 SOL into Privacy Pool...');
    await client.deposit({ amount: denomination });

    // 2b. Initialize Verification Key (Required for new pool)
    console.log('\n🔑 Step 2b: Initializing Verification Key for new pool...');
    const vkPath = path.join(circuitsPath, 'transfer_verification_key.json');
    const vkJson = JSON.parse(fs.readFileSync(vkPath, 'utf-8'));
    await client.storeVerificationKey(0, vkJson); // 0 = Transfer Circuit

    const privateBalance = await client.getPrivateBalance();
    console.log('   Alice Private Balance:', Number(privateBalance) / 1e9, 'SOL');

    // 3. Alice Transfers to Bob (Private Withdrawal)
    console.log('\n🔐 Step 3: Alice executing Private Transfer to Bob...');
    console.log('   Bob is waiting for funds...');
    const bobInitialBalance = await connection.getBalance(bob.publicKey);

    await client.withdraw({
        amount: denomination,
        recipient: bob.publicKey.toString()
    });

    // 4. Verification
    console.log('\n✨ Step 4: Verifying results...');

    // Wait a moment for commitment to propagate fully to RPC
    await new Promise(r => setTimeout(r, 2000));

    const bobBalanceFinal = await connection.getBalance(bob.publicKey);
    const alicePrivateBalanceFinal = await client.getPrivateBalance();

    console.log('   Bob Initial Balance: ', bobInitialBalance / 1e9, 'SOL');
    console.log('   Bob Final Balance:   ', bobBalanceFinal / 1e9, 'SOL');
    console.log('   Alice Private Balance:', Number(alicePrivateBalanceFinal) / 1e9, 'SOL');

    if (bobBalanceFinal > bobInitialBalance) {
        console.log('\n🎉 SUCCESS! Bob received the funds privately through the Shadow Protocol!');
        console.log('   Total transferred: 0.1 SOL');
    } else {
        console.log('\n❌ FAILED: Bob did not receive funds.');
    }

    console.log('\n✨ Demo Completed!');
    process.exit(0); // Exit to stop snarkjs worker threads
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
