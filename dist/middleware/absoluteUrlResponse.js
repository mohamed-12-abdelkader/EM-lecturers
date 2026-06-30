"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.absoluteUrlResponseMiddleware = void 0;
const appUrls_1 = require("../config/appUrls");
/**
 * Ensures JSON responses expose HTTPS/ngrok URLs instead of localhost paths.
 */
const absoluteUrlResponseMiddleware = (_req, res, next) => {
    const originalJson = res.json.bind(res);
    res.json = (body) => originalJson((0, appUrls_1.rewriteResponseUrls)(body));
    next();
};
exports.absoluteUrlResponseMiddleware = absoluteUrlResponseMiddleware;
