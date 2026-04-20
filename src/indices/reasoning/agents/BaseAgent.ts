import Anthropic from '@anthropic-ai/sdk';

import type { AgentContext, AgentRunResult } from '../types';

type TokenPricing = {
  inputPerMillion: number;
  outputPerMillion: number;
};

const DEFAULT_MODEL = 'claude-sonnet-4-6';

const MODEL_PRICING: Array<{ matcher: RegExp; pricing: TokenPricing }> = [
  { matcher: /opus/i, pricing: { inputPerMillion: 15, outputPerMillion: 75 } },
  { matcher: /sonnet/i, pricing: { inputPerMillion: 3, outputPerMillion: 15 } },
];

function resolvePricing(model: string): TokenPricing {
  const match = MODEL_PRICING.find(entry => entry.matcher.test(model));
  return match?.pricing ?? { inputPerMillion: 3, outputPerMillion: 15 };
}

function extractTextResponse(response: Anthropic.Messages.Message): string {
  return response.content
    .filter(block => block.type === 'text')
    .map(block => (block.type === 'text' ? block.text : ''))
    .join('\n')
    .trim();
}

function sanitizeJsonText(text: string): string {
  return text
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();
}

export abstract class BaseAgent<TOutput, TContext extends AgentContext = AgentContext> {
  protected readonly client: Anthropic;
  protected readonly model: string;

  constructor(model: string = (process.env.LLM_REASONING_MODEL ?? DEFAULT_MODEL).trim() || DEFAULT_MODEL) {
    this.client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
    this.model = model;
  }

  abstract systemPrompt(): string;
  abstract userPrompt(context: TContext): string;
  abstract parseResponse(responseText: string, context: TContext): TOutput;

  protected parseJsonRecord(responseText: string): Record<string, unknown> {
    const cleaned = sanitizeJsonText(responseText);
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace === -1 || lastBrace <= firstBrace) {
      throw new Error('No JSON object found in agent response');
    }

    const jsonSlice = cleaned.slice(firstBrace, lastBrace + 1);
    const parsed = JSON.parse(jsonSlice) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Agent response JSON is not an object');
    }
    return parsed as Record<string, unknown>;
  }

  async run(context: TContext): Promise<AgentRunResult<TOutput>> {
    const startedAt = Date.now();
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 1_200,
      system: this.systemPrompt(),
      messages: [
        {
          role: 'user',
          content: this.userPrompt(context),
        },
      ],
    });

    const latencyMs = Date.now() - startedAt;
    const responseText = extractTextResponse(response);
    const output = this.parseResponse(responseText, context);

    const inputTokens = response.usage.input_tokens ?? 0;
    const outputTokens = response.usage.output_tokens ?? 0;
    const tokensUsed = inputTokens + outputTokens;

    const pricing = resolvePricing(this.model);
    const costUsd = (inputTokens / 1_000_000) * pricing.inputPerMillion
      + (outputTokens / 1_000_000) * pricing.outputPerMillion;

    return {
      agentName: this.constructor.name,
      output,
      reasoning: responseText,
      latencyMs,
      tokensUsed,
      costUsd,
    };
  }
}
