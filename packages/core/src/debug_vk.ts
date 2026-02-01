// Debug script to compare VK serialization
import * as fs from 'fs';
import * as path from 'path';

const circuitsPath = '/home/daniel/src/Solana-Shadow-Sdk/circuits/build';

function bnToBuf(bnStr: string): Buffer {
    let hex = BigInt(bnStr).toString(16);
    if (hex.length % 2 !== 0) hex = '0' + hex;
    return Buffer.from(hex.padStart(64, '0'), 'hex');
}

function reverseChunks(buffer: Buffer, chunkSize: number): Buffer {
    const result = Buffer.alloc(buffer.length);
    for (let i = 0; i < buffer.length; i += chunkSize) {
        for (let j = 0; j < chunkSize && i + j < buffer.length; j++) {
            result[i + j] = buffer[i + chunkSize - 1 - j];
        }
    }
    return result;
}

function serializeVerificationKey(vk: any): Buffer {
    const parts: Buffer[] = [];

    // Alpha G1 (64 bytes): X, Y
    parts.push(bnToBuf(vk.vk_alpha_1[0]));
    parts.push(bnToBuf(vk.vk_alpha_1[1]));

    // Beta G2 (128 bytes): X(c0, c1), Y(c0, c1)
    parts.push(bnToBuf(vk.vk_beta_2[0][0])); // c0
    parts.push(bnToBuf(vk.vk_beta_2[0][1])); // c1
    parts.push(bnToBuf(vk.vk_beta_2[1][0])); // c0
    parts.push(bnToBuf(vk.vk_beta_2[1][1])); // c1

    // ... (rest of VK)
    parts.push(bnToBuf(vk.vk_gamma_2[0][0]));
    parts.push(bnToBuf(vk.vk_gamma_2[0][1]));
    parts.push(bnToBuf(vk.vk_gamma_2[1][0]));
    parts.push(bnToBuf(vk.vk_gamma_2[1][1]));

    parts.push(bnToBuf(vk.vk_delta_2[0][0]));
    parts.push(bnToBuf(vk.vk_delta_2[0][1]));
    parts.push(bnToBuf(vk.vk_delta_2[1][0]));
    parts.push(bnToBuf(vk.vk_delta_2[1][1]));

    for (const ic of vk.IC) {
        parts.push(bnToBuf(ic[0]));
        parts.push(bnToBuf(ic[1]));
    }

    const vkBuffer = Buffer.concat(parts);
    return reverseChunks(vkBuffer, 32);
}

// Load VK
const vkPath = path.join(circuitsPath, 'transfer_verification_key.json');
const vkJson = JSON.parse(fs.readFileSync(vkPath, 'utf-8'));

console.log('=== VK_ALPHA_1 from snarkjs ===');
console.log('  X:', vkJson.vk_alpha_1[0]);
console.log('  Y:', vkJson.vk_alpha_1[1]);

// Serialize
const serialized = serializeVerificationKey(vkJson);

console.log('\n=== Serialized VK (first 64 bytes = vk_alpha_g1) ===');
console.log('  Hex:', serialized.slice(0, 64).toString('hex'));
console.log('  Array:', Array.from(serialized.slice(0, 64)));

// Compare with library test constant
const libTestAlpha = [
    45, 77, 154, 167, 227, 2, 217, 223, 65, 116, 157, 85, 7, 148, 157, 5, 219, 234, 51,
    251, 177, 108, 100, 59, 34, 245, 153, 162, 190, 109, 242, 226, 20, 190, 221, 80, 60,
    55, 206, 176, 97, 216, 236, 96, 32, 159, 227, 69, 206, 137, 131, 10, 25, 35, 3, 1, 240,
    118, 202, 255, 0, 77, 25, 38,
];

console.log('\n=== Library test constant vk_alpha_g1 ===');
console.log('  Array:', libTestAlpha);
console.log('  Hex:', Buffer.from(libTestAlpha).toString('hex'));
