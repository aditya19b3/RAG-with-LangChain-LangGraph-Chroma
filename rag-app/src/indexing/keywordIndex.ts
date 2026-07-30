import fs from 'node:fs/promises';
import path from 'node:path';
import { BM25Retriever } from '@langchain/community/retrievers/bm25';
import { Document } from '@langchain/core/documents';

import { CHUNKS_PATH } from '../utils/paths.js';

/**
 * Saves document chunks to disk to persist the keyword index data.
 */
export async function saveChunks(chunks: Document[]): Promise<void> {
  const dir = path.dirname(CHUNKS_PATH);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    CHUNKS_PATH,
    JSON.stringify(
      chunks.map((c) => ({
        pageContent: c.pageContent,
        metadata: c.metadata,
      })),
      null,
      2
    ),
    'utf-8'
  );
  console.log(`Saved ${chunks.length} chunks to keyword index file at: ${CHUNKS_PATH}`);
}

let _bm25: BM25Retriever | null = null;

/**
 * Lazily loads persisted chunks and returns a BM25Retriever instance.
 */
export async function getKeywordRetriever(k = 20): Promise<BM25Retriever> {
  if (!_bm25) {
    try {
      const rawText = await fs.readFile(CHUNKS_PATH, 'utf-8');
      const rawDocs = JSON.parse(rawText) as Array<{ pageContent: string; metadata: any }>;
      
      const docs = rawDocs.map(
        (d) =>
          new Document({
            pageContent: d.pageContent,
            metadata: d.metadata,
          })
      );
      
      _bm25 = BM25Retriever.fromDocuments(docs, { k });
      console.log(`Initialized BM25Retriever with ${docs.length} cached chunks.`);
    } catch (error) {
      console.warn(`Could not load keyword index cache. Building an empty one. Error: ${(error as Error).message}`);
      _bm25 = BM25Retriever.fromDocuments([], { k });
    }
  }
  return _bm25;
}

export function invalidateCache(): void {
  _bm25 = null;
  console.log('[BM25 Index] Invalidated keyword retriever memory cache.');
}
