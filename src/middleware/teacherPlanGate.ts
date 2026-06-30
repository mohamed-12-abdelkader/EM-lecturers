import type { NextFunction, Request, Response } from 'express';
import {
  enforcePlanFeature,
  type PlanFeature,
} from '../services/teacherPlanPolicy';
import { HttpError } from '../utils';

export function requireTeacherPlanFeature(feature: PlanFeature) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (req.user?.role === 'admin') {
        return next();
      }
      if (!req.user?.id) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }
      await enforcePlanFeature(req.user.id, feature);
      return next();
    } catch (error) {
      if (error instanceof HttpError) {
        return res.status(error.status).json({
          success: false,
          message: error.message,
          ...(error.details ?? {}),
        });
      }
      return next(error);
    }
  };
}
