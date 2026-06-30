import { tenantBaseUrl } from './urls';
import type { TenantSeoRecord } from './types';

export class TenantRobotsService {
  static buildTxt(tenant: TenantSeoRecord): string {
    const baseUrl = tenantBaseUrl(tenant.subdomain);
    const allowIndex = tenant.robots_index !== false;
    const allowFollow = tenant.robots_follow !== false;

    const lines = ['User-agent: *'];

    if (allowIndex && allowFollow) {
      lines.push('Allow: /');
    } else if (!allowIndex) {
      lines.push('Disallow: /');
    } else {
      lines.push('Allow: /');
    }

    lines.push('', `Sitemap: ${baseUrl}/sitemap.xml`, '', `# Tenant: ${tenant.subdomain}`);
    return lines.join('\n');
  }
}
