import { loadDocuments } from '../loaders/loadDocuments.js';
import { splitDocuments } from '../splitters/splitDocuments.js';
import { resetAndIndexCollection } from '../vectorstore/chroma.js';

export interface IndexDocumentsOptions {
  inputPath: string;
  collectionName?: string;
  chunkSize?: number;
  chunkOverlap?: number;
}

export async function indexDocuments(options: IndexDocumentsOptions) {
  const documents = await loadDocuments({ inputPath: options.inputPath });

  if (documents.length === 0) {
    return { documents: [], count: 0 };
  }

  const chunks = await splitDocuments(documents, {
    chunkSize: options.chunkSize ?? 1000,
    chunkOverlap: options.chunkOverlap ?? 150,
  });

  const vectorStore = await resetAndIndexCollection(chunks, {
    collectionName: options.collectionName,
  });

  return {
    documents: chunks,
    count: chunks.length,
    vectorStore,
  };
}
