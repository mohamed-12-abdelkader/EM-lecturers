"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireTeacherPlanFeature = requireTeacherPlanFeature;
const teacherPlanPolicy_1 = require("../services/teacherPlanPolicy");
const utils_1 = require("../utils");
function requireTeacherPlanFeature(feature) {
    return async (req, res, next) => {
        try {
            if (req.user?.role === 'admin') {
                return next();
            }
            if (!req.user?.id) {
                return res.status(401).json({ success: false, message: 'Unauthorized' });
            }
            await (0, teacherPlanPolicy_1.enforcePlanFeature)(req.user.id, feature);
            return next();
        }
        catch (error) {
            if (error instanceof utils_1.HttpError) {
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
