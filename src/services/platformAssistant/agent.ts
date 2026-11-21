import { config, logger } from '../../utils';
import { PLATFORM_ASSISTANT_SYSTEM_PROMPT } from './prompts';
import { PLATFORM_TOOL_DEFINITIONS, executePlatformTool } from './tools';
import type { PlatformAgentResult, PlatformAssistantContext } from './types';
import pool from '../../db/pool';

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
    tools: PLATFORM_TOOL_DEFINITIONS,
    tool_choice: 'auto' as const,
    temperature: 0.35,
    max_tokens: 1200,
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
          message?: {
            content?: string | null;
            tool_calls?: ToolCall[];
          };
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
        msg.includes('ECONNRESET') ||
        msg.includes('ETIMEDOUT') ||
        msg.includes('other side closed');
      if (!transient || attempt >= 3) break;
      logger.warn({ attempt, err: msg }, 'Platform assistant DeepSeek call failed; retrying');
      await new Promise((r) => setTimeout(r, attempt * 600));
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function loadRecentHistory(
  studentId: number,
  courseId: number | null | undefined,
  teacherId: number | null | undefined,
  limit = 6,
): Promise<Array<{ role: 'user' | 'assistant'; content: string }>> {
  const params: unknown[] = [studentId];
  let where = `student_id = $1`;
  if (courseId) {
    params.push(courseId);
    where += ` AND course_id = $${params.length}`;
  } else if (teacherId) {
    params.push(teacherId);
    where += ` AND teacher_id = $${params.length} AND course_id IS NULL`;
  }
  params.push(limit);
  const res = await pool.query(
    `SELECT question, answer
     FROM scientific_chat_history
     WHERE ${where}
     ORDER BY created_at DESC
     LIMIT $${params.length}`,
    params,
  );
  const rows = [...res.rows].reverse();
  const out: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  for (const row of rows) {
    if (row.question) out.push({ role: 'user', content: String(row.question) });
    if (row.answer) out.push({ role: 'assistant', content: String(row.answer) });
  }
  return out;
}

export async function runPlatformAssistant(opts: {
  ctx: PlatformAssistantContext;
  question: string;
}): Promise<PlatformAgentResult> {
  const { ctx, question } = opts;
  const toolsUsed: string[] = [];
  let retrievedChunks: any[] = [];

  const history = await loadRecentHistory(ctx.studentId, ctx.courseId, ctx.teacherId, 6);

  const messages: ChatMessage[] = [
    { role: 'system', content: PLATFORM_ASSISTANT_SYSTEM_PROMPT },
    {
      role: 'system',
      content: `سياق الجلسة: student_id=${ctx.studentId}; course_id=${ctx.courseId ?? 'null'}; teacher_id=${ctx.teacherId ?? 'null'}. الطالب الحالي فقط هو المسموح.`,
    },
  ];

  for (const h of history) {
    messages.push({ role: h.role, content: h.content });
  }
  messages.push({ role: 'user', content: question });

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const result = await callDeepSeek(messages);

    if (result.tool_calls?.length) {
      messages.push({
        role: 'assistant',
        content: result.content,
        tool_calls: result.tool_calls,
      });

      for (const call of result.tool_calls) {
        const toolName = call.function?.name || 'unknown';
        const args = parseToolArgs(call.function?.arguments || '{}');
        toolsUsed.push(toolName);
        const toolResult = await executePlatformTool(toolName, args, ctx);

        if (toolName === 'search_study_content' && toolResult.ok) {
          const chunks = (toolResult.data as any)?.chunks;
          if (Array.isArray(chunks)) {
            retrievedChunks = chunks.map((c: any) => ({
              chunk_text: c.text,
              chunk_index: c.index,
            }));
          }
        }

        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          name: toolName,
          content: JSON.stringify(toolResult).slice(0, 12000),
        });
      }
      continue;
    }

    const answer =
      (result.content || '').trim() ||
      'معلش، مقدرتش أجهّز رد دلوقتي. جرّب تسأل تاني بصيغة أوضح.';
    return { answer, toolsUsed, retrievedChunks };
  }

  return {
    answer:
      'وصلت لحد أقصى من خطوات البحث. وضّحلي الكورس أو الامتحان المقصود وأكمل معاك.',
    toolsUsed,
    retrievedChunks,
  };
}
