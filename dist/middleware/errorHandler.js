"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.errorHandlerMiddleware = void 0;
const v4_1 = require("zod/v4");
const utils_1 = require("../utils");
const routerNotFound = (_, _res, _next) => {
    throw new utils_1.HttpError(404, 'Route not found');
};
const errorHandler = (err, req, res, _) => {
    const loggerMsg = 'ErrorHandler';
    // Log error details
    console.error(`[ErrorHandler] ${err.name}: ${err.message}`);
    console.error(`[ErrorHandler] Stack:`, err.stack);
    console.error(`[ErrorHandler] Request:`, {
        method: req.method,
        url: req.url,
        params: req.params,
        query: req.query,
        body: req.body,
    });
    if (err instanceof utils_1.HttpError) {
        utils_1.logger.warn(err, loggerMsg);
        res.status(err.status).send({ status: err.status, message: err.message, name: err.name });
        return;
    }
    else if (err instanceof v4_1.ZodError) {
        utils_1.logger.warn(err, loggerMsg);
        res.status(400).send({ status: 400, message: 'Invalid request', name: 'ZodError' });
        return;
    }
    utils_1.logger.error(err, loggerMsg);
    // في development mode، أرسل تفاصيل أكثر
    const isDevelopment = process.env.NODE_ENV === 'development';
    res.status(500).send({
        status: 500,
        message: isDevelopment ? err.message : 'Something went wrong',
        name: 'InternalServerError',
        ...(isDevelopment && { stack: err.stack, details: err.toString() }),
    });
};
exports.errorHandlerMiddleware = [routerNotFound, errorHandler];
