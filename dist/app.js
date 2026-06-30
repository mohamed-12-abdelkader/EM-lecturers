"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.server = exports.app = void 0;
const express_1 = __importDefault(require("express"));
const http_1 = require("http");
const utils_1 = require("./utils");
const errorHandler_1 = require("./middleware/errorHandler");
const absoluteUrlResponse_1 = require("./middleware/absoluteUrlResponse");
const cors_1 = __importDefault(require("cors"));
const appUrls_1 = require("./config/appUrls");
const routes_1 = require("./routes");
const tenantContext_1 = require("./middleware/tenantContext");
exports.app = (0, express_1.default)();
exports.server = (0, http_1.createServer)(exports.app);
// Parse JSON bodies; include text/plain because some clients (e.g. Postman "raw" default) send JSON with Content-Type: text/plain
exports.app.use(express_1.default.json({ type: ['application/json', 'text/plain'] }));
exports.app.use(express_1.default.urlencoded({ extended: true }));
exports.app.use((0, cors_1.default)((0, appUrls_1.getCorsOriginDelegate)()));
// Expose refreshed token header to the browser
exports.app.use((req, res, next) => {
    const existing = res.getHeader('Access-Control-Expose-Headers');
    const expose = Array.isArray(existing)
        ? existing.join(',')
        : typeof existing === 'string'
            ? existing
            : '';
    const value = expose ? `${expose}, X-Access-Token` : 'X-Access-Token';
    res.setHeader('Access-Control-Expose-Headers', value);
    next();
});
exports.app.use(express_1.default.raw({ type: 'application/webhook+json' }));
exports.app.use(utils_1.loggerMiddleware);
exports.app.use(absoluteUrlResponse_1.absoluteUrlResponseMiddleware);
// Public server info (for Expo Go / mobile clients)
exports.app.get('/api/server-info', (_req, res) => {
    res.json((0, appUrls_1.getServerInfo)());
});
// Routes
exports.app.use('/api', tenantContext_1.tenantContextMiddleware);
exports.app.use('/api', routes_1.router);
exports.app.use('/uploads', express_1.default.static('uploads'));
exports.app.use(errorHandler_1.errorHandlerMiddleware);
