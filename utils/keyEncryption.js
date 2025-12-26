'use strict';

const crypto = require('crypto');

const getEncryptionKey = () => {
  const envKey = process.env.E2E_PRIVATE_KEY_ENCRYPTION_KEY;
  
  if (envKey) {
    // Ensure the key is 32 bytes (256 bits) for AES-256
    const keyBuffer = Buffer.from(envKey, 'utf8');
    if (keyBuffer.length === 32) {
      return keyBuffer;
    }
    // If key is not exactly 32 bytes, hash it to get 32 bytes
    return crypto.createHash('sha256').update(keyBuffer).digest();
  }

  console.warn('WARNING: E2E_PRIVATE_KEY_ENCRYPTION_KEY not set. Using default key (NOT SECURE FOR PRODUCTION)');
  console.warn('Please set E2E_PRIVATE_KEY_ENCRYPTION_KEY in your .env file for production use');
  console.warn('To generate a secure key, run: openssl rand -base64 32');
  return crypto.createHash('sha256').update('default-encryption-key-change-in-production').digest();
};

/**
 * Encrypt private key before storing in database
 * Uses AES-256-GCM for authenticated encryption
 */
const encryptPrivateKey = (privateKey) => {
  if (!privateKey) {
    return null;
  }
  
  try {
    const key = getEncryptionKey();
    const iv = crypto.randomBytes(12); // 12 bytes for GCM
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    
    let encrypted = cipher.update(privateKey, 'utf8', 'base64');
    encrypted += cipher.final('base64');
    
    const authTag = cipher.getAuthTag();
    
    // Combine IV, auth tag, and encrypted data
    const result = {
      iv: iv.toString('base64'),
      authTag: authTag.toString('base64'),
      encrypted: encrypted
    };
    
    return JSON.stringify(result);
  } catch (error) {
    console.error('Error encrypting private key:', error);
    throw new Error('Failed to encrypt private key');
  }
};

/**
 * Decrypt private key after retrieving from database
 * Uses AES-256-GCM for authenticated decryption
 */
const decryptPrivateKey = (encryptedPrivateKey) => {
  if (!encryptedPrivateKey) {
    return null;
  }
  
  try {
    if (!encryptedPrivateKey.startsWith('{')) {
      return encryptedPrivateKey;
    }
    
    const key = getEncryptionKey();
    const data = JSON.parse(encryptedPrivateKey);
    
    if (!data.iv || !data.authTag || !data.encrypted) {
      return encryptedPrivateKey;
    }
    
    const iv = Buffer.from(data.iv, 'base64');
    const authTag = Buffer.from(data.authTag, 'base64');
    const encrypted = data.encrypted;
    
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encrypted, 'base64', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  } catch (error) {
    console.error('Error decrypting private key:', error);
    console.warn('Failed to decrypt private key, assuming plain text (backward compatibility)');
    return encryptedPrivateKey;
  }
};

module.exports = {
  encryptPrivateKey,
  decryptPrivateKey
};


