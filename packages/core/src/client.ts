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

    console.log('🏗️ ShadowClient Config:', {
      programId: this.programId.toString(),
      relayerUrl: this.relayerUrl,
      circuitsPath: this.circuitsPath
    });
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

    try {
      // DEBUG: Verify network connection
      const genesis = await this.connection.getGenesisHash();
      console.log('   Network Genesis Hash:', genesis);
      if (genesis === '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d') {
        console.log('   (Confirmed Mainnet Beta)');
      } else if (genesis === 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG') {
        console.log('   (Confirmed Devnet)');
      } else {
        console.log('   (Unknown/Localnet)');
      }
    } catch (e) {
      console.warn('   Could not fetch genesis hash:', e);
    }
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
  /**
   * Generate ZK proof for private transfer
   */
  async generateTransferProof(params: {
    amount: bigint;
    recipient: string;
    commitment: string;
    nullifier: string;
    nonce: Uint8Array; // Added nonce
  }): Promise<ZKProof> {
    console.log('🔐 Generating ZK proof...');
    const startTime = Date.now();
    try {
      // Use actual nonce from the commitment we are spending
      const oldNonceBytes = params.nonce;
      const oldNonce = BigInt('0x' + Buffer.from(oldNonceBytes).toString('hex'));

      // Calculate Root
      // Re-construct the commitment to ensure we have the right values
      // Commitment = H(recipient, amount, nonce)
      // Wait, in deposit: H(recipient=self, amount, nonce)
      // We need 'recipient' used during creation (which is 'this.getShadowIdentifier()')
      // not the NEW recipient.

      // We need to know who the commitment belongs to (spending key).
      // Since we own it, it's us.
      const ownerPublicKey = this.getShadowIdentifier();
      const ownerPubKeyBytes = Buffer.from(ownerPublicKey, 'hex');

      const oldCommitmentFn = this.poseidon([
        BigInt('0x' + ownerPubKeyBytes.toString('hex')),
        params.amount,
        oldNonce
      ]);

      // Verify matches params.commitment
      const calculatedCommitment = this.poseidon.F.toObject(oldCommitmentFn);
      const calculatedCommitmentHex = Buffer.from((calculatedCommitment as any).toString(16).padStart(64, '0'), 'hex').toString('hex');

      if (calculatedCommitmentHex !== params.commitment) {
        console.warn("WARNING: Calculated commitment does not match stored commitment!");
        console.warn("Calculated:", calculatedCommitmentHex);
        console.warn("Stored:", params.commitment);
      }

      // Calculate Mock Root (assuming index 0, empty siblings)
      // In a real app, we would fetch the Merkle Path from the chain/indexer.
      // For this demo (fresh pool), index 0 is correct.
      let mockRoot = calculatedCommitment;
      for (let i = 0; i < MERKLE_TREE_DEPTH; i++) {
        mockRoot = this.poseidon.F.toObject(this.poseidon([mockRoot, 0n])); // Right sibling 0
      }

      // Calculate Nullifier
      // nullifier = H(commitment, privateKey)
      const nullifierFn = this.poseidon([
        calculatedCommitment,
        BigInt('0x' + Buffer.from(this.privateKey).toString('hex'))
      ]);
      const nullifier = this.poseidon.F.toObject(nullifierFn);

      // Generate random nonce for new commitment (output to recipient)
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
        nullifier: '0x' + nullifier.toString(16),
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
  /**
   * Get deterministic pool keypair for a denomination
   * NOTE: Includes programId in seed to avoid conflicts when program changes
   */
  getPoolKeypair(amount: bigint): Keypair {
    const seedContent = `pool-${this.programId.toBase58()}-${amount.toString()}`;
    const hash = sha256(new TextEncoder().encode(seedContent));
    return Keypair.fromSeed(hash.slice(0, 32));
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

    // Get deterministic pool account
    const poolKeypair = this.getPoolKeypair(params.amount);
    const poolAddress = poolKeypair.publicKey;

    // Check if pool exists
    const accountInfo = await this.connection.getAccountInfo(poolAddress);
    if (!accountInfo) {
      console.log('⚠️ Pool not initialized. Initializing now...');
      await this.initializePool(poolKeypair, params.amount);
      console.log('✅ Pool auto-initialized');
      // Wait for RPC to catch up
      console.log('⏳ Waiting for block propagation...');
      await new Promise(r => setTimeout(r, 2000));
    }

    const [vaultAddress] = PublicKey.findProgramAddressSync(
      [Buffer.from('vault'), poolAddress.toBuffer()],
      this.programId
    );

    console.log('📝 Building deposit transaction...');
    // Build instruction
    // Generate new root (Client logic: Poseidon Tree with 1 leaf)
    const commitmentBigInt = BigInt('0x' + Buffer.from(commitment.value).toString('hex'));
    const newRoot = this.bnToBuf(this.getMockRoot(commitmentBigInt).toString());

    const instruction = new TransactionInstruction({
      keys: [
        { pubkey: poolAddress, isSigner: false, isWritable: true },
        { pubkey: this.wallet.publicKey, isSigner: true, isWritable: true },
        { pubkey: vaultAddress, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      programId: this.programId,
      data: this.encodeDepositInstruction(commitment.value, params.amount, newRoot),
    });

    // Send transaction
    const transaction = new Transaction().add(instruction);
    const signature = await this.sendAndConfirm(transaction);

    console.log('✅ Deposit successful! Sig:', signature);
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

    // Get deterministic pool account (needs to be derived before VK check)
    const poolKeypair = this.getPoolKeypair(params.amount);
    const poolAddress = poolKeypair.publicKey;

    // Ensure verification key is stored
    await this.ensureVerificationKeyStored(0, poolAddress); // 0 = Transfer Circuit

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
      nonce: commitment.nonce, // Pass the nonce
    });

    console.log('🔍 [Withdraw] Public Signals (from snarkjs):');
    console.log('   Root:', proof.publicSignals[0]);
    console.log('   Nullifier:', proof.publicSignals[1]);
    console.log('   NewCommitment:', proof.publicSignals[2]);

    const [vaultAddress] = PublicKey.findProgramAddressSync(
      [Buffer.from('vault'), poolAddress.toBuffer()],
      this.programId
    );

    const [vkAddress] = PublicKey.findProgramAddressSync(
      [Buffer.from('vk_transfer'), poolAddress.toBuffer()],
      this.programId
    );

    console.log(`🔍 [Withdraw] Pool Address: ${poolAddress.toBase58()}`);
    console.log(`🔍 [Withdraw] Using VK Address: ${vkAddress.toBase58()}`);

    const recipientPubkey = new PublicKey(params.recipient);

    // Calculate New Root
    let newRootBuf: Buffer;
    if (proof.publicSignals[2] && proof.publicSignals[2] !== "0") {
      const newCommitmentBigInt = BigInt(proof.publicSignals[2]);
      newRootBuf = this.bnToBuf(this.getMockRoot(newCommitmentBigInt).toString());
    } else {
      newRootBuf = this.bnToBuf(proof.publicSignals[0]); // Keep Old Root
    }

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
        this.bnToBuf(proof.publicSignals[0]), // Root (BE) - from circuit
        this.bnToBuf(proof.publicSignals[1]), // Nullifier (BE) - from circuit (authoritative)
        params.amount,
        recipientPubkey,
        this.bnToBuf(proof.publicSignals[2]), // New Commitment (BE) - from circuit
        newRootBuf // New Root (Client calculated)
      ),
    });
    // Send transaction (Directly or via Relayer)
    console.log(`Checking Relayer URL: '${this.relayerUrl}'`);
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
          publicSignals: proof.publicSignals, // Send explicit public signals (Root, Nullifier, NewCommitment)
          commitment: Buffer.from(commitment.value).toString('hex'),
          nullifier: Buffer.from(nullifier.value).toString('hex'),
          amount: params.amount.toString(),
          newRoot: newRootBuf.toString('hex'),
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
    // Groth16-Solana expects:
    // A (64 bytes): X, Y (Big Endian)
    // B (128 bytes): X (c1, c0), Y (c1, c0) -- Note: snarkjs uses [c1, c0] usually, need to check.
    // C (64 bytes): X, Y (Big Endian)
    //
    // Total 256 bytes.
    //
    // NOTE: We might need to negate A. For now, we try without.

    const buffer = Buffer.alloc(256);
    let offset = 0;

    // pi_a: [x, y, 1] - MUST BE NEGATED for groth16 pairing equation.
    // Negation of EC point on BN254: -P = (x, p - y)
    // BN254 field prime p = 21888242871839275222246405745257275088696311157297823662689037894645226208583
    const BN254_FIELD_PRIME = BigInt('21888242871839275222246405745257275088696311157297823662689037894645226208583');
    const pi_a_x = BigInt(proof.pi_a[0]);
    const pi_a_y = BigInt(proof.pi_a[1]);
    const pi_a_y_neg = BN254_FIELD_PRIME - pi_a_y;

    this.writeBigIntBE(pi_a_x, buffer, offset); offset += 32;
    this.writeBigIntBE(pi_a_y_neg, buffer, offset); offset += 32;

    // pi_b: snarkjs outputs [[c1, c0], [c1, c0]] format for G2 points
    // Target for alt_bn128: [x_c0, x_c1, y_c0, y_c1] in Big Endian
    // So we swap to get: [0][1], [0][0], [1][1], [1][0]
    this.writeBigIntBE(BigInt(proof.pi_b[0][1]), buffer, offset); offset += 32; // x_c0
    this.writeBigIntBE(BigInt(proof.pi_b[0][0]), buffer, offset); offset += 32; // x_c1
    this.writeBigIntBE(BigInt(proof.pi_b[1][1]), buffer, offset); offset += 32; // y_c0
    this.writeBigIntBE(BigInt(proof.pi_b[1][0]), buffer, offset); offset += 32; // y_c1

    // pi_c: [x, y, 1]
    this.writeBigIntBE(BigInt(proof.pi_c[0]), buffer, offset); offset += 32;
    this.writeBigIntBE(BigInt(proof.pi_c[1]), buffer, offset); offset += 32;

    // Return Big Endian bytes for alt_bn128 syscalls
    return new Uint8Array(buffer);
  }

  private writeBigIntBE(value: bigint, buffer: Buffer, offset: number) {
    // More robust implementation that works in both Node.js and browser
    const hex = value.toString(16).padStart(64, '0');
    for (let i = 0; i < 32; i++) {
      buffer[offset + i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
  }

  private writeBigIntLE(value: bigint, buffer: Buffer, offset: number) {
    const hex = value.toString(16).padStart(64, '0');
    buffer.write(hex, offset, 'hex');
  }

  /**
   * Store verification key for a circuit
   */
  async storeVerificationKey(
    circuitType: number, // 0=Transfer, 1=Balance, 2=RingSig
    vkJson: any,
    poolAddress?: PublicKey
  ): Promise<string> {
    console.log(`🔐 Storing verification key for circuit type ${circuitType}...`);

    const vkData = this.serializeVerificationKey(vkJson);
    console.log('   VK Data Size:', vkData.length, 'bytes');

    // Resolve pool address
    if (!poolAddress) {
      if (!this.currentPoolAddress) throw new Error("Pool not initialized");
      poolAddress = this.currentPoolAddress;
    }

    // Derive VK PDA
    let seedPrefix = 'vk_transfer';
    if (circuitType === 1) seedPrefix = 'vk_balance';
    if (circuitType === 2) seedPrefix = 'vk_ring_sig';

    const [vkAddress] = PublicKey.findProgramAddressSync(
      [Buffer.from(seedPrefix), poolAddress.toBuffer()],
      this.programId
    );

    console.log(`🔍 [StoreVK] Pool Address: ${poolAddress.toBase58()}`);
    console.log(`🔍 [StoreVK] Derived VK Address: ${vkAddress.toBase58()}`);
    console.log(`🔍 [StoreVK] Program ID: ${this.programId.toBase58()}`);

    // Build instruction
    // StoreVerificationKey { circuit_type: u8, vk_data: Vec<u8> }
    // Discriminator: 7
    // Layout: [7, circuit_type, vk_data_len(4), vk_data...]
    const buffer = Buffer.alloc(1 + 1 + 4 + vkData.length);
    let offset = 0;

    buffer.writeUInt8(7, offset); offset += 1;
    buffer.writeUInt8(circuitType, offset); offset += 1;
    buffer.writeUInt32LE(vkData.length, offset); offset += 4;
    vkData.copy(buffer, offset);

    const instruction = new TransactionInstruction({
      keys: [
        { pubkey: vkAddress, isSigner: false, isWritable: true },
        { pubkey: poolAddress, isSigner: false, isWritable: true },
        { pubkey: this.wallet.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      programId: this.programId,
      data: buffer,
    });

    const transaction = new Transaction().add(instruction);
    const signature = await this.sendAndConfirm(transaction);

    console.log('✅ VK stored:', signature);
    return signature;
  }

  private serializeVerificationKey(vk: any): Buffer {
    // Convert SnarkJS VK JSON to raw bytes for groth16-solana
    // Format: Alpha(64) + Beta(128) + Gamma(128) + Delta(128) + IC(N*64)

    const parts: Buffer[] = [];

    // Alpha G1 (64 bytes): X, Y
    parts.push(this.bnToBuf(vk.vk_alpha_1[0]));
    parts.push(this.bnToBuf(vk.vk_alpha_1[1]));

    // Beta G2 (128 bytes): snarkjs outputs [[c1, c0], [c1, c0]] format
    // Target for alt_bn128: [x_c0, x_c1, y_c0, y_c1] in Big Endian
    // So we swap: [0][1], [0][0], [1][1], [1][0]
    parts.push(this.bnToBuf(vk.vk_beta_2[0][1]));  // x_c0
    parts.push(this.bnToBuf(vk.vk_beta_2[0][0]));  // x_c1
    parts.push(this.bnToBuf(vk.vk_beta_2[1][1]));  // y_c0
    parts.push(this.bnToBuf(vk.vk_beta_2[1][0]));  // y_c1

    // Gamma G2 (same swap pattern)
    parts.push(this.bnToBuf(vk.vk_gamma_2[0][1])); // x_c0
    parts.push(this.bnToBuf(vk.vk_gamma_2[0][0])); // x_c1
    parts.push(this.bnToBuf(vk.vk_gamma_2[1][1])); // y_c0
    parts.push(this.bnToBuf(vk.vk_gamma_2[1][0])); // y_c1

    // Delta G2 (same swap pattern)
    parts.push(this.bnToBuf(vk.vk_delta_2[0][1])); // x_c0
    parts.push(this.bnToBuf(vk.vk_delta_2[0][0])); // x_c1
    parts.push(this.bnToBuf(vk.vk_delta_2[1][1])); // y_c0
    parts.push(this.bnToBuf(vk.vk_delta_2[1][0])); // y_c1

    // IC (G1 points)
    for (const ic of vk.IC) {
      parts.push(this.bnToBuf(ic[0]));
      parts.push(this.bnToBuf(ic[1]));
    }

    // Return Big Endian bytes when using alt_bn128 syscalls
    return Buffer.concat(parts);
  }

  /**
   * Reverse each N-byte chunk in a buffer.
   * Used to convert Big Endian to Little Endian for groth16-solana.
   */
  private reverseChunks(buffer: Buffer, chunkSize: number): Buffer {
    const result = Buffer.alloc(buffer.length);
    for (let i = 0; i < buffer.length; i += chunkSize) {
      for (let j = 0; j < chunkSize && i + j < buffer.length; j++) {
        result[i + j] = buffer[i + chunkSize - 1 - j];
      }
    }
    return result;
  }

  /**
   * Ensure verification key is stored on-chain
   */
  /**
   * Ensure verification key is stored on-chain
   */
  async ensureVerificationKeyStored(circuitType: number, poolAddress: PublicKey): Promise<void> {
    // Check if account exists
    let seedPrefix = 'vk_transfer';
    if (circuitType === 1) seedPrefix = 'vk_balance';
    if (circuitType === 2) seedPrefix = 'vk_ring_sig';

    const [vkAddress] = PublicKey.findProgramAddressSync(
      [Buffer.from(seedPrefix), poolAddress.toBuffer()],
      this.programId
    );

    const accountInfo = await this.connection.getAccountInfo(vkAddress);
    if (accountInfo && accountInfo.data.length > 500) {
      console.log(`✅ Verification key exists (${accountInfo.data.length} bytes)`);
      return;
    }

    console.log(`⚠️ Verification key not found for type ${circuitType}. Storing now...`);

    // Load JSON
    let vkJson;
    const filename = circuitType === 0 ? 'transfer_verification_key.json' :
      circuitType === 1 ? 'balance_verification_key.json' :
        'ring_signature_verification_key.json';

    // Check if we are in browser environment or if circuitsPath looks like a URL/relative path
    const isBrowser = typeof (globalThis as any).window !== 'undefined';

    try {
      if (isBrowser || this.circuitsPath.startsWith('http') || this.circuitsPath.startsWith('.')) {
        // Try fetch first (works for browser and local server)
        // Ensure slash
        const prefix = this.circuitsPath.endsWith('/') ? this.circuitsPath : `${this.circuitsPath}/`;
        const path = `${prefix}${filename}`;

        console.log(`   Fetching VK from ${path}...`);
        const resp = await fetch(path);
        if (!resp.ok) throw new Error(`Failed to fetch VK: ${resp.statusText}`);
        vkJson = await resp.json();
      } else {
        // Fallback to FS for Node.js absolute paths
        const fs = require('fs');
        const path = `${this.circuitsPath}/${filename}`;
        console.log(`   Loading VK from ${path}...`);
        vkJson = JSON.parse(fs.readFileSync(path, 'utf-8'));
      }
    } catch (e) {
      console.error("❌ Failed to load VK JSON:", e);
      throw new Error(`Failed to load verification key: ${(e as Error).message}`);
    }

    await this.storeVerificationKey(circuitType, vkJson, poolAddress);
  }

  private bnToBuf(bnStr: string): Buffer {
    // Robust implementation for both Node.js and browser
    const hex = BigInt(bnStr).toString(16).padStart(64, '0');
    const buf = Buffer.alloc(32);
    for (let i = 0; i < 32; i++) {
      buf[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    return buf;
  }

  private getMockRoot(leaf: bigint): bigint {
    let mockRoot = leaf;
    for (let i = 0; i < MERKLE_TREE_DEPTH; i++) {
      mockRoot = this.poseidon.F.toObject(this.poseidon([mockRoot, 0n])); // Right sibling 0
    }
    return mockRoot;
  }

  private encodeDepositInstruction(commitment: Uint8Array, amount: bigint, newRoot: Buffer): Buffer {
    // Rust: Deposit { commitment: [u8; 32], amount: u64, new_root: [u8; 32] }
    // Discriminant: 1
    const buffer = Buffer.alloc(1 + 32 + 8 + 32);
    buffer.writeUInt8(1, 0);
    buffer.set(commitment, 1);
    buffer.writeBigUInt64LE(amount, 33);
    buffer.set(newRoot, 41);
    return buffer;
  }

  private encodeWithdrawInstruction(
    proof: Uint8Array,
    root: Uint8Array,
    nullifier: Uint8Array,
    amount: bigint,
    recipient: PublicKey,
    newCommitment?: Uint8Array,
    newRoot?: Uint8Array
  ): Buffer {
    // Rust layout:
    // Withdraw {
    //   proof: Vec<u8>,
    //   root: [u8; 32],
    //   nullifier: [u8; 32],
    //   new_commitment: Option<[u8; 32]>,
    //   recipient: Pubkey,
    //   amount: u64,
    //   new_root: [u8; 32],
    // }
    // Discriminant: 2

    const buffer = Buffer.alloc(1 + 4 + proof.length + 32 + 32 + 1 + 32 + 32 + 8 + 32); // Max size
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

    // Option<[u8; 32]> for new_commitment
    if (newCommitment) {
      buffer.writeUInt8(1, offset);
      offset += 1;
      buffer.set(newCommitment, offset);
      offset += 32;
    } else {
      buffer.writeUInt8(0, offset);
      offset += 1;
    }

    buffer.set(recipient.toBuffer(), offset);
    offset += 32;

    buffer.writeBigUInt64LE(amount, offset);
    offset += 8;

    buffer.set(newRoot || root, offset); // If newRoot not provided (should be), use logic? No, must provide.
    // If optional, fallback to root?
    offset += 32;

    // Slice buffer to actual size used
    // offset += 8; // Handled by write
    return buffer.slice(0, offset);
  }

  private async sendAndConfirm(transaction: Transaction, extraSigners: Keypair[] = []): Promise<string> {
    let retries = 5;
    let lastError: any;

    while (retries > 0) {
      try {
        console.log('🔄 Getting fresh blockhash...');
        const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash('confirmed');
        console.log(`   Using Blockhash: ${blockhash}`);
        console.log(`   LastValidHeight: ${lastValidBlockHeight}`);

        transaction.recentBlockhash = blockhash;
        transaction.feePayer = this.wallet.publicKey;

        if (extraSigners.length > 0) {
          transaction.partialSign(...extraSigners);
        }

        console.log('✍️  Requesting wallet signature...');
        let signed;
        try {
          signed = await this.wallet.signTransaction(transaction);
        } catch (signError: any) {
          console.error('❌ Wallet signature failed:', signError);
          console.error('   Hint: Ensure your wallet is connected to the same network as the application.');
          throw signError;
        }

        console.log('🚀 Sending raw transaction...');

        // Log instruction data for debugging
        if (transaction.instructions.length > 0) {
          console.log('   Instruction[0] Data Len:', transaction.instructions[0].data.length);
          console.log('   Instruction[0] Data Hex:', transaction.instructions[0].data.slice(0, 16).toString('hex') + '...');
        }

        const signature = await this.connection.sendRawTransaction(signed.serialize(), {
          skipPreflight: false, // Enable preflight to catch simulation errors
          maxRetries: 5,
        });

        console.log(`✅ Sent transaction: ${signature}, waiting for confirmation...`);

        const confirmation = await this.connection.confirmTransaction({
          signature,
          blockhash,
          lastValidBlockHeight
        }, 'confirmed');

        if (confirmation.value.err) {
          throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
        }

        return signature;
      } catch (error: any) {
        console.warn(`⚠️ Transaction attempt failed (retries left: ${retries - 1}):`, error.message);
        lastError = error;

        const errString = error.toString() + (error.message || '');
        if (
          errString.includes('Blockhash') ||
          errString.includes('blockhash') ||
          errString.includes('expired') ||
          errString.includes('block height exceeded')
        ) {
          retries--;
          console.log(`♻️  Retrying... (${retries} attempts left)`);
          await new Promise(r => setTimeout(r, 2000)); // Wait 2s before retry
          continue;
        }

        throw error; // Rethrow other errors immediately
      }
    }

    throw lastError;
  }
}

export type { ShadowClientConfig };
