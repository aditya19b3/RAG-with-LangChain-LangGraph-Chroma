import { createHistoryAwareRetriever } from 'langchain/chains/history_aware_retriever';
import { createRetrievalChain } from 'langchain/chains/retrieval';
import { createStuffDocumentsChain } from 'langchain/chains/combine_documents';
import { ChatPromptTemplate, MessagesPlaceholder } from '@langchain/core/prompts';
import { ChatOpenAI } from '@langchain/openai';

/**
 * Creates and returns a history-aware conversational RAG chain.
 * Rewrites subsequent queries to be self-contained questions before searching the index.
 */
export async function createConversationalRagChain(baseRetriever: any, llm: ChatOpenAI) {
  // Prompt to rephrase user question in the context of history
  const rephrasePrompt = ChatPromptTemplate.fromMessages([
    new MessagesPlaceholder('chat_history'),
    ['user', '{input}'],
    [
      'user',
      'Given the conversation above, rewrite the last question as a standalone question. ' +
      'Do NOT answer the question. Only output the rewritten question.',
    ],
  ]);

  const historyAwareRetriever = await createHistoryAwareRetriever({
    llm,
    retriever: baseRetriever,
    rephrasePrompt,
  });

  // Final prompt to answer using the retrieved documents and history context
  const answerPrompt = ChatPromptTemplate.fromMessages([
    ['system', "You are a helpful assistant. Answer the question using ONLY the retrieved context. Cite sources.\n\n{context}"],
    new MessagesPlaceholder('chat_history'),
    ['user', '{input}'],
  ]);

  const combineDocsChain = await createStuffDocumentsChain({
    llm,
    prompt: answerPrompt,
  });

  return createRetrievalChain({
    retriever: historyAwareRetriever,
    combineDocsChain,
  });
}
