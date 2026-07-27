import 'dotenv/config';
import { promises as fs } from 'fs';
import path from 'path';

import { Document } from '@langchain/core/documents';
import { EnsembleRetriever } from 'langchain/retrievers/ensemble';
import { loadFolder } from './loaders/loadDocuments.js';
import { splitDocuments } from './splitters/splitDocuments.js';
import { resetAndIndexCollection, checkChromaHealth } from './vectorstore/chroma.js';
import { saveChunks, getKeywordRetriever, invalidateCache } from './indexing/keywordIndex.js';
import { getRerankedRetriever } from './retrievers/rerank.js';
import { retrieverForUser, enforceAcl, UserSession } from './retrievers/secureRetriever.js';
import { cachedAnswer, llmLimit } from './utils/cache.js';
import { resilient } from './utils/resilience.js';
import { correctiveRag } from './graph/correctiveRag.js';
import { streamAnswer } from './utils/stream.js';

const KB_DIR = path.resolve('./knowledge-base');

/**
 * Creates mock files in the knowledge-base directory if it is empty,
 * ensuring there is source data for initial local test runs.
 */
async function ensureMockDocsExist() {
  try {
    await fs.mkdir(KB_DIR, { recursive: true });
    const files = await fs.readdir(KB_DIR);

    if (files.length === 0) {
      console.log('[Setup] Creating mock documents in ./knowledge-base...');
      await fs.writeFile(
        path.join(KB_DIR, 'refund-policy.md'),
        `# Return & Refund Policy
Last Updated: July 2026

We offer a 30-day refund window for all yearly plans. If you are not satisfied with your purchase, you can contact customer support within 30 days of the transaction to request a full refund.
For monthly subscriptions, refund requests must be filed within 7 days of payment.
All refunds will be credited back to the original payment method within 5-10 business days.`,
        'utf-8'
      );
      await fs.writeFile(
        path.join(KB_DIR, 'billing-info.txt'),
        `Standard Billing Details:
Yearly subscriptions are billed upfront at $120/year.
Monthly subscriptions are billed on the first day of each billing cycle at $15/month.
For support questions regarding billing errors or account recovery, please email billing@company.com.`,
        'utf-8'
      );
    }
  } catch (error) {
    console.error('Failed to prepare mock documents:', error);
  }
}

/**
 * OFFLINE: Ingest, split, tag, and index documents into Chroma and save BM25 chunks.
 */
export async function index() {
  await ensureMockDocsExist();

  console.log('Loading documents from:', KB_DIR);
  const docs = await loadFolder(KB_DIR);

  if (docs.length === 0) {
    console.log('No documents found to index.');
    return;
  }

  // Inject tenant and ACL tags for production access control demonstration
  const taggedDocs = docs.map(
    (doc) =>
      new Document({
        pageContent: doc.pageContent,
        metadata: {
          ...doc.metadata,
          tenant: 'company_a',
          acl: 'member',
        },
      })
  );

  console.log('Splitting documents into chunks...');
  const chunks = await splitDocuments(taggedDocs, { chunkSize: 1000, chunkOverlap: 150 });

  const collectionName = process.env.CHROMA_COLLECTION ?? 'kb_collection';
  console.log(`Indexing ${chunks.length} chunks into Chroma collection '${collectionName}'...`);
  await resetAndIndexCollection(chunks, { collectionName });

  console.log('Persisting chunks for BM25 keyword index...');
  await saveChunks(chunks);

  // Invalidate the runtime memory cache of BM25 retriever
  invalidateCache();

  console.log('Offline indexing complete!');
}

/**
 * ONLINE: Build the production-grade secure hybrid retriever.
 */
export async function buildProductionRetriever(user: UserSession) {
  // 1. Get user-scoped, tenant/ACL-filtered vector retriever
  const vectorRetriever = await retrieverForUser(user, 20);

  // 2. Get lazy-loaded sparse keyword index retriever
  const keywordRetriever = await getKeywordRetriever(20);

  // 3. Fuse dense and sparse search
  const hybridRetriever = new EnsembleRetriever({
    retrievers: [vectorRetriever, keywordRetriever],
    weights: [0.5, 0.5],
  });

  // 4. Wrap with reranking compressor
  return getRerankedRetriever(hybridRetriever, { topN: 4 });
}

/**
 * ONLINE: Production-hardened entry point to ask questions.
 */
export async function ask(rawQuestion: string, user: UserSession) {
  const question = String(rawQuestion ?? '').trim();
  if (!question || question.length > 2000) {
    throw new Error('Invalid question: must be between 1 and 2000 characters.');
  }

  // Scope caching key per tenant + question
  const cacheScopeKey = `${user.tenantId}:${question}`;

  return cachedAnswer(cacheScopeKey, async () => {
    // Build secure retriever
    const retriever = await buildProductionRetriever(user);

    // Limit concurrency and enforce resilience around the Graph state machine
    const out = await llmLimit(() =>
      resilient(
        () =>
          correctiveRag.invoke(
            { question, retriever },
            {
              tags: ['prod', 'v2'],
              metadata: { userId: user.id, tenant: user.tenantId },
              runName: 'user-question',
              recursionLimit: 8,
            }
          ),
        { label: 'corrective-rag-execution', timeoutMs: 30_000, retries: 2 }
      )
    );

    // Double-gate ACL check on output documents before returning
    const docs = out.documents ?? [];
    const verifiedDocs = enforceAcl(docs, user);

    // Extract unique clean basenames of the source files
    const uniqueSources = Array.from(
      new Set(
        verifiedDocs.map((d) => {
          const srcPath = d.metadata.source || '';
          return srcPath ? path.basename(srcPath) : 'Unknown';
        })
      )
    );

    return {
      answer: out.generation,
      sources: uniqueSources,
    };
  });
}

/**
 * Main execution command controller
 */
async function main() {
  const command = process.argv[2];

  // Helper validation for API Keys
  const hasOpenAIKey = process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== '...';
  if (!hasOpenAIKey) {
    console.warn('\n⚠️  WARNING: OPENAI_API_KEY is not configured in .env. Model calls may fail.\n');
  }

  const mockUser: UserSession = {
    id: 'u_123',
    tenantId: 'company_a',
    roles: ['member'],
  };

  if (command === 'index') {
    const healthy = await checkChromaHealth();
    if (!healthy) {
      console.error('\n❌ ChromaDB is not reachable. Start it with: docker compose up -d\n');
      process.exit(1);
    }
    await index();
  } else {
    // Query flow
    const question = process.argv[2] ?? 'What is the refund window?';
    console.log(`Asking: "${question}" (User: ${mockUser.id}, Tenant: ${mockUser.tenantId})`);

    try {
      // Check if we need to index first (e.g. if chunks file doesn't exist)
      try {
        await fs.access(path.resolve('./index/chunks.json'));
      } catch {
        console.log('Keyword index not found on disk. Initiating fast auto-indexing...');
        await index();
      }

      const response = await ask(question, mockUser);
      console.log('\n======================================');
      console.log('🤖 ANSWER:');
      console.log(response.answer);
      console.log('\n📄 SOURCES:');
      console.log(response.sources);
      console.log('======================================');

      // Demonstration of streaming capability
      console.log('\n--- Demonstration of Token Streaming ---');
      const retriever = await buildProductionRetriever(mockUser);
      process.stdout.write('🤖 STREAMED RESPONSE: ');

      const stream = streamAnswer(correctiveRag, { question, retriever });
      for await (const token of stream) {
        process.stdout.write(token);
      }
      console.log('\n----------------------------------------\n');

    } catch (error) {
      console.error('\n❌ Execution failed:', (error as Error).message);
    }
  }

  // Gracefully close any Redis clients
  process.exit(0);
}

// Execute CLI
if (process.argv[1] === path.resolve(import.meta.dirname, 'index.js') || process.argv[1].endsWith('index.ts') || process.argv[1].endsWith('index.js')) {
  main();
}
