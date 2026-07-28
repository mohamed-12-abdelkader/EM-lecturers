# WhatsApp Platform Setup (EM-lecturers + wwebjs)

This guide provisions the **wwebjs** gateway for EM-lecturers and connects the admin dashboard.

## Architecture

- **wwebjs** — WhatsApp Web gateway (sessions, send/receive, signed webhooks, inbound media)
- **EM-lecturers** — business logic, pools, outbound queue, admin APIs, technical support bot
- **EM-lecturers-front** — admin UI at `/admin/whatsapp/*`

## 1) Start wwebjs

```bash
cd /path/to/wwebjs
# ensure Postgres + auth volume are configured (see docker-compose.yml)
docker compose up -d
# or: npm run dev
```

Default gateway URL: `http://localhost:3000`

Rebuild/restart wwebjs after pulling media-forwarding changes so inbound images reach the API.

## 2) Create one app for EM-lecturers

Admin token is `ADMIN_TOKEN` from the wwebjs env.

```bash
curl -X POST "http://localhost:3000/admin/apps" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "em-lecturers",
    "webhook_url": "https://YOUR_PUBLIC_API/api/webhooks/whatsapp",
    "webhook_secret": "generate-a-long-random-secret"
  }'
```

Response includes an API key like `wa_...`. Save it.

For local development with Expo/ngrok, set `webhook_url` to your public tunnel, e.g.:

`https://xxxx.ngrok-free.app/api/webhooks/whatsapp`

## 3) Configure EM-lecturers env

In `.env.development` / `.env`:

```env
WHATSAPP_GATEWAY_URL=http://localhost:3000
WHATSAPP_API_KEY=wa_xxxxxxxxxxxx
WHATSAPP_WEBHOOK_SECRET=generate-a-long-random-secret
WHATSAPP_WORKER_ENABLED=true
WHATSAPP_WORKER_INTERVAL_MS=2000
WHATSAPP_WORKER_BATCH_SIZE=20
WHATSAPP_MAX_ATTEMPTS=5

# LLM (technical support bot)
DEEPSEEK_API_KEY=sk-...
DEEPSEEK_API_URL=https://api.deepseek.com
MISTRAL_API_KEY=...
MISTRAL_API_BASE_URL=https://api.mistral.ai/v1
```

`WHATSAPP_WEBHOOK_SECRET` must match the secret set on the wwebjs app.

Restart the API so migrations run and the outbound worker starts.

## 4) Dashboard usage

Log in as **admin** on tenant **default** (`X-Tenant-Subdomain: default` on localhost).

| Route | Purpose |
|-------|---------|
| `/admin/whatsapp/sessions` | Create sessions, scan QR, reconnect, delete |
| `/admin/whatsapp/services` | Enable services, assign multiple numbers (pool + weights) |
| `/admin/whatsapp/monitor` | Queue stats, conversations, test send |

Suggested first session slugs: `support-01`, `support-02`, …

1. Create sessions and scan QR until status is **ready**
2. Open **Services** → select `الدعم الفني` (`technical_support_bot`)
3. Assign 1+ ready sessions to the pool and save
4. **Enable** the service so the DeepSeek support bot replies
5. Use **Monitor** → test send to verify outbound queue + gateway
6. Message the support WhatsApp number from a student phone to test the bot

## 5) Technical support bot (`technical_support_bot`)

Handler is registered at API startup under `src/modules/whatsapp/automations/technicalSupport/`.

**Capabilities**
- Find teacher platform URLs from active tenants
- Login / signup / FAQ guidance
- Screenshot understanding via **Mistral** vision (pixtral)
- Full conversation history in DeepSeek context
- Password reset **only** when WhatsApp `from` matches the student’s stored `users.phone` (normalized). Sends a temporary password and sets `must_change_password=true`. Rate limit: 3 resets / phone / 24h.

**Webhook timing**
- API acknowledges the webhook immediately, then runs the LLM agent asynchronously (wwebjs times out around 10s).

**Inbound media**
- wwebjs downloads image media (max ~5MB) and posts `media: { mimetype, data, filename }` on the webhook.
- EM does not store base64 in Postgres long-term; only a summary + optional image description.

## 6) Admin API summary

All under `/api/whatsapp` — require admin JWT + default tenant:

| Method | Path |
|--------|------|
| GET | `/status` |
| GET/POST | `/sessions` |
| GET/DELETE | `/sessions/:id` |
| POST | `/sessions/:id/reconnect` |
| PATCH | `/sessions/:id` |
| GET/PATCH | `/services`, `/services/:id` |
| PUT | `/services/:id/sessions` |
| GET | `/conversations` |
| GET | `/queue/stats` |
| POST | `/messages/send` |

Webhook (no JWT; HMAC only):

| Method | Path |
|--------|------|
| POST | `/api/webhooks/whatsapp` |

## Troubleshooting

| Symptom | Check |
|---------|--------|
| `configured: false` | `WHATSAPP_API_KEY` set and API restarted |
| QR never appears | Chromium / wwebjs logs; try reconnect |
| Webhook 401 | Secret mismatch; rawBody capture working |
| Test send 503 | No ready sessions in the service pool; enable service |
| Messages stuck pending | Worker enabled; gateway reachable from API |
| Bot silent | Service `technical_support_bot` enabled + session in pool + handler loaded |
| Images ignored | Restart wwebjs with media forwarding; check `media_error` in inbound metadata |
| Password reset refused | Student must message from the same phone stored on the account |
