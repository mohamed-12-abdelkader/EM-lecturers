import { config } from '../../utils';

export const staffChatConfig = {
  maxImageSizeMb: config.STAFF_CHAT_MAX_IMAGE_SIZE_MB,
  maxMessageLength: config.STAFF_CHAT_MAX_MESSAGE_LENGTH,
  editWindowMinutes: config.STAFF_CHAT_MESSAGE_EDIT_WINDOW_MINUTES,
  messagesPerMinute: config.STAFF_CHAT_RATE_LIMIT_MESSAGES_PER_MINUTE,
  groupName: config.STAFF_CHAT_GROUP_NAME,
  allowedImageMimes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const,
  allowedImageExtensions: ['.jpg', '.jpeg', '.png', '.gif', '.webp'] as const,
};

export function staffChatMaxImageBytes() {
  return staffChatConfig.maxImageSizeMb * 1024 * 1024;
}
