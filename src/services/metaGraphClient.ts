import { config, HttpError } from '../utils';

function apiVersion(): string {
  return String(config.META_API_VERSION || 'v21.0').replace(/^\/+|\/+$/g, '');
}

function graphBase(): string {
  return `https://graph.facebook.com/${apiVersion()}`;
}

async function parseGraphResponse<T>(res: Response): Promise<T> {
  const data = (await res.json().catch(() => ({}))) as any;
  if (!res.ok || data?.error) {
    const err = data?.error || {};
    const message = err.message || `Meta Graph error ${res.status}`;
    const code = err.code != null ? String(err.code) : String(res.status);
    const http = res.status === 401 || code === '190' ? 401 : 400;
    throw new HttpError(http, message, {
      metaCode: code,
      metaType: err.type,
      metaSubcode: err.error_subcode,
      fbtrace_id: err.fbtrace_id,
    });
  }
  return data as T;
}

export async function metaGraphRequest<T = any>(opts: {
  path: string;
  method?: 'GET' | 'POST' | 'DELETE';
  accessToken: string;
  query?: Record<string, string | number | boolean | undefined | null>;
  body?: Record<string, unknown>;
}): Promise<T> {
  const url = new URL(
    opts.path.startsWith('http')
      ? opts.path
      : `${graphBase()}${opts.path.startsWith('/') ? '' : '/'}${opts.path}`,
  );
  url.searchParams.set('access_token', opts.accessToken);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v === undefined || v === null || v === '') continue;
      url.searchParams.set(k, String(v));
    }
  }

  const init: RequestInit = { method: opts.method || 'GET' };
  if (opts.body && (opts.method === 'POST' || opts.method === 'DELETE')) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(opts.body);
  }

  const res = await fetch(url.toString(), init);
  return parseGraphResponse<T>(res);
}

export async function exchangeCodeForUserToken(code: string, redirectUri: string) {
  const url = new URL(`${graphBase()}/oauth/access_token`);
  url.searchParams.set('client_id', config.META_APP_ID);
  url.searchParams.set('client_secret', config.META_APP_SECRET);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('code', code);
  const res = await fetch(url.toString());
  return parseGraphResponse<{ access_token: string; token_type?: string; expires_in?: number }>(res);
}

export async function exchangeForLongLivedUserToken(shortLivedToken: string) {
  const url = new URL(`${graphBase()}/oauth/access_token`);
  url.searchParams.set('grant_type', 'fb_exchange_token');
  url.searchParams.set('client_id', config.META_APP_ID);
  url.searchParams.set('client_secret', config.META_APP_SECRET);
  url.searchParams.set('fb_exchange_token', shortLivedToken);
  const res = await fetch(url.toString());
  return parseGraphResponse<{ access_token: string; expires_in?: number; token_type?: string }>(res);
}

export async function fetchMetaMe(accessToken: string) {
  return metaGraphRequest<{ id: string; name?: string }>({
    path: '/me',
    accessToken,
    query: { fields: 'id,name' },
  });
}

export async function fetchManagedPages(accessToken: string) {
  return metaGraphRequest<{
    data: Array<{
      id: string;
      name?: string;
      access_token?: string;
      picture?: { data?: { url?: string } };
      instagram_business_account?: { id: string };
    }>;
  }>({
    path: '/me/accounts',
    accessToken,
    query: {
      fields: 'id,name,access_token,picture{url},instagram_business_account',
      limit: 100,
    },
  });
}

export async function fetchIgUser(igUserId: string, pageAccessToken: string) {
  return metaGraphRequest<{ id: string; username?: string; profile_picture_url?: string }>({
    path: `/${igUserId}`,
    accessToken: pageAccessToken,
    query: { fields: 'id,username,profile_picture_url' },
  });
}

export async function publishFacebookPagePhoto(opts: {
  pageId: string;
  pageAccessToken: string;
  imageUrl: string;
  caption: string;
}) {
  return metaGraphRequest<{ id?: string; post_id?: string }>({
    path: `/${opts.pageId}/photos`,
    method: 'POST',
    accessToken: opts.pageAccessToken,
    query: {
      url: opts.imageUrl,
      caption: opts.caption || '',
      published: true,
    },
  });
}

export async function createInstagramMediaContainer(opts: {
  igUserId: string;
  pageAccessToken: string;
  imageUrl: string;
  caption: string;
}) {
  return metaGraphRequest<{ id: string }>({
    path: `/${opts.igUserId}/media`,
    method: 'POST',
    accessToken: opts.pageAccessToken,
    query: {
      image_url: opts.imageUrl,
      caption: opts.caption || '',
    },
  });
}

export async function getInstagramContainerStatus(opts: {
  creationId: string;
  pageAccessToken: string;
}) {
  return metaGraphRequest<{ status_code?: string; status?: string }>({
    path: `/${opts.creationId}`,
    accessToken: opts.pageAccessToken,
    query: { fields: 'status_code,status' },
  });
}

export async function publishInstagramMedia(opts: {
  igUserId: string;
  pageAccessToken: string;
  creationId: string;
}) {
  return metaGraphRequest<{ id: string }>({
    path: `/${opts.igUserId}/media_publish`,
    method: 'POST',
    accessToken: opts.pageAccessToken,
    query: { creation_id: opts.creationId },
  });
}

export async function waitForInstagramContainerReady(opts: {
  creationId: string;
  pageAccessToken: string;
  maxAttempts?: number;
}): Promise<void> {
  const max = opts.maxAttempts ?? 12;
  for (let i = 0; i < max; i++) {
    const st = await getInstagramContainerStatus({
      creationId: opts.creationId,
      pageAccessToken: opts.pageAccessToken,
    });
    const code = String(st.status_code || st.status || '').toUpperCase();
    if (code === 'FINISHED' || code === 'PUBLISHED') return;
    if (code === 'ERROR' || code === 'EXPIRED') {
      throw new HttpError(400, `Instagram media container failed: ${code}`);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new HttpError(408, 'انتهت مهلة تجهيز صورة إنستجرام');
}
