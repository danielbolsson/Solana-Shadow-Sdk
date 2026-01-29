/// <reference path="./declarations.d.ts" />
import {
  Connection,
  PublicKey,
  Transaction,
  SystemProgram,
  TransactionInstruction,
  Keypair,
} from '@solana/web3.js';
import { buildPoseidon } from 'circomlibjs';
import { sha256 } from '@noble/hashes/sha256';
import { randomBytes } from '@noble/hashes/utils';
import * as snarkjs from 'snarkjs';
import {
  ShadowClientConfig,
  Commitment,
  Nullifier,
  ZKProof,
  PrivateTransferParams,
  DepositParams,
  WithdrawParams,
} from './types';
import { SHADOW_PROGRAM_ID, MERKLE_TREE_DEPTH, CIRCUITS } from './constants';

export class ShadowClient {
  private connection: Connection;
  private wallet: any;
  private programId: PublicKey;
  private poseidon: any;
  private circuitsPath: string;
  private privateKey: Uint8Array;
  private publicKey: Uint8Array;
  private commitments: Map<string, Commitment>;
  private nullifiers: Set<string>;
  public currentPoolAddress: PublicKey | null = null;
  private monitorUrl: string | null = null;
  private relayerUrl: string | null = null;

  constructor(config: ShadowClientConfig) {
    this.connection = config.connection;
    this.wallet = config.wallet;
    this.programId = config.programId || SHADOW_PROGRAM_ID;
    this.circuitsPath = config.circuitsPath || './circuits/build';
    this.monitorUrl = config.monitorUrl || null;
    this.relayerUrl = config.relayerUrl || null;
    this.relayerUrl = config.relayerUrl || null;
    this.commitments = new Map();
    this.nullifiers = new Set();
    this.privateKey = randomBytes(32);
    this.publicKey = new Uint8Array(32);
  }

  /**
   * Initialize the client
   */
  async initialize(): Promise<void> {
    console.log('🔧 Initializing Shadow SDK...');

    // Initialize Poseidon hash function
    this.poseidon = await buildPoseidon();

    // Derive public key from private key
    const publicKeyHash = this.poseidon([BigInt('0x' + Buffer.from(this.privateKey).toString('hex'))]);
    this.publicKey = this.poseidon.F.toObject(publicKeyHash);

    console.log('✅ Shadow SDK initialized');
    console.log('   Public key:', Buffer.from((this.publicKey as any).toString(16).padStart(64, '0'), 'hex').toString('hex').slice(0, 16) + '...');
  }

  /**
   * Get Shadow identifier (your privacy identity)
   */
  getShadowIdentifier(): string {
    return Buffer.from((this.publicKey as any).toString(16).padStart(64, '0'), 'hex').toString('hex');
  }

  /**
   * Generate a commitment for an amount
   */
  async generateCommitment(params: {
    amount: bigint;
    recipient: string;
    nonce?: Uint8Array;
  }): Promise<Commitment> {
    const nonce = params.nonce || randomBytes(32);
    const recipientPubKey = Buffer.from(params.recipient, 'hex');

    // commitment = H(recipient, amount, nonce)
    const commitment = this.poseidon([
      BigInt('0x' + recipientPubKey.toString('hex')),
      params.amount,
      BigInt('0x' + Buffer.from(nonce).toString('hex')),
    ]);

    const commitmentBytes = this.poseidon.F.toObject(commitment);

    return {
      value: Buffer.from((commitmentBytes as any).toString(16).padStart(64, '0'), 'hex'),
      nonce,
      amount: params.amount,
    };
  }

  async generateNullifier(commitment: Commitment): Promise<Nullifier> {
    // nullifier = H(commitment, privateKey)
    const nullifier = this.poseidon([
      BigInt('0x' + Buffer.from(commitment.value).toString('hex')),
      BigInt('0x' + Buffer.from(this.privateKey).toString('hex')),
    ]);

    const nullifierBytes = this.poseidon.F.toObject(nullifier);

    return {
      value: Buffer.from((nullifierBytes as any).toString(16).padStart(64, '0'), 'hex'),
      commitment: commitment.value,
    };
  }

  /**
   * Record metrics to the monitoring dashboard
   */
  private async recordMetric(endpoint: string, data: any): Promise<void> {
    if (!this.monitorUrl) return;

    try {
      await fetch(`${this.monitorUrl}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });
    } catch (error) {
      console.warn('Failed to report metrics to dashboard:', error);
    }
  }

  /**
   * Generate ZK proof for private transfer
   */
  async generateTransferProof(params: {
    amount: bigint;
    recipient: string;
    commitment: string;
    nullifier: string;
  }): Promise<ZKProof> {
    console.log('🔐 Generating ZK proof...');
    const startTime = Date.now();
    try {
      // Generate random mock oldNonce for simulation
      const oldNonceBytes = randomBytes(32);
      const oldNonce = BigInt('0x' + Buffer.from(oldNonceBytes).toString('hex'));

      // Calculate Mock Root
      const publicKeyHash = this.poseidon([BigInt('0x' + Buffer.from(this.privateKey).toString('hex'))]);
      const oldCommitmentFn = this.poseidon([
        this.poseidon.F.toObject(publicKeyHash),
        params.amount,
        oldNonce
      ]);
      let mockRoot = this.poseidon.F.toObject(oldCommitmentFn);
      for (let i = 0; i < MERKLE_TREE_DEPTH; i++) {
        mockRoot = this.poseidon.F.toObject(this.poseidon([mockRoot, 0n]));
      }

      // Calculate Mock Nullifier
      const mockNullifier = this.poseidon([
        this.poseidon.F.toObject(oldCommitmentFn),
        BigInt('0x' + Buffer.from(this.privateKey).toString('hex'))
      ]);

      // Generate random nonce for new commitment
      const nonceBytes = randomBytes(32);
      const nonce = BigInt('0x' + Buffer.from(nonceBytes).toString('hex'));

      const newCommitmentFn = this.poseidon([
        BigInt('0x' + new PublicKey(params.recipient).toBuffer().toString('hex')),
        params.amount,
        nonce
      ]);
      const mockNewCommitment = this.poseidon.F.toObject(newCommitmentFn);

      // Circuit inputs
      const input = {
        // Public inputs
        root: '0x' + mockRoot.toString(16),
        nullifier: '0x' + this.poseidon.F.toObject(mockNullifier).toString(16),
        newCommitment: '0x' + mockNewCommitment.toString(16),

        // Private inputs
        amount: params.amount.toString(),
        privateKey: '0x' + Buffer.from(this.privateKey).toString('hex'),
        recipientPublicKey: '0x' + new PublicKey(params.recipient).toBuffer().toString('hex'),
        nonce: '0x' + Buffer.from(nonceBytes).toString('hex'),
        oldNonce: '0x' + Buffer.from(oldNonceBytes).toString('hex'),

        // Merkle proof (simplified - would be actual path in production)
        pathElements: Array(MERKLE_TREE_DEPTH).fill('0'),
        pathIndices: Array(MERKLE_TREE_DEPTH).fill(0),
      };

      // Generate proof using snarkjs
      try {
        const { proof, publicSignals } = await snarkjs.groth16.fullProve(
          input,
          `${this.circuitsPath}/transfer.wasm`,
          `${this.circuitsPath}/transfer_final.zkey`
        );

        // Convert proof to bytes
        const proofBytes = this.serializeProof(proof);

        console.log('✅ ZK proof generated');
        console.log('   Proof size:', proofBytes.length, 'bytes');

        await this.recordMetric('/api/metrics/circuit-proving', {
          circuitName: 'transfer',
          provingTime: Date.now() - startTime,
          success: true
        });

        return {
          proof: proofBytes,
          publicSignals,
        };
      } catch (error) {
        console.error('❌ Failed to generate proof:', error);
        await this.recordMetric('/api/metrics/circuit-proving', {
          circuitName: 'transfer',
          provingTime: Date.now() - startTime,
          success: false
        });
        throw error;
      }
    } catch (error) {
      console.error('❌ Error in proof generation flow:', error);
      throw error;
    }
  }

  /**
   * Deposit into privacy pool
   */
  async deposit(params: DepositParams): Promise<string> {
    console.log('💰 Depositing into privacy pool...');
    console.log('   Amount:', params.amount.toString(), 'lamports');

    // Generate commitment
    const commitment = await this.generateCommitment({
      amount: params.amount,
      recipient: this.getShadowIdentifier(),
    });

    const commitmentKey = Buffer.from(commitment.value).toString('hex');
    this.commitments.set(commitmentKey, commitment);

    // Use currentPoolAddress if set, otherwise fallback to PDA derivation
    const poolAddress = this.currentPoolAddress || PublicKey.findProgramAddressSync(
      [Buffer.from('pool'), Buffer.from(params.amount.toString())],
      this.programId
    )[0];

    const [vaultAddress] = PublicKey.findProgramAddressSync(
      [Buffer.from('vault'), poolAddress.toBuffer()],
      this.programId
    );

    // Build instruction
    const instruction = new TransactionInstruction({
      keys: [
        { pubkey: poolAddress, isSigner: false, isWritable: true },
        { pubkey: this.wallet.publicKey, isSigner: true, isWritable: true },
        { pubkey: vaultAddress, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      programId: this.programId,
      data: this.encodeDepositInstruction(commitment.value, params.amount),
    });

    // Send transaction
    const transaction = new Transaction().add(instruction);
    const signature = await this.sendAndConfirm(transaction);

    console.log('✅ Deposit successful!');
    return signature;
  }

  /**
   * Initialize pool on-chain
   */
  async initializePool(poolAccount: Keypair, denomination: bigint): Promise<string> {
    console.log('🏗️  Initializing privacy pool on-chain...');
    this.currentPoolAddress = poolAccount.publicKey;

    const [vaultAddress] = PublicKey.findProgramAddressSync(
      [Buffer.from('vault'), poolAccount.publicKey.toBuffer()],
      this.programId
    );

    const space = 8192; // PoolState size + buffer
    const rent = await this.connection.getMinimumBalanceForRentExemption(space);

    const transaction = new Transaction();

    // 1. Create pool account
    transaction.add(
      SystemProgram.createAccount({
        fromPubkey: this.wallet.publicKey,
        newAccountPubkey: poolAccount.publicKey,
        lamports: rent,
        space,
        programId: this.programId,
      })
    );

    // 2. Initialize pool
    transaction.add(
      new TransactionInstruction({
        keys: [
          { pubkey: poolAccount.publicKey, isSigner: true, isWritable: true },
          { pubkey: this.wallet.publicKey, isSigner: true, isWritable: true },
          { pubkey: vaultAddress, isSigner: false, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        programId: this.programId,
        data: this.encodeInitializePoolInstruction(16, denomination),
      })
    );

    const signature = await this.sendAndConfirm(transaction, [poolAccount]);

    console.log('✅ Pool initialized');
    return signature;
  }

  private encodeInitializePoolInstruction(depth: number, denomination: bigint): Buffer {
    const buffer = Buffer.alloc(1 + 1 + 8);
    buffer.writeUInt8(0, 0); // InitializePool discriminator
    buffer.writeUInt8(depth, 1);
    buffer.writeBigUInt64LE(denomination, 2);
    return buffer;
  }

  /**
   * Withdraw from privacy pool
   */
  async withdraw(params: WithdrawParams): Promise<string> {
    console.log('💸 Withdrawing from privacy pool...');
    console.log('   Amount:', params.amount.toString(), 'lamports');
    console.log('   Recipient:', params.recipient);

    // Find a commitment with sufficient balance
    const commitment = Array.from(this.commitments.values())
      .find(c => c.amount >= params.amount);

    if (!commitment) {
      throw new Error('Insufficient balance');
    }

    // Generate nullifier
    const nullifier = await this.generateNullifier(commitment);

    // Check if already spent
    const nullifierKey = Buffer.from(nullifier.value).toString('hex');
    if (this.nullifiers.has(nullifierKey)) {
      throw new Error('Commitment already spent');
    }

    // Generate ZK proof
    const proof = await this.generateTransferProof({
      amount: params.amount,
      recipient: params.recipient,
      commitment: Buffer.from(commitment.value).toString('hex'),
      nullifier: nullifierKey,
    });

    // Use currentPoolAddress if set
    const poolAddress = this.currentPoolAddress || PublicKey.findProgramAddressSync(
      [Buffer.from('pool'), Buffer.from(params.amount.toString())],
      this.programId
    )[0];

    const [vaultAddress] = PublicKey.findProgramAddressSync(
      [Buffer.from('vault'), poolAddress.toBuffer()],
      this.programId
    );

    const [vkAddress] = PublicKey.findProgramAddressSync(
      [Buffer.from('vk_transfer'), poolAddress.toBuffer()],
      this.programId
    );

    const recipientPubkey = new PublicKey(params.recipient);

    // Build instruction
    const instruction = new TransactionInstruction({
      keys: [
        { pubkey: poolAddress, isSigner: false, isWritable: true },
        { pubkey: vaultAddress, isSigner: false, isWritable: true },
        { pubkey: recipientPubkey, isSigner: false, isWritable: true },
        { pubkey: vkAddress, isSigner: false, isWritable: false }, // VK Account
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      programId: this.programId,
      data: this.encodeWithdrawInstruction(
        proof.proof,
        commitment.value,
        nullifier.value,
        params.amount,
        recipientPubkey
      ),
    });
    // Send transaction (Directly or via Relayer)
    if (this.relayerUrl) {
      console.log('🔗 Sending transaction via Relayer...');
      const response = await fetch(`${this.relayerUrl}/api/relayer/withdraw`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          poolAddress: poolAddress.toBase58(),
          vaultAddress: vaultAddress.toBase58(),
          recipient: params.recipient,
          vkAddress: vkAddress.toBase58(),
          proof: Buffer.from(proof.proof).toString('hex'),
          commitment: Buffer.from(commitment.value).toString('hex'),
          nullifier: Buffer.from(nullifier.value).toString('hex'),
          amount: params.amount.toString(),
        }),
      });

      if (!response.ok) {
        throw new Error(`Relayed withdrawal failed: ${await response.text()}`);
      }

      const { signature } = await response.json() as any;

      // Mark as spent
      this.nullifiers.add(nullifierKey);
      this.commitments.delete(Buffer.from(commitment.value).toString('hex'));

      console.log('✅ Withdrawal successful (Relayed)!');
      console.log('   Signature:', signature);
      return signature;
    }

    const transaction = new Transaction().add(instruction);
    const signature = await this.sendAndConfirm(transaction);

    // Mark as spent
    this.nullifiers.add(nullifierKey);
    this.commitments.delete(Buffer.from(commitment.value).toString('hex'));

    console.log('✅ Withdrawal successful!');
    console.log('   Signature:', signature);
    console.log('   Nullifier:', nullifierKey.slice(0, 16) + '...');

    return signature;
  }

  /**
   * Private transfer (combines deposit + withdraw in one transaction)
   */
  async privateTransfer(params: PrivateTransferParams): Promise<string> {
    console.log('🔒 Executing private transfer...');
    console.log('   Amount:', params.amount.toString(), 'lamports');
    console.log('   Recipient:', params.recipient.slice(0, 16) + '...');

    // For simplicity, do withdraw to recipient
    // In production, this would be optimized
    return await this.withdraw({
      amount: params.amount,
      recipient: params.recipient,
    });
  }

  /**
   * Get private balance (sum of unspent commitments)
   */
  async getPrivateBalance(): Promise<bigint> {
    let total = 0n;

    for (const commitment of this.commitments.values()) {
      total += commitment.amount;
    }

    return total;
  }

  /**
   * Generate balance proof (prove you have at least X without revealing exact amount)
   */
  async generateBalanceProof(minBalance: bigint): Promise<ZKProof> {
    console.log('🔐 Generating balance proof...');
    console.log('   Minimum balance:', minBalance.toString());

    const actualBalance = await this.getPrivateBalance();

    if (actualBalance < minBalance) {
      throw new Error('Insufficient balance');
    }

    // Generate balance commitment
    const balanceCommitment = await this.generateCommitment({
      amount: actualBalance,
      recipient: this.getShadowIdentifier(),
    });

    const input = {
      // Public inputs
      minBalance: minBalance.toString(),
      balanceCommitment: '0x' + Buffer.from(balanceCommitment.value).toString('hex'),

      // Private inputs
      actualBalance: actualBalance.toString(),
      balanceNonce: '0x' + Buffer.from(balanceCommitment.nonce).toString('hex'),
      privateKey: '0x' + Buffer.from(this.privateKey).toString('hex'),
    };

    const startTime = Date.now();
    try {
      const { proof, publicSignals } = await snarkjs.groth16.fullProve(
        input,
        `${this.circuitsPath}/balance.wasm`,
        `${this.circuitsPath}/balance_final.zkey`
      );

      const proofBytes = this.serializeProof(proof);

      console.log('✅ Balance proof generated');

      await this.recordMetric('/api/metrics/circuit-proving', {
        circuitName: 'balance',
        provingTime: Date.now() - startTime,
        success: true
      });

      return {
        proof: proofBytes,
        publicSignals,
      };
    } catch (error) {
      console.error('❌ Failed to generate balance proof:', error);
      await this.recordMetric('/api/metrics/circuit-proving', {
        circuitName: 'balance',
        provingTime: Date.now() - startTime,
        success: false
      });
      throw error;
    }
  }

  // ============ HELPER METHODS ============

  private serializeProof(proof: any): Uint8Array {
    // Serialize Groth16 proof to bytes
    // In production, use proper serialization
    const proofStr = JSON.stringify(proof);
    return new Uint8Array(Buffer.from(proofStr));
  }

  private encodeDepositInstruction(commitment: Uint8Array, amount: bigint): Buffer {
    // Rust: Deposit { commitment: [u8; 32], amount: u64 }
    // Discriminant: 1
    const buffer = Buffer.alloc(1 + 32 + 8);
    buffer.writeUInt8(1, 0);
    buffer.set(commitment, 1);
    buffer.writeBigUInt64LE(amount, 33);
    return buffer;
  }

  private encodeWithdrawInstruction(
    proof: Uint8Array,
    root: Uint8Array,
    nullifier: Uint8Array,
    amount: bigint,
    recipient: PublicKey
  ): Buffer {
    // Rust layout:
    // Withdraw {
    //   proof: Vec<u8>,
    //   root: [u8; 32],
    //   nullifier: [u8; 32],
    //   new_commitment: Option<[u8; 32]>,
    //   recipient: Pubkey,
    //   amount: u64,
    // }
    // Discriminant: 2

    const buffer = Buffer.alloc(1 + 4 + proof.length + 32 + 32 + 1 + 32 + 8);
    let offset = 0;

    buffer.writeUInt8(2, offset); // Discriminant
    offset += 1;

    buffer.writeUInt32LE(proof.length, offset);
    offset += 4;
    buffer.set(proof, offset);
    offset += proof.length;

    buffer.set(root, offset);
    offset += 32;

    buffer.set(nullifier, offset);
    offset += 32;

    // Option<[u8; 32]> for new_commitment (None = 0)
    buffer.writeUInt8(0, offset);
    offset += 1;

    buffer.set(recipient.toBuffer(), offset);
    offset += 32;

    buffer.writeBigUInt64LE(amount, offset);

    return buffer;
  }

  private async sendAndConfirm(transaction: Transaction, extraSigners: Keypair[] = []): Promise<string> {
    const { blockhash } = await this.connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = this.wallet.publicKey;

    if (extraSigners.length > 0) {
      transaction.partialSign(...extraSigners);
    }

    const signed = await this.wallet.signTransaction(transaction);
    const signature = await this.connection.sendRawTransaction(signed.serialize());
    await this.connection.confirmTransaction(signature);

    return signature;
  }
}

export type { ShadowClientConfig };
