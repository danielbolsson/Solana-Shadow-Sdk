/**
 * Shadow Privacy - Trusted Setup Ceremony Coordinator
 *
 * Production ceremony coordinator for real multi-party participation
 * Handles file uploads, verification, and participant management
 */

const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const app = express();
const PORT = process.env.PORT || 4000;

// Ceremony configuration
const CEREMONY_DIR = path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(CEREMONY_DIR, 'uploads');
const CURRENT_DIR = path.join(CEREMONY_DIR, 'current');
const ATTESTATIONS_DIR = path.join(CEREMONY_DIR, 'attestations');

// Create directories
[CEREMONY_DIR, UPLOADS_DIR, CURRENT_DIR, ATTESTATIONS_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Ceremony state
const STATE_FILE = path.join(CEREMONY_DIR, 'state.json');

function loadState() {
  if (fs.existsSync(STATE_FILE)) {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
  }
  return {
    phase: 'phase1', // phase1, phase2_transfer, phase2_balance, phase2_ring, complete
    currentParticipant: 0,
    participants: [],
    phase1Complete: false,
    transferComplete: false,
    balanceComplete: false,
    ringComplete: false,
  };
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

let ceremonyState = loadState();

// Multer configuration for file uploads
const storage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    cb(null, `${timestamp}-${file.originalname}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB max
  fileFilter: (req, file, cb) => {
    if (file.originalname.endsWith('.ptau') || file.originalname.endsWith('.zkey')) {
      cb(null, true);
    } else {
      cb(new Error('Only .ptau and .zkey files allowed'));
    }
  }
});

app.use(express.json());
app.use(express.static('public'));

// === API ENDPOINTS ===

/**
 * GET /api/status
 * Get current ceremony status
 */
app.get('/api/status', (req, res) => {
  res.json({
    phase: ceremonyState.phase,
    currentParticipant: ceremonyState.currentParticipant,
    totalParticipants: ceremonyState.participants.length,
    participants: ceremonyState.participants.map(p => ({
      name: p.name,
      contribution: p.contribution,
      verified: p.verified,
      timestamp: p.timestamp,
      hash: p.hash
    })),
    progress: {
      phase1: ceremonyState.phase1Complete,
      transfer: ceremonyState.transferComplete,
      balance: ceremonyState.balanceComplete,
      ring: ceremonyState.ringComplete,
    }
  });
});

/**
 * POST /api/register
 * Register as a participant
 */
app.post('/api/register', (req, res) => {
  const { name, email, pgpKey } = req.body;

  if (!name || !email) {
    return res.status(400).json({ error: 'Name and email required' });
  }

  const participant = {
    id: crypto.randomBytes(16).toString('hex'),
    name,
    email,
    pgpKey,
    registeredAt: new Date().toISOString(),
    contribution: null,
    verified: false,
  };

  ceremonyState.participants.push(participant);
  saveState(ceremonyState);

  res.json({
    participantId: participant.id,
    message: 'Registered successfully. You will be notified when it\'s your turn.',
    position: ceremonyState.participants.length
  });
});

/**
 * GET /api/download/current
 * Download current contribution file for next participant
 */
app.get('/api/download/current', (req, res) => {
  const { participantId } = req.query;

  const participant = ceremonyState.participants.find(p => p.id === participantId);
  if (!participant) {
    return res.status(403).json({ error: 'Invalid participant ID' });
  }

  // Check if it's their turn
  const nextParticipant = ceremonyState.participants[ceremonyState.currentParticipant];
  if (!nextParticipant || nextParticipant.id !== participantId) {
    return res.status(403).json({
      error: 'Not your turn yet',
      position: ceremonyState.participants.indexOf(participant) + 1,
      current: ceremonyState.currentParticipant + 1
    });
  }

  let filename;
  switch (ceremonyState.phase) {
    case 'phase1':
      filename = `pot20_${String(ceremonyState.currentParticipant).padStart(4, '0')}.ptau`;
      break;
    case 'phase2_transfer':
      filename = `transfer_${String(ceremonyState.currentParticipant).padStart(4, '0')}.zkey`;
      break;
    case 'phase2_balance':
      filename = `balance_${String(ceremonyState.currentParticipant).padStart(4, '0')}.zkey`;
      break;
    case 'phase2_ring':
      filename = `ring_sig_${String(ceremonyState.currentParticipant).padStart(4, '0')}.zkey`;
      break;
    default:
      return res.status(400).json({ error: 'Ceremony phase error' });
  }

  const filePath = path.join(CURRENT_DIR, filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Current contribution file not found' });
  }

  res.download(filePath, filename);
});

/**
 * POST /api/upload/contribution
 * Upload participant's contribution
 */
app.post('/api/upload/contribution', upload.single('file'), async (req, res) => {
  const { participantId, attestation } = req.body;
  const file = req.file;

  if (!file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const participant = ceremonyState.participants.find(p => p.id === participantId);
  if (!participant) {
    fs.unlinkSync(file.path);
    return res.status(403).json({ error: 'Invalid participant ID' });
  }

  // Check if it's their turn
  const nextParticipant = ceremonyState.participants[ceremonyState.currentParticipant];
  if (!nextParticipant || nextParticipant.id !== participantId) {
    fs.unlinkSync(file.path);
    return res.status(403).json({ error: 'Not your turn yet' });
  }

  try {
    // Calculate hash
    const fileBuffer = fs.readFileSync(file.path);
    const hash = crypto.createHash('sha256').update(fileBuffer).digest('hex');

    // Verify contribution
    console.log(`Verifying contribution from ${participant.name}...`);

    let verifyCmd;
    if (file.originalname.endsWith('.ptau')) {
      verifyCmd = `snarkjs powersoftau verify "${file.path}"`;
    } else if (file.originalname.endsWith('.zkey')) {
      // Need to determine which circuit
      let r1csPath;
      if (ceremonyState.phase === 'phase2_transfer') {
        r1csPath = path.join(__dirname, '../circuits/build/transfer.r1cs');
      } else if (ceremonyState.phase === 'phase2_balance') {
        r1csPath = path.join(__dirname, '../circuits/build/balance.r1cs');
      } else if (ceremonyState.phase === 'phase2_ring') {
        r1csPath = path.join(__dirname, '../circuits/build/ring_signature.r1cs');
      }

      const potPath = path.join(CURRENT_DIR, 'pot20_final.ptau');
      verifyCmd = `snarkjs zkey verify "${r1csPath}" "${potPath}" "${file.path}"`;
    }

    execSync(verifyCmd, { stdio: 'pipe' });
    console.log('✓ Verification successful');

    // Move to current directory
    let nextFilename;
    const nextNum = ceremonyState.currentParticipant + 1;

    if (ceremonyState.phase === 'phase1') {
      nextFilename = `pot20_${String(nextNum).padStart(4, '0')}.ptau`;
    } else if (ceremonyState.phase === 'phase2_transfer') {
      nextFilename = `transfer_${String(nextNum).padStart(4, '0')}.zkey`;
    } else if (ceremonyState.phase === 'phase2_balance') {
      nextFilename = `balance_${String(nextNum).padStart(4, '0')}.zkey`;
    } else if (ceremonyState.phase === 'phase2_ring') {
      nextFilename = `ring_sig_${String(nextNum).padStart(4, '0')}.zkey`;
    }

    const newPath = path.join(CURRENT_DIR, nextFilename);
    fs.renameSync(file.path, newPath);

    // Save attestation
    if (attestation) {
      const attestationPath = path.join(ATTESTATIONS_DIR, `${participant.id}.txt`);
      fs.writeFileSync(attestationPath, attestation);
    }

    // Update participant record
    participant.contribution = nextFilename;
    participant.verified = true;
    participant.hash = hash;
    participant.timestamp = new Date().toISOString();

    // Move to next participant
    ceremonyState.currentParticipant++;
    saveState(ceremonyState);

    res.json({
      success: true,
      message: 'Contribution accepted and verified',
      hash,
      nextParticipant: ceremonyState.participants[ceremonyState.currentParticipant]?.name || 'Finalizing phase...'
    });

  } catch (error) {
    // Verification failed
    fs.unlinkSync(file.path);
    console.error('Verification failed:', error.message);

    res.status(400).json({
      error: 'Contribution verification failed',
      details: error.message
    });
  }
});

/**
 * POST /api/coordinator/initialize
 * Initialize ceremony (coordinator only)
 */
app.post('/api/coordinator/initialize', (req, res) => {
  const { secret } = req.body;

  // Simple auth - in production use proper authentication
  if (secret !== process.env.COORDINATOR_SECRET) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  console.log('Initializing Phase 1: Powers of Tau...');

  const initFile = path.join(CURRENT_DIR, 'pot20_0000.ptau');
  execSync(`snarkjs powersoftau new bn128 20 "${initFile}"`, { stdio: 'inherit' });

  ceremonyState.phase = 'phase1';
  ceremonyState.currentParticipant = 0;
  saveState(ceremonyState);

  res.json({ success: true, message: 'Phase 1 initialized' });
});

/**
 * POST /api/coordinator/finalize-phase1
 * Finalize Phase 1 and prepare for Phase 2
 */
app.post('/api/coordinator/finalize-phase1', (req, res) => {
  const { secret, beacon } = req.body;

  if (secret !== process.env.COORDINATOR_SECRET) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  console.log('Finalizing Phase 1...');

  const lastFile = path.join(CURRENT_DIR, `pot20_${String(ceremonyState.currentParticipant).padStart(4, '0')}.ptau`);
  const beaconFile = path.join(CURRENT_DIR, 'pot20_beacon.ptau');
  const finalFile = path.join(CURRENT_DIR, 'pot20_final.ptau');

  // Apply beacon
  execSync(`snarkjs powersoftau beacon "${lastFile}" "${beaconFile}" ${beacon} 10 -n="Final Beacon"`, { stdio: 'inherit' });

  // Prepare for Phase 2
  execSync(`snarkjs powersoftau prepare phase2 "${beaconFile}" "${finalFile}"`, { stdio: 'inherit' });

  ceremonyState.phase1Complete = true;
  ceremonyState.phase = 'phase2_transfer';
  ceremonyState.currentParticipant = 0;
  saveState(ceremonyState);

  res.json({ success: true, message: 'Phase 1 complete, starting Phase 2' });
});

/**
 * POST /api/coordinator/init-phase2
 * Initialize Phase 2 for a circuit
 */
app.post('/api/coordinator/init-phase2', (req, res) => {
  const { secret, circuit } = req.body;

  if (secret !== process.env.COORDINATOR_SECRET) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  const r1csPath = path.join(__dirname, `../circuits/build/${circuit}.r1cs`);
  const potPath = path.join(CURRENT_DIR, 'pot20_final.ptau');
  const zkeyPath = path.join(CURRENT_DIR, `${circuit}_0000.zkey`);

  console.log(`Initializing Phase 2 for ${circuit}...`);
  execSync(`snarkjs groth16 setup "${r1csPath}" "${potPath}" "${zkeyPath}"`, { stdio: 'inherit' });

  res.json({ success: true, message: `Phase 2 for ${circuit} initialized` });
});

// Serve coordinator dashboard
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
app.listen(PORT, () => {
  console.log('\n');
  console.log('   ▄████  ██░ ██  ▒█████    ██████ ▄▄▄█████▓');
  console.log('  ██▒ ▀█▒▓██░ ██▒▒██▒  ██▒▒██    ▒ ▓  ██▒ ▓▒');
  console.log(' ▒██░▄▄▄░▒██▀▀██░▒██░  ██▒░ ▓██▄   ▒ ▓██░ ▒░');
  console.log(' ░▓█  ██▓░▓█ ░██ ▒██   ██░  ▒   ██▒░ ▓██▓ ░ ');
  console.log(' ░▒▓███▀▒░▓█▒░██▓░ ████▓▒░▒██████▒▒  ▒██▒ ░ ');
  console.log('  ░▒   ▒  ▒ ░░▒░▒░ ▒░▒░▒░ ▒ ▒▓▒ ▒ ░  ▒ ░░   ');
  console.log('   ░   ░  ▒ ░▒░ ░  ░ ▒ ▒░ ░ ░▒  ░ ░    ░    ');
  console.log(' ░ ░   ░  ░  ░░ ░░ ░ ░ ▒  ░  ░  ░    ░      ');
  console.log('       ░  ░  ░  ░    ░ ░        ░           ');
  console.log('\n');
  console.log('========================================');
  console.log('Shadow Privacy - Ceremony Coordinator');
  console.log('========================================');
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`\nCurrent phase: ${ceremonyState.phase}`);
  console.log(`Participants: ${ceremonyState.participants.length}`);
  console.log(`Next participant: ${ceremonyState.currentParticipant + 1}`);
  console.log('\nCoordinator endpoints:');
  console.log('  POST /api/coordinator/initialize - Initialize ceremony');
  console.log('  POST /api/coordinator/finalize-phase1 - Finalize Phase 1');
  console.log('  POST /api/coordinator/init-phase2 - Initialize Phase 2');
  console.log('\nParticipant endpoints:');
  console.log('  POST /api/register - Register as participant');
  console.log('  GET /api/download/current - Download current file');
  console.log('  POST /api/upload/contribution - Upload contribution');
  console.log('  GET /api/status - Get ceremony status');
});
