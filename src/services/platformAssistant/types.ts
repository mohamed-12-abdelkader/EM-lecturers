export type PlatformAssistantContext = {
  studentId: number;
  /** Optional course scope from the chat UI */
  courseId?: number | null;
  /** Optional teacher scope (teacher-level scientific chat) */
  teacherId?: number | null;
};

export type PlatformToolResult = {
  ok: boolean;
  data?: unknown;
  error?: string;
};

export type PlatformAgentResult = {
  answer: string;
  toolsUsed: string[];
  retrievedChunks: any[];
};
