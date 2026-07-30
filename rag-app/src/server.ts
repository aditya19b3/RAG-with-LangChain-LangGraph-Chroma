import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import { promises as fs } from 'fs';
import { index, ask } from './index.js';
import { UserSession } from './retrievers/secureRetriever.js';
import { checkChromaHealth, getCollectionStats, ChromaStoreOptions } from './vectorstore/chroma.js';
import { isLoadableExtension } from './loaders/loadDocuments.js';
import { requireAuth } from './middleware/auth.js';
import {
  saveCredentials as dbSaveCredentials,
  getCredentials as dbGetCredentials,
  deleteCredentials as dbDeleteCredentials,
} from './db/credentials.js';

const app = express();
const PORT = process.env.PORT || 3000;

import { KB_DIR, PUBLIC_DIR } from './utils/paths.js';

app.use(cors());
app.use(express.json());
app.use(express.static(PUBLIC_DIR));

await fs.mkdir(KB_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, KB_DIR);
  },
  filename: (_req, file, cb) => {
    const sanitized = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_');
    cb(null, sanitized);
  },
});

const upload = multer({
  storage,
  fileFilter: (_req, file, cb) => {
    if (!isLoadableExtension(file.originalname)) {
      return cb(
        new Error(
          'Unsupported file type. Binary or media files cannot be indexed. Upload text-based documents (PDF, DOCX, TXT, MD, CSV, JSON, code files, etc.).'
        )
      );
    }
    cb(null, true);
  },
  limits: {
    fileSize: 15 * 1024 * 1024,
  },
});

/**
 * Builds ChromaStoreOptions from request headers (BYOK), then falls back to
 * Firestore-persisted credentials for the authenticated user, then env vars.
 */
async function getCredentials(req: express.Request): Promise<ChromaStoreOptions> {
  // 1. Check request headers (direct BYOK from frontend)
  const headerKey = req.headers['x-openai-api-key'] as string | undefined;
  const headerUrl = req.headers['x-chroma-url'] as string | undefined;

  if (headerKey || headerUrl) {
    return {
      openAIApiKey: headerKey || undefined,
      url: headerUrl || undefined,
      apiKey: (req.headers['x-chroma-api-key'] as string) || undefined,
      tenant: (req.headers['x-chroma-tenant'] as string) || undefined,
      database: (req.headers['x-chroma-database'] as string) || undefined,
    };
  }

  // 2. Fall back to Firestore-persisted credentials for the authenticated user
  if (req.user?.uid) {
    try {
      const saved = await dbGetCredentials(req.user.uid);
      if (saved) {
        return {
          openAIApiKey: saved.openAIApiKey || undefined,
          url: saved.chromaUrl || undefined,
          apiKey: saved.chromaApiKey || undefined,
          tenant: saved.chromaTenant || undefined,
          database: saved.chromaDatabase || undefined,
        };
      }
    } catch (err) {
      console.warn('[Server] Could not load credentials from Firestore:', (err as Error).message);
    }
  }

  // 3. Fall back to environment variables (handled by downstream functions)
  return {};
}

async function runIndexing(options: ChromaStoreOptions = {}): Promise<{ chunkCount: number; collectionName: string }> {
  await index(options);
  const stats = await getCollectionStats(options);
  return { chunkCount: stats.count, collectionName: stats.collectionName };
}

// ========================
//  Credential CRUD Routes
// ========================

app.get('/api/credentials', requireAuth, async (req, res) => {
  try {
    const creds = await dbGetCredentials(req.user!.uid);
    if (!creds) {
      return res.json({ success: true, credentials: null });
    }
    // Mask sensitive keys for frontend display
    res.json({
      success: true,
      credentials: {
        openAIApiKey: creds.openAIApiKey ? '••••' + creds.openAIApiKey.slice(-4) : null,
        openAIApiKeySet: !!creds.openAIApiKey,
        chromaUrl: creds.chromaUrl || null,
        chromaApiKey: creds.chromaApiKey ? '••••' + creds.chromaApiKey.slice(-4) : null,
        chromaApiKeySet: !!creds.chromaApiKey,
        chromaTenant: creds.chromaTenant || null,
        chromaDatabase: creds.chromaDatabase || null,
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/credentials', requireAuth, async (req, res) => {
  try {
    const { openAIApiKey, chromaUrl, chromaApiKey, chromaTenant, chromaDatabase } = req.body;
    await dbSaveCredentials(req.user!.uid, {
      openAIApiKey,
      chromaUrl,
      chromaApiKey,
      chromaTenant,
      chromaDatabase,
    });
    res.json({ success: true, message: 'Credentials saved securely.' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.delete('/api/credentials', requireAuth, async (req, res) => {
  try {
    await dbDeleteCredentials(req.user!.uid);
    res.json({ success: true, message: 'Credentials deleted.' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ========================
//  Protected API Routes
// ========================

/**
 * GET /api/chroma/status
 * ChromaDB health and collection stats.
 */
app.get('/api/chroma/status', requireAuth, async (req, res) => {
  try {
    const credentials = await getCredentials(req);
    const healthy = await checkChromaHealth(credentials);
    const stats = healthy ? await getCollectionStats(credentials) : { exists: false, count: 0, collectionName: 'kb_collection' };

    res.json({
      success: true,
      healthy,
      url: credentials.url ?? process.env.CHROMA_URL ?? 'http://localhost:8000',
      collection: stats,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/documents', requireAuth, async (_req, res) => {
  try {
    const files = await fs.readdir(KB_DIR);
    const documents = await Promise.all(
      files.map(async (filename) => {
        const filePath = path.join(KB_DIR, filename);
        const stats = await fs.stat(filePath);
        if (!stats.isFile()) return null;
        return {
          name: filename,
          size: stats.size,
          lastModified: stats.mtime,
        };
      })
    );
    res.json({ success: true, documents: documents.filter(Boolean) });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/documents', requireAuth, (req, res) => {
  upload.single('file')(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ success: false, error: err.message });
    }
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded.' });
    }

    try {
      const credentials = await getCredentials(req);
      const healthy = await checkChromaHealth(credentials);
      if (!healthy) {
        return res.status(503).json({
          success: false,
          error: 'ChromaDB is not running. Start it with: docker compose up -d',
        });
      }

      console.log(`[API Server] File uploaded: ${req.file.filename}. Syncing to ChromaDB...`);
      const { chunkCount, collectionName } = await runIndexing(credentials);

      res.json({
        success: true,
        message: `File '${req.file.filename}' uploaded and indexed into ChromaDB (${chunkCount} chunks in '${collectionName}').`,
        file: {
          name: req.file.filename,
          size: req.file.size,
        },
        chroma: { chunkCount, collectionName },
      });
    } catch (error: any) {
      console.error('[API Server] Upload indexing failed:', error);
      res.status(500).json({
        success: false,
        error: `File saved but indexing failed: ${error.message}`,
      });
    }
  });
});

app.delete('/api/documents/:filename', requireAuth, async (req, res) => {
  const filename = req.params.filename as string;
  try {
    const filePath = path.join(KB_DIR, filename);
    const resolvedPath = path.resolve(filePath);
    if (!resolvedPath.startsWith(KB_DIR)) {
      return res.status(400).json({ success: false, error: 'Access denied.' });
    }

    await fs.unlink(resolvedPath);

    const credentials = await getCredentials(req);
    const healthy = await checkChromaHealth(credentials);
    if (healthy) {
      console.log(`[API Server] Document deleted: ${filename}. Re-syncing ChromaDB...`);
      const { chunkCount, collectionName } = await runIndexing(credentials);
      res.json({
        success: true,
        message: `Document '${filename}' deleted and ChromaDB updated (${chunkCount} chunks remaining).`,
        chroma: { chunkCount, collectionName },
      });
    } else {
      res.json({
        success: true,
        message: `Document '${filename}' deleted. Start ChromaDB and click Sync DB to update embeddings.`,
      });
    }
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      res.status(404).json({ success: false, error: 'File not found.' });
    } else {
      res.status(500).json({ success: false, error: error.message });
    }
  }
});

app.post('/api/index', requireAuth, async (req, res) => {
  try {
    const credentials = await getCredentials(req);
    const healthy = await checkChromaHealth(credentials);
    if (!healthy) {
      return res.status(503).json({
        success: false,
        error: 'ChromaDB is not running. Start it with: docker compose up -d',
      });
    }

    console.log('[API Server] Triggering manual knowledge base re-indexing...');
    const { chunkCount, collectionName } = await runIndexing(credentials);
    res.json({
      success: true,
      message: `Knowledge base synced to ChromaDB (${chunkCount} chunks in '${collectionName}').`,
      chroma: { chunkCount, collectionName },
    });
  } catch (error: any) {
    console.error('[API Server] Re-indexing failed:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/query', requireAuth, async (req, res) => {
  const { question, tenantId, role } = req.body;

  if (!question || typeof question !== 'string') {
    return res.status(400).json({ success: false, error: 'Question is required and must be a string.' });
  }

  const user: UserSession = {
    id: req.user?.uid ?? 'web_user',
    tenantId: tenantId || 'company_a',
    roles: role === 'admin' ? ['admin', 'member'] : role ? [role] : ['member'],
  };

  try {
    const credentials = await getCredentials(req);
    const healthy = await checkChromaHealth(credentials);
    if (!healthy) {
      return res.status(503).json({
        success: false,
        error: 'ChromaDB is not running. Start it with: docker compose up -d',
      });
    }

    const stats = await getCollectionStats(credentials);
    if (!stats.exists || stats.count === 0) {
      return res.status(400).json({
        success: false,
        error: 'No documents indexed yet. Upload files from the sidebar to build your knowledge base.',
      });
    }

    console.log(`[API Server] Processing query: "${question}" for tenant "${user.tenantId}" (Role: ${user.roles[0]})`);
    const response = await ask(question, user, credentials);
    res.json({
      success: true,
      answer: response.answer,
      sources: response.sources,
    });
  } catch (error: any) {
    console.error('[API Server] Query failed:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('*splat', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

if (!process.env.VERCEL) {
  app.listen(PORT, async () => {
    console.log(`\n🚀 RAG API Server listening at http://localhost:${PORT}`);
    console.log(`📂 Knowledge Base directory: ${KB_DIR}`);
    console.log(`🌐 Static Frontend directory: ${PUBLIC_DIR}`);
    console.log(`🗄️  ChromaDB URL: ${process.env.CHROMA_URL ?? 'http://localhost:8000'}`);

    const healthy = await checkChromaHealth();
    if (!healthy) {
      console.warn('\n⚠️  ChromaDB is not reachable. Start it with: docker compose up -d\n');
      return;
    }

    const stats = await getCollectionStats();
    console.log(`✅ ChromaDB connected — collection '${stats.collectionName}' (${stats.count} chunks)\n`);

    if (!stats.exists || stats.count === 0) {
      console.log('[API Server] Chroma collection is empty. Running initial index from knowledge-base...');
      try {
        const result = await runIndexing();
        console.log(`[API Server] Initial index complete: ${result.chunkCount} chunks in '${result.collectionName}'.\n`);
      } catch (error) {
        console.error('[API Server] Initial indexing failed:', (error as Error).message);
      }
    }
  });
}

export default app;
