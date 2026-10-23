import { registerWhatsAppHandler } from '../registry';
import type { HandlerResult, InboundContext } from '../types';
import { PARENTS_EXAM_NOTIFY_KEY } from './constants';

export async function onParentsExamInbound(_ctx: InboundContext): Promise<HandlerResult> {
  return { handled: true };
}

export function registerParentsExamNotify(): void {
  registerWhatsAppHandler({
    key: PARENTS_EXAM_NOTIFY_KEY,
    onInbound: onParentsExamInbound,
  });
}
