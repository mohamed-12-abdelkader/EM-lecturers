import { Request, Response, NextFunction } from 'express';
import { parseNumberInput } from '../../../utils/requestParsers';

/**
 * Resolves the teacher scope for center management APIs.
 * Teachers always use their own id; admins may pass teacher_id.
 */
export function resolveTeacherId(req: Request): number {
  const user = req.user!;
  if (user.role === 'admin') {
    const adminTeacherId =
      parseNumberInput(req.query.teacher_id as string | undefined) ??
      parseNumberInput(req.body?.teacher_id) ??
      parseNumberInput(req.body?.teacherId) ??
      parseNumberInput(req.params?.teacherId);
    if (adminTeacherId) return adminTeacherId;
  }
  return user.id;
}

export function attachTeacherId(req: Request, _res: Response, next: NextFunction) {
  (req as Request & { teacherId?: number }).teacherId = resolveTeacherId(req);
  next();
}

export function getTeacherId(req: Request): number {
  return (req as Request & { teacherId?: number }).teacherId ?? resolveTeacherId(req);
}
