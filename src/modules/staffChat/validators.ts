import { z } from 'zod';

export const SendMessageSchema = z.object({
  conversationId: z.coerce.number().int().positive(),
  type: z.enum(['text', 'image']).default('text'),
  content: z.string().max(4000).optional(),
});

export const MarkReadSchema = z.object({
  conversationId: z.coerce.number().int().positive(),
  messageId: z.coerce.number().int().positive(),
});

export const CreateDirectSchema = z.object({
  employee_id: z.coerce.number().int().positive(),
});

export const MessagesQuerySchema = z.object({
  cursor: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(50).optional(),
});

export const EditMessageSchema = z.object({
  content: z.string().min(1).max(4000),
});

export const MemberActionSchema = z.object({
  user_id: z.coerce.number().int().positive(),
});

export const TypingSchema = z.object({
  conversationId: z.coerce.number().int().positive(),
});
