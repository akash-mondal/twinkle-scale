// OpenAI GPT-5.2 client — Responses API with retry, caching, function calling.
// ALL LLM calls in the app go through callLLM().

import OpenAI from 'openai';
import { createHash } from 'crypto';

let client: OpenAI | null = null;
let modelOverride: string | null = null;

const responseCache = new Map<string, { text: string; parsed: any; usage: any; toolCalls: any[] }>();
let totalInputTokens = 0;
let totalOutputTokens = 0;

export function initClient(apiKey: string, model?: string) {
  client = new OpenAI({ apiKey });
  modelOverride = model || null;
}

export function getUsage() {
  return { inputTokens: totalInputTokens, outputTokens: totalOutputTokens };
}

export function clearCache() {
  responseCache.clear();
}

interface CallLLMOptions {
  instructions: string;
  input: string | Array<{ role: string; content: string }>;
  tools?: any[];
  reasoning?: 'none' | 'low' | 'medium' | 'high';
  jsonSchema?: { name: string; schema: object; strict?: boolean };
  maxToolRounds?: number;
  toolExecutor?: (name: string, args: any) => Promise<string>;
}

interface CallLLMResult {
  text: string;
  parsed: any;
  usage: { inputTokens: number; outputTokens: number };
  toolCalls: Array<{ name: string; args: any; result?: string }>;
}

export async function callLLM(opts: CallLLMOptions): Promise<CallLLMResult> {
  if (!client) throw new Error('OpenAI client not initialized. Call initClient() first.');

  const model = modelOverride || 'gpt-5.2';
  const maxRounds = opts.maxToolRounds ?? 5;

  // Check cache
  const cacheKey = createHash('sha256')
    .update(JSON.stringify({ instructions: opts.instructions, input: opts.input, tools: opts.tools }))
    .digest('hex');

  const cached = responseCache.get(cacheKey);
  if (cached) return cached;

  // Build input
  const input: any[] = typeof opts.input === 'string'
    ? [{ role: 'user', content: opts.input }]
    : opts.input;

  const allToolCalls: Array<{ name: string; args: any; result?: string }> = [];

  // Retry with exponential backoff
  const FALLBACK_MODEL = 'gpt-4.1';
  let lastError: Error | null = null;

  for (const currentModel of [model, FALLBACK_MODEL]) {
    for (let retry = 0; retry < 3; retry++) {
      try {
        // Build request params
        const params: any = {
          model: currentModel,
          instructions: opts.instructions,
          input,
        };

        if (opts.tools?.length) params.tools = opts.tools;
        if (opts.reasoning) params.reasoning = { effort: opts.reasoning };
        if (opts.jsonSchema) {
          params.text = {
            format: {
              type: 'json_schema',
              ...opts.jsonSchema,
            },
          };
        }

        let response = await client.responses.create(params);

        // Agentic tool loop
        let rounds = 0;
        while (rounds < maxRounds) {
          const functionCalls = response.output.filter(
            (item): item is Extract<typeof item, { type: 'function_call' }> =>
              item.type === 'function_call',
          );
          if (functionCalls.length === 0) break;

          // Execute tool calls
          for (const fc of functionCalls) {
            const args = JSON.parse(fc.arguments);
            let result = '{}';

            if (opts.toolExecutor) {
              result = await opts.toolExecutor(fc.name, args);
            } else {
              // No executor — return the args as the result (for structured extraction)
              result = JSON.stringify(args);
            }

            allToolCalls.push({ name: fc.name, args, result });

            input.push({
              type: 'function_call_output' as const,
              call_id: fc.call_id,
              output: result,
            });
          }

          // Continue conversation
          response = await client.responses.create({
            ...params,
            input,
          });
          rounds++;
        }

        // Extract text
        const text = response.output_text || '';
        let parsed: any = null;

        if (opts.jsonSchema) {
          try {
            parsed = JSON.parse(text);
          } catch {
            parsed = null;
          }
        }

        // Track usage
        const usage = {
          inputTokens: response.usage?.input_tokens || 0,
          outputTokens: response.usage?.output_tokens || 0,
        };
        totalInputTokens += usage.inputTokens;
        totalOutputTokens += usage.outputTokens;

        const result: CallLLMResult = { text, parsed, usage, toolCalls: allToolCalls };

        // Cache successful responses
        responseCache.set(cacheKey, result);
        return result;

      } catch (err: any) {
        lastError = err;
        const status = err.status || err.statusCode || 0;

        // Retry on rate limit or server errors
        if (status === 429 || status >= 500) {
          const delay = Math.pow(2, retry) * 1000; // 1s, 2s, 4s
          console.warn(`[openai] ${currentModel} error ${status}, retrying in ${delay}ms...`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }

        // Non-retryable error — try fallback model
        break;
      }
    }

    // If primary model failed, try fallback
    if (currentModel === model && currentModel !== FALLBACK_MODEL) {
      console.warn(`[openai] ${model} failed, trying fallback ${FALLBACK_MODEL}...`);
      continue;
    }
  }

  throw lastError || new Error('All LLM attempts failed');
}
