import { Chroma } from '@langchain/community/vectorstores/chroma';
import { Document } from '@langchain/core/documents';
import { ChromaClient, CloudClient } from 'chromadb';
import { getOpenAIEmbeddings } from '../embeddings/openai.js';

export interface ChromaStoreOptions {
  collectionName?: string;
  url?: string;
  apiKey?: string;
  tenant?: string;
  database?: string;
  openAIApiKey?: string;
}

export interface CollectionStats {
  exists: boolean;
  count: number;
  collectionName: string;
}

type ChromaDbClient = ChromaClient | CloudClient;

function getCollectionName(options: ChromaStoreOptions = {}): string {
  return options.collectionName ?? process.env.CHROMA_COLLECTION ?? 'kb_collection';
}

function getChromaUrl(options: ChromaStoreOptions = {}): string {
  return options.url ?? process.env.CHROMA_URL ?? 'http://localhost:8000';
}

/**
 * Returns a CloudClient when CHROMA_API_KEY is configured, otherwise a local ChromaClient.
 */
export function getRawChromaClient(options: ChromaStoreOptions = {}): ChromaDbClient {
  const apiKey = options.apiKey || process.env.CHROMA_API_KEY;
  const tenant = options.tenant || process.env.CHROMA_TENANT;
  const database = options.database || process.env.CHROMA_DATABASE;

  if (apiKey && apiKey !== '...') {
    console.log(`[Chroma] Connecting to Chroma Cloud (Tenant: ${tenant}, DB: ${database})...`);
    return new CloudClient({
      apiKey,
      tenant: tenant || undefined,
      database: database || undefined,
      cloudPort: '443',
    });
  }

  const url = getChromaUrl(options);
  console.log(`[Chroma] Connecting to Chroma server at ${url}...`);
  return new ChromaClient({ path: url });
}

function getLangChainStoreOptions(options: ChromaStoreOptions = {}) {
  const collectionName = getCollectionName(options);
  const url = getChromaUrl(options);
  const apiKey = options.apiKey || process.env.CHROMA_API_KEY;
  const tenant = options.tenant || process.env.CHROMA_TENANT;
  const database = options.database || process.env.CHROMA_DATABASE;

  if (apiKey && apiKey !== '...') {
    const client = new CloudClient({
      apiKey,
      tenant: tenant || undefined,
      database: database || undefined,
      cloudPort: '443',
    });
    return { collectionName, index: client, collectionMetadata: { 'hnsw:space': 'cosine' } };
  }

  return { collectionName, url, collectionMetadata: { 'hnsw:space': 'cosine' } };
}

export function sanitizeMetadata(metadata: Record<string, any>): Record<string, string | number | boolean> {
  const clean: Record<string, string | number | boolean> = {};
  for (const [key, val] of Object.entries(metadata)) {
    if (val === null || val === undefined) continue;
    const type = typeof val;
    if (type === 'string' || type === 'number' || type === 'boolean') {
      clean[key] = val;
    } else if (Array.isArray(val)) {
      clean[key] = val.join(', ');
    } else {
      clean[key] = JSON.stringify(val);
    }
  }
  return clean;
}

export async function createChromaVectorStore(
  documents: Document[],
  options: ChromaStoreOptions = {}
): Promise<Chroma> {
  const embeddings = getOpenAIEmbeddings(options.openAIApiKey);
  const storeOptions = getLangChainStoreOptions(options);
  const sanitized = documents.map(d => new Document({ pageContent: d.pageContent, metadata: sanitizeMetadata(d.metadata) }));
  const vectorStore = await Chroma.fromDocuments(sanitized, embeddings, storeOptions as any);
  return vectorStore;
}

export async function getStore(options: ChromaStoreOptions = {}): Promise<Chroma> {
  const embeddings = getOpenAIEmbeddings(options.openAIApiKey);
  const storeOptions = getLangChainStoreOptions(options);
  return Chroma.fromExistingCollection(embeddings, storeOptions as any);
}

/**
 * Deletes the existing collection and re-indexes all chunks.
 * Ensures ChromaDB GUI shows a clean, up-to-date collection after each sync.
 */
export async function resetAndIndexCollection(
  documents: Document[],
  options: ChromaStoreOptions = {}
): Promise<Chroma> {
  const collectionName = getCollectionName(options);
  const client = getRawChromaClient(options);

  try {
    await client.deleteCollection({ name: collectionName });
    console.log(`[Chroma] Deleted existing collection '${collectionName}'.`);
  } catch {
    console.log(`[Chroma] Collection '${collectionName}' did not exist yet. Creating fresh.`);
  }

  const store = await createChromaVectorStore(documents, options);
  console.log(`[Chroma] Indexed ${documents.length} chunks into '${collectionName}'.`);
  return store;
}

export async function getCollectionStats(options: ChromaStoreOptions = {}): Promise<CollectionStats> {
  const collectionName = getCollectionName(options);

  try {
    const client = getRawChromaClient(options);
    const collections = await client.listCollections();
    const exists = collections.some((c: any) => {
      if (typeof c === 'string') return c === collectionName;
      if (c && typeof c === 'object' && 'name' in c) return c.name === collectionName;
      return false;
    });
    if (!exists) {
      return { exists: false, count: 0, collectionName };
    }

    const collection = await client.getCollection({ name: collectionName } as any);
    const count = await collection.count();
    return { exists: true, count, collectionName };
  } catch (error: any) {
    console.error(`[Chroma Stats] Failed to get stats for '${collectionName}':`, error.message);
    return { exists: false, count: 0, collectionName };
  }
}

export async function checkChromaHealth(options: ChromaStoreOptions = {}): Promise<boolean> {
  try {
    const client = getRawChromaClient(options);
    await client.heartbeat();
    return true;
  } catch {
    return false;
  }
}

/**
 * Only re-embeds and uploads chunks whose content has changed.
 */
export async function upsertChanged(
  chunks: Document[],
  options: ChromaStoreOptions = {}
): Promise<void> {
  const store = await getStore(options);

  for (const chunk of chunks) {
    const id = chunk.metadata.chunkId;
    if (!id) {
      console.warn('[Chroma Upsert] stable chunkId missing in metadata. Skipping incremental upsert.');
      continue;
    }

    try {
      await store.delete({ ids: [id] });
    } catch {
      // Ignore if the ID does not exist yet
    }

    const sanitizedChunk = new Document({
      pageContent: chunk.pageContent,
      metadata: sanitizeMetadata(chunk.metadata),
    });
    await store.addDocuments([sanitizedChunk], { ids: [id] });
  }

  console.log(`[Chroma Upsert] Incremental update complete for ${chunks.length} chunks.`);
}
