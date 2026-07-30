import { OpenAIEmbeddings } from '@langchain/openai';

let _embeddings: OpenAIEmbeddings | null = null;

export function getOpenAIEmbeddings(apiKey?: string): OpenAIEmbeddings {
  if (apiKey) {
    return new OpenAIEmbeddings({
      model: 'text-embedding-3-small',
      openAIApiKey: apiKey,
    });
  }

  if (!_embeddings) {
    _embeddings = new OpenAIEmbeddings({
      model: 'text-embedding-3-small',
    });
  }
  return _embeddings;
}

