"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TenantRobotsService = void 0;
const urls_1 = require("./urls");
class TenantRobotsService {
    static buildTxt(tenant) {
        const baseUrl = (0, urls_1.tenantBaseUrl)(tenant.subdomain);
        const allowIndex = tenant.robots_index !== false;
        const allowFollow = tenant.robots_follow !== false;
        const lines = ['User-agent: *'];
        if (allowIndex && allowFollow) {
            lines.push('Allow: /');
        }
        else if (!allowIndex) {
            lines.push('Disallow: /');
        }
        else {
            lines.push('Allow: /');
        }
        lines.push('', `Sitemap: ${baseUrl}/sitemap.xml`, '', `# Tenant: ${tenant.subdomain}`);
        return lines.join('\n');
    }
}
exports.TenantRobotsService = TenantRobotsService;
