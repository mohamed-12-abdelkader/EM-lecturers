import { HttpError } from '../../../../utils';
import { runSupportPolicyAgent } from './agent';
import { appendPolicyChatMessage, listPolicyChatMessages } from './chatStore';
import { loadPolicyPack, summarizePack } from './pack';

export class SupportPolicyChatService {
  static async getPack() {
    return summarizePack(await loadPolicyPack());
  }

  static async listMessages() {
    return listPolicyChatMessages(80);
  }

  static async chat(adminUserId: number, message: string) {
    const body = String(message || '').trim();
    if (!body) throw new HttpError(400, 'اكتب رسالة');
    if (body.length > 4000) throw new HttpError(400, 'الرسالة طويلة جداً');

    await appendPolicyChatMessage({
      role: 'user',
      body,
      adminUserId,
    });

    const result = await runSupportPolicyAgent({ message: body, adminUserId });

    await appendPolicyChatMessage({
      role: 'assistant',
      body: result.reply,
      adminUserId,
    });

    return {
      reply: result.reply,
      pack: summarizePack(await loadPolicyPack()),
    };
  }
}
