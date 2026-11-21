import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface StructuredRequest<S extends z.ZodTypeAny> {
  system: string;
  messages: ChatTurn[];
  toolName: string;
  toolDescription: string;
  schema: S;
  maxTokens?: number;
}

/**
 * Abstraksi model bahasa. Mode "mock" dipakai saat ANTHROPIC_API_KEY tidak
 * diset (dev offline & test): setiap agent lalu memakai logika skrip miliknya.
 */
export interface LLM {
  readonly mode: 'anthropic' | 'mock';
  structured<S extends z.ZodTypeAny>(req: StructuredRequest<S>): Promise<z.infer<S>>;
}

export class MockLLM implements LLM {
  readonly mode = 'mock' as const;
  structured<S extends z.ZodTypeAny>(): Promise<z.infer<S>> {
    return Promise.reject(new Error('MockLLM tidak memanggil model; agent harus memakai jalur mock'));
  }
}

export class AnthropicLLM implements LLM {
  readonly mode = 'anthropic' as const;
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    private readonly model: string,
  ) {
    this.client = new Anthropic({ apiKey });
  }

  async structured<S extends z.ZodTypeAny>(req: StructuredRequest<S>): Promise<z.infer<S>> {
    const inputSchema = z.toJSONSchema(req.schema) as Anthropic.Tool['input_schema'];
    const messages: Anthropic.MessageParam[] = mergeTurns(req.messages);
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await this.client.messages.create({
        model: this.model,
        max_tokens: req.maxTokens ?? 4096,
        system: req.system,
        messages,
        tools: [{ name: req.toolName, description: req.toolDescription, input_schema: inputSchema }],
        tool_choice: { type: 'tool', name: req.toolName },
      });
      const block = res.content.find((b) => b.type === 'tool_use');
      if (!block || block.type !== 'tool_use') {
        lastError = new Error('Model tidak mengembalikan tool_use');
        continue;
      }
      const parsed = req.schema.safeParse(block.input);
      if (parsed.success) return parsed.data;
      lastError = parsed.error;
    }
    throw lastError instanceof Error ? lastError : new Error('Output model tidak valid');
  }
}

/** API Anthropic mewajibkan giliran user/assistant bergantian dan diawali user. */
function mergeTurns(turns: ChatTurn[]): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = [];
  for (const t of turns) {
    const last = out[out.length - 1];
    if (last && last.role === t.role) last.content = `${last.content as string}\n\n${t.content}`;
    else out.push({ role: t.role, content: t.content });
  }
  if (out[0]?.role !== 'user') out.unshift({ role: 'user', content: '(mulai percakapan)' });
  return out;
}

export function createLLM(apiKey: string | null, model: string): LLM {
  return apiKey ? new AnthropicLLM(apiKey, model) : new MockLLM();
}
