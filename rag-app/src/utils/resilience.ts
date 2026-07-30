import { ChatOpenAI } from '@langchain/openai';

// Pre-configured resilient ChatOpenAI instance
export const getResilientLLM = (modelName = 'gpt-4o-mini', temperature = 0.2, apiKey?: string): ChatOpenAI => {
  return new ChatOpenAI({
    model: modelName,
    temperature,
    timeout: 15_000,     // Stalls after 15s
    maxRetries: 3,       // Auto-retries 429/5xx errors
    openAIApiKey: apiKey || process.env.OPENAI_API_KEY,
  });
};

/**
 * Bounds a promise with a hard timeout limit.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, label = 'operation'): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

const TRANSIENT = /(429|500|502|503|504|ECONNRESET|ETIMEDOUT|timed out|fetch failed)/i;

/**
 * Wraps any function/promise factory in a retry loop with exponential backoff and jitter.
 * Retries only on transient errors (like rate limits, network timeouts, or server errors).
 */
export async function resilient<T>(
  thunk: () => Promise<T> | T,
  options: { retries?: number; timeoutMs?: number; label?: string } = {}
): Promise<T> {
  const retries = options.retries ?? 3;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const label = options.label ?? 'operation';

  let lastErr: any;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await withTimeout(Promise.resolve().then(thunk), timeoutMs, label);
    } catch (err: any) {
      lastErr = err;
      const errMsg = err?.message ?? String(err);

      // Do not retry 4xx errors (client issues, auth, etc.) since they won't succeed
      if (attempt === retries || !TRANSIENT.test(errMsg)) {
        break;
      }

      const backoff = Math.min(Math.pow(2, attempt) * 250, 4000) + Math.random() * 200; // exponential + jitter
      console.warn(
        `[${label}] attempt ${attempt + 1} failed: ${errMsg}; retrying in ${Math.round(backoff)}ms...`
      );
      await new Promise((r) => setTimeout(r, backoff));
    }
  }
  throw lastErr;
}
