
import { Buffer } from 'buffer';
import { PublicKey } from '@solana/web3.js';

// Mock class to replicate client logic
class Serializer {
    encode(proof: Buffer, root: Buffer, nullifier: Buffer, newCommitment: Buffer | undefined, recipient: PublicKey, amount: bigint) {
        // Calculate size
        let size = 1 + 4 + proof.length + 32 + 32 + (newCommitment ? 33 : 1) + 32 + 8;
        const buffer = Buffer.alloc(size + 100); // Extra space

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
        // Debug output
        console.log(`Amount wrote at offset ${offset}: ${amount}`);
        // Read back
        console.log(`Read back: ${buffer.readBigUInt64LE(offset)}`);

        offset += 8;

        return buffer.slice(0, offset);
    }
}

const proof = Buffer.alloc(256).fill(1);
const root = Buffer.alloc(32).fill(2);
const nullifier = Buffer.alloc(32).fill(3);
const newCommitment = Buffer.alloc(32).fill(4);
const recipient = new PublicKey("H5sKyTzcVq7cXerDgptDEwLDJhjzEPqrvF4KGh2VNaHN");
const amount = 100002474n;

const s = new Serializer();
const buf = s.encode(proof, root, nullifier, newCommitment, recipient, amount);

console.log("Buffer Length:", buf.length);
console.log("Buffer Hex:", buf.toString('hex'));

// Check last 8 bytes (amount)
const amountBytes = buf.slice(buf.length - 8);
console.log("Amount Bytes:", amountBytes.toString('hex'));
console.log("Amount Value:", amountBytes.readBigUInt64LE(0));
