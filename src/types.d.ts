// eslint-disable-next-line @typescript-eslint/no-unused-vars
import * as express from 'express';
import { User } from './db/types';
import type { ResolvedTenant } from './middleware/tenantContext';

interface CompletedUser extends User {
  avatar?: string;
  tenant_id?: number | null;
}

export interface Meeting {
  id: string; // UUID (also works as LiveKit room name)
  course_id: number;
  room_sid?: string | null;
  egress_url?: string | null;
  title: string;
  allow_chat: boolean;
  status: 'idle' | 'started' | 'ended';
  created_by: number;
  created_at: Date;
  updated_at: Date;
}

declare global {
  namespace Express {
    interface Request {
      user?: CompletedUser;
      meeting?: Meeting;
      tenant?: ResolvedTenant;
      /** Raw JSON body buffer for HMAC webhook verification */
      rawBody?: Buffer;
    }
  }
}
