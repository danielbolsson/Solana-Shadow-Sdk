/**
 * Encrypted Note Storage
 *
 * Production-grade encrypted storage for user notes
 * Replaces plaintext JSON file storage with encrypted database
 */

import { createCipheriv, createDecipheriv, randomBytes, scrypt } from 'crypto';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import { Note } from './note-manager';

const scryptAsync = promisify(scrypt);

interface EncryptedBlob {
  iv: string;
  salt: string;
  data: string;
  version: number;
}

export class EncryptedNoteStorage {
  private storageDir: string;
  private initialized: boolean = false;

  constructor(storageDir?: string) {
    this.storageDir = storageDir || path.join(process.env.HOME || process.env.USERPROFILE || '.', '.ghost-privacy');

    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true, mode: 0o700 });
    }
  }

  /**
   * Derive encryption key from password
   */
  private async deriveKey(password: string, salt: Buffer): Promise<Buffer> {
    return (await scryptAsync(password, salt, 32)) as Buffer;
  }

  /**
   * Encrypt data with AES-256-GCM
   */
  private async encrypt(data: string, password: string): Promise<EncryptedBlob> {
    const salt = randomBytes(32);
    const iv = randomBytes(16);
    const key = await this.deriveKey(password, salt);

    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([
      cipher.update(data, 'utf8'),
      cipher.final()
    ]);

    const authTag = cipher.getAuthTag();

    return {
      iv: iv.toString('hex'),
      salt: salt.toString('hex'),
      data: Buffer.concat([encrypted, authTag]).toString('hex'),
      version: 1
    };
  }

  /**
   * Decrypt data
   */
  private async decrypt(blob: EncryptedBlob, password: string): Promise<string> {
    const salt = Buffer.from(blob.salt, 'hex');
    const iv = Buffer.from(blob.iv, 'hex');
    const key = await this.deriveKey(password, salt);

    const encryptedData = Buffer.from(blob.data, 'hex');
    const authTag = encryptedData.slice(-16);
    const data = encryptedData.slice(0, -16);

    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);

    return Buffer.concat([
      decipher.update(data),
      decipher.final()
    ]).toString('utf8');
  }

  /**
   * Save notes encrypted
   */
  async saveNotes(notes: Note[], password: string): Promise<void> {
    const notesJson = JSON.stringify(notes, null, 2);
    const encrypted = await this.encrypt(notesJson, password);

    const filePath = path.join(this.storageDir, 'notes.enc');
    fs.writeFileSync(filePath, JSON.stringify(encrypted), { mode: 0o600 });
  }

  /**
   * Load notes decrypted
   */
  async loadNotes(password: string): Promise<Note[]> {
    const filePath = path.join(this.storageDir, 'notes.enc');

    if (!fs.existsSync(filePath)) {
      return [];
    }

    try {
      const encrypted = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as EncryptedBlob;
      const decrypted = await this.decrypt(encrypted, password);
      return JSON.parse(decrypted);
    } catch (error) {
      throw new Error('Failed to decrypt notes. Invalid password or corrupted data.');
    }
  }

  /**
   * Change encryption password
   */
  async changePassword(oldPassword: string, newPassword: string): Promise<void> {
    const notes = await this.loadNotes(oldPassword);
    await this.saveNotes(notes, newPassword);
  }

  /**
   * Backup encrypted notes
   */
  async backup(backupPath: string): Promise<void> {
    const sourcePath = path.join(this.storageDir, 'notes.enc');

    if (!fs.existsSync(sourcePath)) {
      throw new Error('No notes to backup');
    }

    fs.copyFileSync(sourcePath, backupPath);
  }

  /**
   * Restore from backup
   */
  async restore(backupPath: string, password: string): Promise<void> {
    if (!fs.existsSync(backupPath)) {
      throw new Error('Backup file not found');
    }

    // Verify backup can be decrypted
    const encrypted = JSON.parse(fs.readFileSync(backupPath, 'utf-8')) as EncryptedBlob;
    await this.decrypt(encrypted, password);

    // Copy to storage directory
    const destPath = path.join(this.storageDir, 'notes.enc');
    fs.copyFileSync(backupPath, destPath);
  }

  /**
   * Delete all stored notes (secure deletion)
   */
  async deleteAll(): Promise<void> {
    const filePath = path.join(this.storageDir, 'notes.enc');

    if (fs.existsSync(filePath)) {
      // Overwrite with random data before deletion
      const size = fs.statSync(filePath).size;
      const randomData = randomBytes(size);
      fs.writeFileSync(filePath, randomData);
      fs.unlinkSync(filePath);
    }
  }

  /**
   * Export notes to encrypted file
   */
  async exportEncrypted(exportPath: string, password: string): Promise<void> {
    const notes = await this.loadNotes(password);

    // Re-encrypt with export password (may be different)
    const exportPassword = password; // Or prompt for new password
    const encrypted = await this.encrypt(JSON.stringify(notes, null, 2), exportPassword);

    fs.writeFileSync(exportPath, JSON.stringify(encrypted, null, 2), { mode: 0o600 });
  }

  /**
   * Import notes from encrypted file
   */
  async importEncrypted(importPath: string, password: string): Promise<Note[]> {
    const encrypted = JSON.parse(fs.readFileSync(importPath, 'utf-8')) as EncryptedBlob;
    const decrypted = await this.decrypt(encrypted, password);
    const importedNotes = JSON.parse(decrypted) as Note[];

    // Merge with existing notes
    const existingNotes = await this.loadNotes(password);
    const mergedNotes = [...existingNotes, ...importedNotes];

    // Remove duplicates by commitment
    const uniqueNotes = mergedNotes.filter((note, index, self) =>
      index === self.findIndex(n => n.commitment === note.commitment)
    );

    await this.saveNotes(uniqueNotes, password);

    return uniqueNotes;
  }
}

export default EncryptedNoteStorage;
