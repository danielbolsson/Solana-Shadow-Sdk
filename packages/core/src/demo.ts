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
    const programId = new PublicKey('x6ofF4ZJFtXd7BTGV8UB6TBYkE2Vwx7WMmuQCvJKLUV');

    const client = new ShadowClient({
        connection,
        wallet: new MockWallet(alice),
        programId,
        circuitsPath
    });

    await client.initialize();

    // 1. Initialize Privacy Pool
    console.log('\n🏗️  Step 1: Initializing Privacy Pool...');
    const poolAccount = Keypair.generate();
    const denomination = 100_000_000n; // 0.1 SOL
    await client.initializePool(poolAccount, denomination);
    console.log('   Pool Address:', poolAccount.publicKey.toString());

    // 2. Alice Deposits into Pool
    console.log('\n� Step 2: Alice depositing 0.1 SOL into Privacy Pool...');
    await client.deposit({ amount: denomination });

    // Check Alice's private balance
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
    const bobFinalBalance = await connection.getBalance(bob.publicKey);
    const aliceFinalPrivateBalance = await client.getPrivateBalance();

    console.log('   Bob Initial Balance: ', bobInitialBalance / 1e9, 'SOL');
    console.log('   Bob Final Balance:   ', bobFinalBalance / 1e9, 'SOL');
    console.log('   Alice Private Balance:', Number(aliceFinalPrivateBalance) / 1e9, 'SOL');

    if (bobFinalBalance > bobInitialBalance) {
        console.log('\n🎉 SUCCESS! Bob received the funds privately through the Shadow Protocol!');
        console.log('   Total transferred: 0.1 SOL');
    } else {
        console.log('\n❌ FAILED: Bob did not receive funds.');
    }

    console.log('\n✨ Demo Completed!');
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
