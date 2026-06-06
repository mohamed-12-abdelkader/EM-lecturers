"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validate = validate;
const v4_1 = require("zod/v4");
function validate(schema) {
    return async (req, res, next) => {
        if (!schema)
            return next();
        const result = schema.safeParse(req.body);
        if (!result.success) {
            return res.status(400).json({
                message: 'Validation failed',
                errors: v4_1.z.treeifyError(result.error),
            });
        }
        else {
            req.body = result.data;
            next();
        }
    };
}
