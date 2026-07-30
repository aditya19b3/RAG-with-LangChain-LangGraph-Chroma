import { OpenAIEmbeddings } from '@langchain/openai';

let _embeddings: OpenAIEmbeddings | null = null;

export function getOpenAIEmbeddings(): OpenAIEmbeddings {
  if (!_embeddings) {
    _embeddings = new OpenAIEmbeddings({
      model: 'text-embedding-3-small',
    });
  }
  return _embeddings;
}

