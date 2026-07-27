import { StateGraph, START, END, Annotation } from '@langchain/langgraph';
import { Document } from '@langchain/core/documents';
import { z } from 'zod';
import { getResilientLLM } from '../utils/resilience.js';

// Shared state shape using LangGraph annotations
export const GraphStateAnnotation = Annotation.Root({
  question: Annotation<string>(),
  documents: Annotation<Document[]>({
    reducer: (_, y) => y,
    default: () => [],
  }),
  generation: Annotation<string>(),
  attempts: Annotation<number>({
    reducer: (_, y) => y,
    default: () => 0,
  }),
  retriever: Annotation<any>({
    reducer: (_, y) => y,
    default: () => null,
  }),
});

/**
 * Retrieve node - fetches documents from the dynamically passed retriever.
 */
async function retrieve(state: typeof GraphStateAnnotation.State) {
  const question = state.question;
  const retriever = state.retriever;
  
  if (!retriever) {
    throw new Error('Retriever is not defined in state. Pass an active retriever to graph execution.');
  }

  const documents = await retriever.invoke(question);
  return { documents };
}

// Grader verdict schema for batched grading using raw JSON Schema
const graderSchema = {
  type: 'object',
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          index: { type: 'integer' },
          relevant: { type: 'boolean' },
        },
        required: ['index', 'relevant'],
        additionalProperties: false,
      },
    },
  },
  required: ['verdicts'],
  additionalProperties: false,
} as const;

/**
 * Grader node - grades candidate documents in a single structured batch call.
 */
async function gradeDocuments(state: typeof GraphStateAnnotation.State) {
  if (state.documents.length === 0) {
    return { documents: [] };
  }

  const llm = getResilientLLM('gpt-4o-mini', 0);
  const grader = llm.withStructuredOutput(graderSchema as any, { name: 'grade_batch' });


  const numbered = state.documents
    .map((d, i) => `[${i}] ${d.pageContent.slice(0, 500)}`)
    .join('\n\n');

  try {
    const response = await grader.invoke(
      `For EACH passage, decide if it helps answer the question. ` +
      `Return one verdict per index.\n\n` +
      `Question: ${state.question}\n\nPassages:\n${numbered}`
    );

    const keep = new Set(
      response.verdicts.filter((v: { index: number; relevant: boolean }) => v.relevant).map((v: { index: number; relevant: boolean }) => v.index)
    );
    const filteredDocs = state.documents.filter((_, i) => keep.has(i));
    return { documents: filteredDocs };
  } catch (error) {
    console.error(`Relevance grading failed: ${(error as Error).message}. Keeping all documents.`);
    return { documents: state.documents };
  }
}

/**
 * Query transformer node - rewrites question for better search performance.
 */
async function transformQuery(state: typeof GraphStateAnnotation.State) {
  const llm = getResilientLLM('gpt-4o-mini', 0);
  const res = await llm.invoke(
    `Rewrite this question to be clearer for document search. ` +
    `Return only the rewritten question.\nQuestion: ${state.question}`
  );
  return { question: String(res.content), attempts: state.attempts + 1 };
}

import { reorderDocuments } from '../retrievers/rerank.js';

/**
 * Answer generator node - synthesizes answer grounded strictly in retrieved chunks.
 */
async function generate(state: typeof GraphStateAnnotation.State) {
  const llm = getResilientLLM('gpt-4o-mini', 0.2);

  // Reorder documents placing most relevant at the edges to combat the "Lost in the Middle" problem
  const reorderedDocs = await reorderDocuments(state.documents);

  const context = reorderedDocs
    .map((d, i) => `[${i + 1}] (Source: ${d.metadata.source || 'Unknown'})\n${d.pageContent}`)
    .join('\n\n');

  const res = await llm.invoke(
    `You are a precise assistant. Answer the question using ONLY the context provided below. ` +
    `Cite sources inline like [1], [2]. If the context is insufficient to answer, state that you ` +
    `do not have enough information. Do NOT guess or hallucinate.\n\n` +
    `Context:\n${context}\n\nQuestion: ${state.question}`
  );
  return { generation: String(res.content) };
}


/**
 * Give up node - returns an honest not found fallback when no source context exists.
 */
async function giveUp(state: typeof GraphStateAnnotation.State) {
  return {
    generation:
      "I couldn't find enough information in the knowledge base to answer " +
      "that confidently. Try rephrasing, or contact support.",
  };
}

const MAX_ATTEMPTS = 2;

/**
 * Conditional router edge - decides whether to generate, retry, or give up.
 */
function decideNext(state: typeof GraphStateAnnotation.State): 'generate' | 'transform_query' | 'give_up' {
  if (state.documents.length > 0) {
    return 'generate';
  }
  if (state.attempts < MAX_ATTEMPTS) {
    return 'transform_query';
  }
  return 'give_up';
}

const workflow = new StateGraph(GraphStateAnnotation)
  .addNode('retrieve', retrieve)
  .addNode('grade_documents', gradeDocuments)
  .addNode('transform_query', transformQuery)
  .addNode('generate', generate)
  .addNode('give_up', giveUp)
  .addEdge(START, 'retrieve')
  .addEdge('retrieve', 'grade_documents')
  .addConditionalEdges('grade_documents', decideNext, {
    generate: 'generate',
    transform_query: 'transform_query',
    give_up: 'give_up',
  })
  .addEdge('transform_query', 'retrieve')
  .addEdge('generate', END)
  .addEdge('give_up', END);

export const correctiveRag = workflow.compile();
