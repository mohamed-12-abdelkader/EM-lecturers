import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { SendMessageSchema, MarkReadSchema } from '../validators';

describe('staffChat validators', () => {
  it('validates send message payload', () => {
    const r = SendMessageSchema.safeParse({ conversationId: 1, type: 'text', content: 'hello' });
    expect(r.success).toBe(true);
  });

  it('rejects invalid conversation id', () => {
    const r = SendMessageSchema.safeParse({ conversationId: -1, type: 'text', content: 'x' });
    expect(r.success).toBe(false);
  });

  it('validates mark read payload', () => {
    const r = MarkReadSchema.safeParse({ conversationId: 2, messageId: 10 });
    expect(r.success).toBe(true);
  });
});

describe('staffChat message length', () => {
  it('respects max length in schema', () => {
    const long = 'a'.repeat(4001);
    const r = SendMessageSchema.safeParse({ conversationId: 1, content: long });
    expect(r.success).toBe(false);
  });
});
