import { config, logger } from '../../../../utils';
import { listPolicyChatMessages } from './chatStore';
import { SUPPORT_POLICY_SYSTEM_PROMPT } from './prompts';
import { POLICY_TOOL_DEFINITIONS, executePolicyTool } from './tools';

const MAX_TOOL_ROUNDS = 6;
const DEEPSEEK_URL = `${config.DEEPSEEK_API_URL}/v1/chat/completions`;

type ChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
};

type ToolCall = {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
};

export type PolicyAgentResult = {
  reply: string;
};

function parseToolArgs(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw || '{}');
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

async function callDeepSeek(messages: ChatMessage[]): Promise<{
  content: string | null;
  tool_calls?: ToolCall[];
}> {
  if (!config.DEEPSEEK_API_KEY) {
    throw new Error('DEEPSEEK_API_KEY is required');
  }

  const payload = {
    model: 'deepseek-chat',
    messages,
    tools: POLICY_TOOL_DEFINITIONS,
    tool_choice: 'auto' as const,
    temperature: 0.2,
    max_tokens: 800,
  };

  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(DEEPSEEK_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.DEEPSEEK_API_KEY}`,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        if ((response.status >= 500 || response.status === 429) && attempt < 3) {
          await new Promise((r) => setTimeout(r, attempt * 600));
          continue;
        }
        throw new Error(`DeepSeek error ${response.status}: ${errText.slice(0, 400)}`);
      }

      const data = (await response.json()) as {
        choices?: Array<{
          message?: { content?: string | null; tool_calls?: ToolCall[] };
        }>;
      };
      const message = data.choices?.[0]?.message;
      return {
        content: message?.content ?? null,
        tool_calls: message?.tool_calls,
      };
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      const transient =
        msg.includes('fetch failed') ||
        msg.includes('other side closed') ||
        msg.includes('ECONNRESET') ||
        msg.includes('ETIMEDOUT');
      if (!transient || attempt >= 3) break;
      logger.warn({ attempt, err: msg }, 'policy bot DeepSeek retry');
      await new Promise((r) => setTimeout(r, attempt * 600));
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function runSupportPolicyAgent(params: {
  message: string;
  adminUserId: number;
}): Promise<PolicyAgentResult> {
  const history = await listPolicyChatMessages(80);

  const messages: ChatMessage[] = [
    { role: 'system', content: SUPPORT_POLICY_SYSTEM_PROMPT },
    {
      role: 'system',
      content: `لوحة تحكم الإدارة. admin_user_id=${params.adminUserId}.`,
    },
  ];

  for (const h of history) {
    messages.push({ role: h.role, content: h.body });
  }

  const current = params.message.trim() || '[رسالة فارغة]';
  const lastHist = history[history.length - 1];
  const alreadyInHistory = lastHist?.role === 'user' && lastHist.body === current;
  if (!alreadyInHistory) {
    messages.push({ role: 'user', content: current });
  }

  let finalReply = 'حصل خطأ مؤقت. جرّب تاني بعد شوية.';

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const result = await callDeepSeek(messages);
      const toolCalls = result.tool_calls;

      if (toolCalls?.length) {
        messages.push({
          role: 'assistant',
          content: result.content,
          tool_calls: toolCalls,
        });
        for (const call of toolCalls) {
          const args = parseToolArgs(call.function.arguments);
          const toolResult = await executePolicyTool(call.function.name, args, {
            adminUserId: params.adminUserId,
          });
          logger.info({ tool: call.function.name }, 'support_policy dashboard tool executed');
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            name: call.function.name,
            content: JSON.stringify(toolResult),
          });
        }
        continue;
      }

      finalReply = (result.content || '').trim() || finalReply;
      break;
    }
  } catch (err) {
    logger.error({ err }, 'support policy agent failed');
    finalReply = 'معلش، مقدرتش أنفّذ التعديل دلوقتي. جرّب تاني بعد شوية.';
  }

  if (finalReply.length > 3500) {
    finalReply = `${finalReply.slice(0, 3400)}…`;
  }

  return { reply: finalReply };
}
