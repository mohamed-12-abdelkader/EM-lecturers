/** In-memory presence: userId → active socket ids (multi-tab / multi-device) */
const userSockets = new Map<number, Set<string>>();

export class StaffChatPresence {
  static addSocket(userId: number, socketId: string) {
    if (!userSockets.has(userId)) userSockets.set(userId, new Set());
    userSockets.get(userId)!.add(socketId);
  }

  static removeSocket(userId: number, socketId: string): boolean {
    const set = userSockets.get(userId);
    if (!set) return true;
    set.delete(socketId);
    if (set.size === 0) {
      userSockets.delete(userId);
      return true;
    }
    return false;
  }

  static isOnline(userId: number) {
    return userSockets.has(userId) && (userSockets.get(userId)?.size ?? 0) > 0;
  }

  static onlineUserIds() {
    return [...userSockets.keys()];
  }
}
