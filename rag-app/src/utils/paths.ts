import path from 'path';
import os from 'os';

// Determine storage directory based on whether we are running in a serverless environment (Vercel) or locally
const getStorageBaseDir = (): string => {
  if (process.env.VERCEL) {
    // Vercel serverless functions have a read-only filesystem except for /tmp
    return os.tmpdir();
  }
  // Locally, use the current working directory of the project
  return path.resolve(process.cwd());
};

const BASE_DIR = getStorageBaseDir();

export const KB_DIR = path.join(BASE_DIR, 'knowledge-base');
export const INDEX_DIR = path.join(BASE_DIR, 'index');
export const CHUNKS_PATH = path.join(INDEX_DIR, 'chunks.json');

// Public folder is static assets, always resolved relative to current working directory
export const PUBLIC_DIR = path.resolve('public');
