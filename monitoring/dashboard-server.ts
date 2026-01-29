/**
 * Monitoring Dashboard Server
 *
 * Serves real-time metrics via REST API and WebSocket
 */

import express from 'express';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import { MetricsCollector } from './metrics-collector';
import config from '../config/production.config';
import * as path from 'path';
import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';
import * as fs from 'fs';

const app = express();
const httpServer = createServer(app);
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Load configuration
const cfg = config.load();
const metricsCollector = new MetricsCollector(
  cfg.network.rpcUrl,
  cfg.network.programId
);

// Collect metrics every minute
setInterval(async () => {
  try {
    const metrics = await metricsCollector.collectMetrics();

    // Broadcast to all connected clients
    io.emit('metrics:update', metrics);
  } catch (error) {
    console.error('Failed to collect metrics:', error);
  }
}, 60000);

// REST API Endpoints

/**
 * Get current metrics summary
 */
app.get('/api/metrics/current', (req, res) => {
  const summary = metricsCollector.getCurrentSummary();
  res.json(summary);
});

/**
 * Get metrics history
 */
app.get('/api/metrics/history', (req, res) => {
  const minutes = parseInt(req.query.minutes as string) || 60;
  const history = metricsCollector.getMetricsHistory(minutes);
  res.json(history);
});

/**
 * Get relayer metrics
 */
app.get('/api/relayers', (req, res) => {
  const relayers = metricsCollector.getRelayerMetrics();
  res.json(relayers);
});

/**
 * Get circuit metrics
 */
app.get('/api/circuits', (req, res) => {
  const circuits = metricsCollector.getCircuitMetrics();
  res.json(circuits);
});

/**
 * Get health status
 */
app.get('/api/health', (req, res) => {
  const health = metricsCollector.getHealthStatus();
  res.json(health);
});

/**
 * Record circuit proving (for integration)
 */
app.post('/api/metrics/circuit-proving', (req, res) => {
  const { circuitName, provingTime, success } = req.body;

  if (!circuitName || provingTime === undefined || success === undefined) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  metricsCollector.recordCircuitProving(circuitName, provingTime, success);
  res.json({ success: true });
});

/**
 * Record relayer activity (for integration)
 */
app.post('/api/metrics/relayer-activity', (req, res) => {
  const { endpoint, responseTime, success, feeRate } = req.body;

  if (!endpoint || responseTime === undefined || success === undefined || feeRate === undefined) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  metricsCollector.recordRelayerActivity(endpoint, responseTime, success, feeRate);
  res.json({ success: true });
});

/**
 * Mock Relayer Endpoint (vulnerable for demo)
 */
app.post('/api/relayer/withdraw', async (req, res) => {
  const { poolAddress, vaultAddress, recipient, vkAddress, proof, commitment, nullifier, amount } = req.body;
  console.log('\n🔗 [RELAYER] Received withdraw request...');
  console.log(`   Transferring ${amount} lamports to ${recipient}`);

  try {
    const connection = new Connection(cfg.network.rpcUrl, 'confirmed');

    // Use the pre-funded relayer keypair
    const relayerKeypair = Keypair.fromSecretKey(
      Uint8Array.from(JSON.parse(fs.readFileSync('/home/daniel/.config/solana/relayer.json', 'utf-8')))
    );
    console.log(`   [RELAYER] Relayer Address: ${relayerKeypair.publicKey.toBase58()}`);
    console.log(`   [RELAYER] Relayer Balance: ${(await connection.getBalance(relayerKeypair.publicKey)) / 1e9} SOL`);

    // Correct Borsh serialization for Withdraw instruction (Enum index 2)
    const proofBuffer = Buffer.from(proof, 'hex');
    const data = Buffer.alloc(1 + 4 + proofBuffer.length + 32 + 32 + 1 + 32 + 8);

    let offset = 0;
    data.writeUInt8(2, offset); // Discriminator (Withdraw = 2)
    offset += 1;

    data.writeUInt32LE(proofBuffer.length, offset); // Proof length
    offset += 4;
    proofBuffer.copy(data, offset);
    offset += proofBuffer.length;

    Buffer.from(commitment, 'hex').copy(data, offset); // Root/Commitment
    offset += 32;

    Buffer.from(nullifier, 'hex').copy(data, offset); // Nullifier
    offset += 32;

    data.writeUInt8(0, offset); // Option<NewCommitment> = None
    offset += 1;

    new PublicKey(recipient).toBuffer().copy(data, offset); // Recipient
    offset += 32;

    data.writeBigUInt64LE(BigInt(amount), offset); // Amount

    const instruction = new TransactionInstruction({
      keys: [
        { pubkey: new PublicKey(poolAddress), isSigner: false, isWritable: true },
        { pubkey: new PublicKey(vaultAddress), isSigner: false, isWritable: true },
        { pubkey: new PublicKey(recipient), isSigner: false, isWritable: true },
        { pubkey: new PublicKey(vkAddress), isSigner: false, isWritable: false },
        { pubkey: new PublicKey('11111111111111111111111111111111'), isSigner: false, isWritable: false },
      ],
      programId: new PublicKey(cfg.network.programId),
      data: data
    });

    const transaction = new Transaction().add(instruction);
    const { blockhash } = await connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = relayerKeypair.publicKey;

    transaction.sign(relayerKeypair);

    const signature = await connection.sendRawTransaction(transaction.serialize());
    await connection.confirmTransaction(signature);

    console.log(`✅ [RELAYER] Transaction successful: ${signature}`);

    // Record activity
    metricsCollector.recordRelayerActivity(
      `http://localhost:${PORT}/api/relayer`,
      1200,
      true,
      0.01 // 1% fee
    );

    res.json({ signature });
  } catch (error) {
    console.error('❌ [RELAYER] Withdrawal failed:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// WebSocket connection handling
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  // Send current metrics immediately
  const current = metricsCollector.getCurrentSummary();
  if (current) {
    socket.emit('metrics:update', current);
  }

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });

  // Allow clients to request specific data
  socket.on('metrics:request-history', (minutes: number) => {
    const history = metricsCollector.getMetricsHistory(minutes);
    socket.emit('metrics:history', history);
  });

  socket.on('relayers:request', () => {
    const relayers = metricsCollector.getRelayerMetrics();
    socket.emit('relayers:data', relayers);
  });

  socket.on('circuits:request', () => {
    const circuits = metricsCollector.getCircuitMetrics();
    socket.emit('circuits:data', circuits);
  });
});

// Start server
const PORT = process.env.MONITOR_PORT || 5000;

httpServer.listen(PORT, () => {
  console.log('\n');
  console.log('  ███████╗██╗  ██╗ █████╗ ██████╗  ██████╗ ██╗    ██╗');
  console.log('  ██╔════╝██║  ██║██╔══██╗██╔══██╗██╔═══██╗██║    ██║');
  console.log('  ███████╗███████║███████║██║  ██║██║   ██║██║ █╗ ██║');
  console.log('  ╚════██║██╔══██║██╔══██║██║  ██║██║   ██║██║███╗██║');
  console.log('  ███████║██║  ██║██║  ██║██████╔╝╚██████╔╝╚███╔███╔╝');
  console.log('  ╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝╚═════╝  ╚═════╝  ╚══╝╚══╝ ');
  console.log('\n');
  console.log('========================================');
  console.log('Shadow Privacy - Monitoring Dashboard');
  console.log('========================================');
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`WebSocket available for real-time updates`);
  console.log('\nAPI Endpoints:');
  console.log('  GET  /api/metrics/current - Current metrics');
  console.log('  GET  /api/metrics/history - Historical data');
  console.log('  GET  /api/relayers - Relayer status');
  console.log('  GET  /api/circuits - Circuit performance');
  console.log('  GET  /api/health - System health');
  console.log('  POST /api/metrics/circuit-proving - Record proving');
  console.log('  POST /api/metrics/relayer-activity - Record activity');
  console.log('\nDashboard: http://localhost:' + PORT);
});

export { metricsCollector };
