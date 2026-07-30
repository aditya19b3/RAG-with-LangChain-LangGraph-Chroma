import { getDb } from './firestore.js';
import { encrypt, decrypt, EncryptedData } from '../utils/encryption.js';

const COLLECTION = 'user_credentials';

export interface UserCredentials {
  openAIApiKey?: string;
  chromaUrl?: string;
  chromaApiKey?: string;
  chromaTenant?: string;
  chromaDatabase?: string;
}

interface StoredCredentials {
  openAIApiKey?: EncryptedData;
  chromaUrl?: string;
  chromaApiKey?: EncryptedData;
  chromaTenant?: string;
  chromaDatabase?: string;
  updatedAt: string;
}

/**
 * Saves or updates credentials for a user. Sensitive fields are encrypted.
 */
export async function saveCredentials(uid: string, creds: UserCredentials): Promise<void> {
  const db = getDb();
  const doc: StoredCredentials = {
    updatedAt: new Date().toISOString(),
  };

  if (creds.openAIApiKey) {
    doc.openAIApiKey = encrypt(creds.openAIApiKey);
  }
  if (creds.chromaApiKey) {
    doc.chromaApiKey = encrypt(creds.chromaApiKey);
  }
  // Non-secret fields stored as-is
  if (creds.chromaUrl) doc.chromaUrl = creds.chromaUrl;
  if (creds.chromaTenant) doc.chromaTenant = creds.chromaTenant;
  if (creds.chromaDatabase) doc.chromaDatabase = creds.chromaDatabase;

  await db.collection(COLLECTION).doc(uid).set(doc, { merge: true });
}

/**
 * Retrieves and decrypts credentials for a user. Returns null if none exist.
 */
export async function getCredentials(uid: string): Promise<UserCredentials | null> {
  const db = getDb();
  const snap = await db.collection(COLLECTION).doc(uid).get();

  if (!snap.exists) return null;

  const data = snap.data() as StoredCredentials;
  const result: UserCredentials = {};

  if (data.openAIApiKey) {
    try {
      result.openAIApiKey = decrypt(data.openAIApiKey);
    } catch {
      console.warn(`[Credentials] Failed to decrypt OpenAI key for user ${uid}`);
    }
  }
  if (data.chromaApiKey) {
    try {
      result.chromaApiKey = decrypt(data.chromaApiKey);
    } catch {
      console.warn(`[Credentials] Failed to decrypt Chroma API key for user ${uid}`);
    }
  }
  if (data.chromaUrl) result.chromaUrl = data.chromaUrl;
  if (data.chromaTenant) result.chromaTenant = data.chromaTenant;
  if (data.chromaDatabase) result.chromaDatabase = data.chromaDatabase;

  return result;
}

/**
 * Deletes all stored credentials for a user.
 */
export async function deleteCredentials(uid: string): Promise<void> {
  const db = getDb();
  await db.collection(COLLECTION).doc(uid).delete();
}
