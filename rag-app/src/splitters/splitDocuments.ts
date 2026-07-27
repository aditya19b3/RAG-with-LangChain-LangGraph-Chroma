import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { Document } from '@langchain/core/documents';
import crypto from 'node:crypto';

export interface SplitDocumentsOptions {
  chunkSize?: number;
  chunkOverlap?: number;
}

export async function splitDocuments(
  documents: Document[],
  options: SplitDocumentsOptions = {}
): Promise<Document[]> {
  const chunkSize = options.chunkSize ?? 1000;
  const chunkOverlap = options.chunkOverlap ?? 150;

  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize,
    chunkOverlap,
    separators: ['\n\n', '\n', '. ', ' ', ''], // Coarse to fine natural boundaries
  });

  const chunks = await splitter.splitDocuments(documents);

  return chunks.map((chunk) => {
    // Generate a stable unique ID for each chunk based on source and pageContent
    const source = chunk.metadata.source || 'unknown';
    const contentHash = crypto.createHash('sha256').update(chunk.pageContent).digest('hex');
    const chunkId = `chk_${crypto.createHash('sha256').update(`${source}:${contentHash}`).digest('hex').slice(0, 16)}`;

    return new Document({
      pageContent: chunk.pageContent,
      metadata: {
        ...(chunk.metadata ?? {}),
        chunkSize,
        chunkOverlap,
        chunkId, // Stable ID per chunk for incremental indexing (upserts)
      },
    });
  });
}

