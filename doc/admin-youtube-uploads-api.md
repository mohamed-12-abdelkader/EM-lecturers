# Admin YouTube uploads API

Base: `/api/admin/youtube`  
Auth: admin JWT + `X-Tenant-Subdomain: default` (except OAuth callback).

## Env

```env
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
YOUTUBE_OAUTH_REDIRECT_URL=https://em-online.online/api/admin/youtube/callback
RECORDINGS_DIR=/recordings
FRONTEND_HOST=https://em-online.online
```

Add the exact `YOUTUBE_OAUTH_REDIRECT_URL` to Google Cloud OAuth client **Authorized redirect URIs**.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/status` | Connection status / channel title |
| GET | `/connect` | Returns Google consent `url` |
| GET | `/callback` | OAuth redirect (no JWT; uses signed `state`) |
| POST | `/disconnect` | Clear stored tokens |
| GET | `/sessions` | List ended live sessions across tenants |
| POST | `/uploads` | Queue uploads `{ meeting_ids, replace? }` |
| GET | `/uploads?ids=` | Poll job status |
| POST | `/uploads/:jobId/retry` | Re-queue failed / needs_reauth job |

### Session filters

`tenant_id`, `course_id`, `search`, `from`, `to`, `has_file`, `not_on_youtube`, `limit`, `offset`

On success the worker sets `meeting.egress_url` (or `general_course_group_meeting.egress_url`) to the unlisted YouTube watch URL.

Admin UI: `/admin/youtube-uploads`
