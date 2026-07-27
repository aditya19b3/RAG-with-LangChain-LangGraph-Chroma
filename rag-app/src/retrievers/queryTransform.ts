import { MultiQueryRetriever } from 'langchain/retrievers/multi_query';
import { BaseLanguageModel } from '@langchain/core/language_models/base';
import { Document } from '@langchain/core/documents';

/**
 * Returns a MultiQueryRetriever that wraps a base retriever.
 * The LLM will generate multiple versions of the question to query the base retriever.
 */
export function getQueryRewriterRetriever(
  baseRetriever: any,
  llm: BaseLanguageModel,
  queryCount = 3
): MultiQueryRetriever {
  return MultiQueryRetriever.fromLLM({
    llm,
    retriever: baseRetriever,
    queryCount,
  });
}

/**
 * Performs HyDE (Hypothetical Document Embeddings) search.
 * It first has the LLM generate a hypothetical answer paragraph,
 * and then retrieves documents using that fake answer context.
 */
export async function hydeSearch(
  question: string,
  baseRetriever: any,
  llm: BaseLanguageModel
): Promise<Document[]> {
  const response = await llm.invoke(
    `Write a short, factual paragraph answering this question: ${question}`
  );
  const hypotheticalAnswer = response.content;
  return baseRetriever.invoke(hypotheticalAnswer);
}
