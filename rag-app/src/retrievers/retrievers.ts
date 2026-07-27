import { BM25Retriever } from '@langchain/community/retrievers/bm25';
import { EnsembleRetriever } from 'langchain/retrievers/ensemble';
import { ParentDocumentRetriever } from 'langchain/retrievers/parent_document';
import { InMemoryStore } from '@langchain/core/stores';
import { Chroma } from '@langchain/community/vectorstores/chroma';
import { Document } from '@langchain/core/documents';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { getOpenAIEmbeddings } from '../embeddings/openai.js';
import { getStore } from '../vectorstore/chroma.js';

export async function getBasicRetriever(k = 4) {
  const store = await getStore();
  return store.asRetriever({ k });
}

export async function getMmrRetriever(k = 4, fetchK = 20, lambda = 0.5) {
  const store = await getStore();
  return store.asRetriever({
    k,
    searchType: 'mmr',
    searchKwargs: { fetchK, lambda },
  });
}

export async function getScopedRetriever(filter: Record<string, any>, k = 4) {
  const store = await getStore();
  return store.asRetriever({ k, filter });
}

export async function getKeywordRetriever(chunks: Document[], k = 6): Promise<BM25Retriever> {
  return BM25Retriever.fromDocuments(chunks, { k });
}

export async function getHybridRetriever(chunks: Document[], k = 4, keywordK = 6): Promise<EnsembleRetriever> {
  const store = await getStore();
  const basic = store.asRetriever({ k });
  const keyword = await getKeywordRetriever(chunks, keywordK);

  return new EnsembleRetriever({
    retrievers: [basic, keyword],
    weights: [0.5, 0.5],
  });
}

export function getParentChildRetriever(collectionName = 'children'): ParentDocumentRetriever {
  const embeddings = getOpenAIEmbeddings();
  const url = process.env.CHROMA_URL ?? 'http://localhost:8000';

  const vectorstore = new Chroma(embeddings, {
    collectionName,
    url,
  });

  return new ParentDocumentRetriever({
    vectorstore,
    byteStore: new InMemoryStore<Uint8Array>(),
    parentSplitter: new RecursiveCharacterTextSplitter({ chunkSize: 2000, chunkOverlap: 0 }),
    childSplitter: new RecursiveCharacterTextSplitter({ chunkSize: 400, chunkOverlap: 50 }),
    childK: 20,
    parentK: 5,
  });
}
