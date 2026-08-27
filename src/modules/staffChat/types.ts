export type StaffConversationType = 'group' | 'direct';
export type StaffMessageType = 'text' | 'image';

export type StaffUser = {
  id: number;
  role: string;
  name?: string;
};

export type StaffConversationRow = {
  id: number;
  type: StaffConversationType;
  name: string | null;
  created_by: number | null;
  direct_admin_id: number | null;
  direct_employee_id: number | null;
  created_at: Date;
  updated_at: Date;
};

export type StaffMessageRow = {
  id: number;
  conversation_id: number;
  sender_id: number;
  type: StaffMessageType;
  content: string | null;
  image_url: string | null;
  edited_at: Date | null;
  deleted_at: Date | null;
  deleted_by: number | null;
  created_at: Date;
  updated_at: Date;
  sender_name?: string;
};

export const STAFF_CHAT_ROOM_PREFIX = 'staff-conversation:';

export function staffChatRoom(conversationId: number) {
  return `${STAFF_CHAT_ROOM_PREFIX}${conversationId}`;
}
