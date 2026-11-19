import { logger } from '../../../../utils';
import { registerWhatsAppHandler } from '../registry';
import type { HandlerResult, InboundContext } from '../types';
import { TEACHERS_MANAGEMENT_KEY } from './constants';

export async function onTeachersManagementInbound(
  _ctx: InboundContext,
): Promise<HandlerResult> {
  // Transactional reminders only — no auto-reply.
  return { handled: true };
}

export function registerTeachersManagement(): void {
  registerWhatsAppHandler({
    key: TEACHERS_MANAGEMENT_KEY,
    onInbound: onTeachersManagementInbound,
  });
  logger.info(`Registered WhatsApp handler: ${TEACHERS_MANAGEMENT_KEY}`);
}
