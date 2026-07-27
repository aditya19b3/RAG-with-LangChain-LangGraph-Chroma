import { ContextualCompressionRetriever } from 'langchain/retrievers/contextual_compression';
import { CohereRerank } from '@langchain/cohere';
import { Document } from '@langchain/core/documents';

interface RerankOptions {
  apiKey?: string;
  model?: string;
  topN?: number;
}

/**
 * Wraps a base retriever with a Cohere Reranker compressor.
 * Retrieves a wider set of documents first, then scores and filters them.
 */
export function getRerankedRetriever(
  baseRetriever: any,
  options: RerankOptions = {}
): any {
  const apiKey = options.apiKey ?? process.env.COHERE_API_KEY;
  const model = options.model ?? 'rerank-v3.5';
  const topN = options.topN ?? 4;

  if (!apiKey || apiKey === '...' || apiKey.startsWith('COHERE_API_KEY') || apiKey === '') {
    console.warn('[Reranker] Cohere API Key is missing or a placeholder. Bypassing reranker.');
    return baseRetriever;
  }

  const reranker = new CohereRerank({
    apiKey,
    model,
    topN,
  });

  return new ContextualCompressionRetriever({
    baseCompressor: reranker,
    baseRetriever,
  });
}


/**
 * Reorders retrieved documents to place the most relevant documents at the edges
 * (start & end of prompt) and the weakest in the middle, mitigating the "Lost in the Middle" problem.
 */
export async function reorderDocuments(docs: Document[]): Promise<Document[]> {
  if (docs.length <= 2) {
    return docs;
  }
  
  const sorted = [...docs];
  const reordered: Document[] = new Array(docs.length);
  let left = 0;
  let right = docs.length - 1;

  for (let i = 0; i < sorted.length; i++) {
    if (i % 2 === 0) {
      reordered[left] = sorted[i];
      left++;
    } else {
      reordered[right] = sorted[i];
      right--;
    }
  }

  return reordered;
}
