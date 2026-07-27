import 'dotenv/config';
import { evaluate } from 'langsmith/evaluation';
import { ChatOpenAI } from '@langchain/openai';
import { z } from 'zod';
import path from 'node:path';
import { ask } from '../index.js';
import { UserSession } from '../retrievers/secureRetriever.js';

// Setup structured judge LLM
const judgeSchema = z.object({
  score: z.number().describe('Groundedness score between 0.0 (not grounded) and 1.0 (fully grounded).'),
  reason: z.string().describe('Explanation of the grade based on facts in context.'),
});

const getJudgeLLM = () => {
  return new ChatOpenAI({
    model: 'gpt-4o',
    temperature: 0,
  }).withStructuredOutput(judgeSchema, { name: 'grade_answer' });
};

/**
 * Faithfulness evaluator - assesses whether the generated answer
 * is fully supported by the retrieved document context.
 */
async function faithfulness({ run, example }: any) {
  const answer = run.outputs?.answer;
  const docs = run.outputs?.sources ?? [];
  const context = docs.join('\n\n');

  if (!answer) {
    return { key: 'faithfulness', score: 0, comment: 'No answer generated.' };
  }

  if (docs.length === 0) {
    return { key: 'faithfulness', score: 0, comment: 'No source documents retrieved.' };
  }

  try {
    const judge = getJudgeLLM();
    const result = await judge.invoke(
      `Score from 0.0 to 1.0 how fully the ANSWER is supported by the CONTEXT. ` +
        `Provide a brief explanation reasoning about details.\n\n` +
        `CONTEXT:\n${context}\n\nANSWER:\n${answer}`
    );

    return {
      key: 'faithfulness',
      score: result.score,
      comment: result.reason,
    };
  } catch (error) {
    console.error('Judge LLM evaluation failed:', (error as Error).message);
    return {
      key: 'faithfulness',
      score: 0,
      comment: `Evaluation error: ${(error as Error).message}`,
    };
  }
}

/**
 * Executes the LangSmith evaluation runner over the specified dataset.
 */
export async function runEvaluation(datasetName = 'rag-golden-set') {
  const hasLangsmith = process.env.LANGSMITH_API_KEY && process.env.LANGSMITH_API_KEY !== '...';
  if (!hasLangsmith) {
    console.error('\n❌ ERROR: LANGSMITH_API_KEY is not set. LangSmith is required for evaluations.\n');
    process.exit(1);
  }

  console.log(`[Evaluation] Launching LangSmith evaluation on dataset: "${datasetName}"...`);

  const mockUser: UserSession = {
    id: 'eval_runner',
    tenantId: 'company_a',
    roles: ['member'],
  };

  try {
    await evaluate(
      async (input: any) => {
        // Run inputs through the full secure ask function
        const question = input.question || input.input;
        const response = await ask(question, mockUser);
        
        return {
          generation: response.answer,
          documents: response.sources.map((src) => ({ pageContent: '', metadata: { source: src } })),
          answer: response.answer,
          sources: response.sources,
        };
      },
      {
        data: datasetName,
        evaluators: [faithfulness],
        experimentPrefix: 'corrective-rag-ts',
      }
    );
    console.log('[Evaluation] LangSmith evaluation completed successfully!');
  } catch (error) {
    console.error('LangSmith evaluation failed to execute:', (error as Error).message);
  }
}

// CLI trigger
if (process.argv[1] === path.resolve(import.meta.dirname, 'evaluate.js') || process.argv[1].endsWith('evaluate.ts')) {
  const dataset = process.argv[2] || 'rag-golden-set';
  runEvaluation(dataset).then(() => process.exit(0));
}
