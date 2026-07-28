import type { HandlerResult, InboundContext, WhatsAppAutomationHandler } from './types';

/**
 * Automation handler registry.
 * Handlers register via registerWhatsAppHandler (see automations/technicalSupport).
 */
const handlers = new Map<string, WhatsAppAutomationHandler>();

export function registerWhatsAppHandler(handler: WhatsAppAutomationHandler): void {
  handlers.set(handler.key, handler);
}

export function getWhatsAppHandler(key: string): WhatsAppAutomationHandler | undefined {
  return handlers.get(key);
}

export async function dispatchInbound(ctx: InboundContext): Promise<HandlerResult> {
  if (!ctx.service?.key) {
    return { handled: false };
  }
  const handler = handlers.get(ctx.service.key);
  if (!handler) {
    return { handled: false };
  }
  return handler.onInbound(ctx);
}

export function listRegisteredHandlerKeys(): string[] {
  return [...handlers.keys()];
}
