#!/usr/bin/env node

/**
 * Shadow Privacy - Ceremony Participant CLI
 *
 * Tool for participants to contribute to the trusted setup ceremony
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const readline = require('readline');
const crypto = require('crypto');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(query) {
  return new Promise(resolve => rl.question(query, resolve));
}

const COORDINATOR_URL = process.env.COORDINATOR_URL || 'http://localhost:4000';
const DATA_DIR = path.join(__dirname, 'participant-data');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

async function main() {
  console.log('\n');
  console.log('  ███████╗██╗  ██╗ █████╗ ██████╗  ██████╗ ██╗    ██╗');
  console.log('  ██╔════╝██║  ██║██╔══██╗██╔══██╗██╔═══██╗██║    ██║');
  console.log('  ███████╗███████║███████║██║  ██║██║   ██║██║ █╗ ██║');
  console.log('  ╚════██║██╔══██║██╔══██║██║  ██║██║   ██║██║███╗██║');
  console.log('  ███████║██║  ██║██║  ██║██████╔╝╚██████╔╝╚███╔███╔╝');
  console.log('  ╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝╚═════╝  ╚═════╝  ╚══╝╚══╝ ');
  console.log('\n');
  console.log('========================================');
  console.log('Shadow Privacy - Ceremony Participant');
  console.log('========================================\n');

  // Check if already registered
  const configPath = path.join(DATA_DIR, 'config.json');
  let config = {};

  if (fs.existsSync(configPath)) {
    config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    console.log(`Welcome back, ${config.name}!`);
    console.log(`Participant ID: ${config.participantId}\n`);
  } else {
    // Register new participant
    console.log('First time setup - Let\'s register you as a participant\n');

    const name = await question('Your name or organization: ');
    const email = await question('Your email: ');
    const pgpKey = await question('Your PGP key (optional, press Enter to skip): ');

    try {
      const response = await axios.post(`${COORDINATOR_URL}/api/register`, {
        name,
        email,
        pgpKey: pgpKey || undefined
      });

      config = {
        participantId: response.data.participantId,
        name,
        email,
      };

      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

      console.log('\n✓ Registration successful!');
      console.log(`Position in queue: ${response.data.position}`);
      console.log(`Participant ID: ${config.participantId}\n`);

    } catch (error) {
      console.error('Registration failed:', error.response?.data?.error || error.message);
      process.exit(1);
    }
  }

  // Main menu
  while (true) {
    console.log('\nWhat would you like to do?');
    console.log('1. Check ceremony status');
    console.log('2. Download contribution file (when it\'s your turn)');
    console.log('3. Make contribution');
    console.log('4. Upload contribution');
    console.log('5. Exit');

    const choice = await question('\nChoice: ');

    switch (choice) {
      case '1':
        await checkStatus();
        break;
      case '2':
        await downloadFile(config);
        break;
      case '3':
        await makeContribution();
        break;
      case '4':
        await uploadContribution(config);
        break;
      case '5':
        console.log('\nThank you for participating!');
        rl.close();
        process.exit(0);
      default:
        console.log('Invalid choice');
    }
  }
}

async function checkStatus() {
  try {
    const response = await axios.get(`${COORDINATOR_URL}/api/status`);
    const status = response.data;

    console.log('\n=== Ceremony Status ===');
    console.log(`Phase: ${status.phase}`);
    console.log(`Current participant: ${status.currentParticipant + 1} of ${status.totalParticipants}`);
    console.log(`\nProgress:`);
    console.log(`  Phase 1: ${status.progress.phase1 ? '✓ Complete' : '⏳ In progress'}`);
    console.log(`  Transfer: ${status.progress.transfer ? '✓ Complete' : '⏳ Pending'}`);
    console.log(`  Balance: ${status.progress.balance ? '✓ Complete' : '⏳ Pending'}`);
    console.log(`  Ring Sig: ${status.progress.ring ? '✓ Complete' : '⏳ Pending'}`);

    console.log(`\nParticipants:`);
    status.participants.forEach((p, i) => {
      const status = p.verified ? '✓' : '⏳';
      console.log(`  ${i + 1}. ${status} ${p.name} ${p.verified ? `(${p.hash.substring(0, 8)}...)` : ''}`);
    });

  } catch (error) {
    console.error('Failed to fetch status:', error.message);
  }
}

async function downloadFile(config) {
  try {
    const response = await axios.get(`${COORDINATOR_URL}/api/download/current`, {
      params: { participantId: config.participantId },
      responseType: 'arraybuffer'
    });

    const filename = response.headers['content-disposition']
      ?.split('filename=')[1]
      ?.replace(/"/g, '') || 'contribution.ptau';

    const filepath = path.join(DATA_DIR, filename);
    fs.writeFileSync(filepath, response.data);

    console.log(`\n✓ Downloaded: ${filename}`);
    console.log(`  Saved to: ${filepath}`);
    console.log(`  Size: ${(response.data.length / 1024 / 1024).toFixed(2)} MB`);

    // Calculate hash
    const hash = crypto.createHash('sha256').update(response.data).digest('hex');
    console.log(`  SHA256: ${hash}`);

  } catch (error) {
    if (error.response?.status === 403) {
      console.error('\n' + error.response.data.error);
      if (error.response.data.position) {
        console.log(`Your position: ${error.response.data.position}`);
        console.log(`Current: ${error.response.data.current}`);
      }
    } else {
      console.error('Download failed:', error.response?.data?.error || error.message);
    }
  }
}

async function makeContribution() {
  console.log('\n=== Make Contribution ===\n');

  // List files in data directory
  const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.ptau') || f.endsWith('.zkey'));

  if (files.length === 0) {
    console.log('No contribution files found. Download the current file first.');
    return;
  }

  console.log('Available files:');
  files.forEach((f, i) => console.log(`${i + 1}. ${f}`));

  const choice = await question('\nSelect file to contribute to: ');
  const fileIndex = parseInt(choice) - 1;

  if (fileIndex < 0 || fileIndex >= files.length) {
    console.log('Invalid choice');
    return;
  }

  const inputFile = path.join(DATA_DIR, files[fileIndex]);
  const isPtau = inputFile.endsWith('.ptau');

  // Generate output filename
  const outputFile = inputFile.replace(/(\d{4})\./, (match, num) => {
    return (parseInt(num) + 1).toString().padStart(4, '0') + '.';
  });

  console.log(`\nInput: ${path.basename(inputFile)}`);
  console.log(`Output: ${path.basename(outputFile)}`);

  const confirm = await question('\nGenerate strong random entropy? (y/n): ');
  if (confirm.toLowerCase() !== 'y') {
    console.log('Cancelled');
    return;
  }

  console.log('\n🎲 Generating contribution with strong randomness...');
  console.log('⚠️  DO NOT interrupt this process!\n');

  try {
    let cmd;
    if (isPtau) {
      cmd = `snarkjs powersoftau contribute "${inputFile}" "${outputFile}" --name="${config.name}" -v`;
    } else {
      cmd = `snarkjs zkey contribute "${inputFile}" "${outputFile}" --name="${config.name}" -v`;
    }

    execSync(cmd, { stdio: 'inherit' });

    console.log('\n✓ Contribution complete!');
    console.log(`  Output file: ${outputFile}`);

    // Calculate hash
    const hash = crypto.createHash('sha256').update(fs.readFileSync(outputFile)).digest('hex');
    console.log(`  SHA256: ${hash}`);

    console.log('\n⚠️  IMPORTANT: Delete the input file to destroy toxic waste!');
    const destroy = await question('Delete input file now? (y/n): ');

    if (destroy.toLowerCase() === 'y') {
      // Secure delete (multiple overwrites)
      console.log('🔥 Securely deleting input file...');
      const size = fs.statSync(inputFile).size;
      const randomData = crypto.randomBytes(size);
      fs.writeFileSync(inputFile, randomData);
      fs.writeFileSync(inputFile, Buffer.alloc(size, 0));
      fs.unlinkSync(inputFile);
      console.log('✓ Input file destroyed');
    }

  } catch (error) {
    console.error('Contribution failed:', error.message);
  }
}

async function uploadContribution(config) {
  console.log('\n=== Upload Contribution ===\n');

  // List files
  const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.ptau') || f.endsWith('.zkey'));

  if (files.length === 0) {
    console.log('No contribution files found.');
    return;
  }

  console.log('Available files:');
  files.forEach((f, i) => console.log(`${i + 1}. ${f}`));

  const choice = await question('\nSelect file to upload: ');
  const fileIndex = parseInt(choice) - 1;

  if (fileIndex < 0 || fileIndex >= files.length) {
    console.log('Invalid choice');
    return;
  }

  const filepath = path.join(DATA_DIR, files[fileIndex]);

  console.log('\n=== Attestation ===');
  console.log('Please provide a signed attestation of your contribution.\n');
  console.log('Example:');
  console.log('  I, [Your Name], contributed to the Shadow Privacy ceremony.');
  console.log('  Entropy source: /dev/urandom + physical dice rolls');
  console.log('  I destroyed all intermediate files.');
  console.log('  GPG Signature: [signature]\n');

  const attestation = await question('Paste your attestation (or press Enter to skip): ');

  console.log('\nUploading...');

  try {
    const FormData = require('form-data');
    const form = new FormData();
    form.append('file', fs.createReadStream(filepath));
    form.append('participantId', config.participantId);
    if (attestation) {
      form.append('attestation', attestation);
    }

    const response = await axios.post(
      `${COORDINATOR_URL}/api/upload/contribution`,
      form,
      { headers: form.getHeaders() }
    );

    console.log('\n✓ Upload successful!');
    console.log(`  Hash: ${response.data.hash}`);
    console.log(`  Next participant: ${response.data.nextParticipant}`);

  } catch (error) {
    console.error('\nUpload failed:', error.response?.data?.error || error.message);
    if (error.response?.data?.details) {
      console.error('Details:', error.response.data.details);
    }
  }
}

// Run
main().catch(error => {
  console.error('Error:', error.message);
  rl.close();
  process.exit(1);
});
