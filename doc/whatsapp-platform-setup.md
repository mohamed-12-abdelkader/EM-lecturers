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

Suggested session slugs: `support-01`, `support-02`, … for support; `creative-01`, … for creative; `analyst-01`, … for data analyst; `scientific-01`, … for student scientific; `exam-builder-01`, … for exam builder.

1. Create sessions and scan QR until status is **ready**
2. Open **Services** → select the service (`الدعم الفني` or `مساعد السوشيال`)
3. Assign 1+ ready sessions to that service’s pool and save (keep pools separate)
4. **Enable** the service so the bot replies
5. Use **Monitor** → test send to verify outbound queue + gateway
6. Message the WhatsApp number from an allowed phone to test the bot

## 5) Technical support bot (`technical_support_bot`)

Handler is registered at API startup under `src/modules/whatsapp/automations/technicalSupport/`.

**Capabilities**
- Find teacher platform URLs from active tenants
- Login / signup / FAQ guidance
- Screenshot understanding via **Mistral** vision (pixtral)
- Full conversation history in DeepSeek context
- Password reset **only** when WhatsApp `from` matches the student’s stored `users.phone` (normalized). Sends a temporary password and sets `must_change_password=true`. Rate limit: 3 resets / phone / 24h.
- **App-only teacher:** students asking about **مصطفى نوفل** (`mr-nofal`) are never given the website URL (`https://mr-nofal.em-online.online`). The bot directs them to the mobile app (download link from the teacher) and helps with install, login, activation, and troubleshooting.

**Webhook timing**
- API acknowledges the webhook immediately, then runs the LLM agent asynchronously (wwebjs times out around 10s).

**Inbound media**
- wwebjs downloads image media (max ~5MB) and posts `media: { mimetype, data, filename }` on the webhook.
- EM does not store base64 in Postgres long-term; only a summary + optional image description.

## 5b) Teacher creative bot (`teacher_creative_bot`)

Handler: `src/modules/whatsapp/automations/teacherCreative/`. Reuses `TeacherCreativeChatbotService` (same as the web مساعد السوشيال).

**Access**
- Teachers message a **shared** creative WhatsApp number from their **personal** phone (no login).
- Identity: match WhatsApp `from` to `users.phone` or `users.whatsapp_number` where `role = 'teacher'`.
- Unknown numbers get a denial reply.
- Requires plan feature `creative_social` (diamond); otherwise plan-denied Arabic reply.

**Capabilities**
- Text chat + inbound reference images (passed into creative generate/execute).
- Outbound generated images via queue `media_url` → gateway `media.url`.
- Human handoff: when an admin replies from the inbox, conversation becomes `human` and `metadata.human_mute_until` is set (default **60 minutes** from service `config.human_mute_minutes`). Bot stays silent until mute expires, then auto-resumes `bot` on the next inbound.

**Ops**
1. Run migration that seeds `teacher_creative_bot` (disabled by default).
2. Create session e.g. `creative-01`, scan QR, assign to `مساعد السوشيال` pool, enable service.
3. Ensure each teacher’s `phone` / `whatsapp_number` matches the WhatsApp they will use.

## 5c) Teacher data analyst bot (`teacher_data_analyst_bot`)

Handler: `src/modules/whatsapp/automations/teacherDataAnalyst/`. Reuses `DataAnalystChatbotService` (same as the web محلل البيانات).

**Access**
- Teachers message a **shared** analyst WhatsApp number from their **personal** phone (no login).
- Identity: match WhatsApp `from` to `users.phone` or `users.whatsapp_number` where `role = 'teacher'`.
- Unknown numbers get a denial reply.
- Requires plan feature `data_analyst` (diamond / باقة التميز); otherwise plan-denied Arabic reply.

**Capabilities**
- Text-only reports (student / course / general / exam-homework analysis) via existing SQL + DeepSeek formatting.
- Long reports are split into sequential WhatsApp chunks (~3500 chars).
- Voice and images are rejected with a short Arabic guidance reply.
- Human handoff: admin inbox reply sets `metadata.human_mute_until` (default **60 minutes**). Bot stays silent until mute expires, then auto-resumes `bot` on the next inbound.

**Ops**
1. Run migration that seeds `teacher_data_analyst_bot` (disabled by default).
2. Create session e.g. `analyst-01`, scan QR, assign to `محلل البيانات` pool, enable service.
3. Ensure each teacher’s `phone` / `whatsapp_number` matches the WhatsApp they will use.

## 5d) Student scientific bot (`student_scientific_bot`)

Handler: `src/modules/whatsapp/automations/studentScientific/`. Reuses `ScientificChatbotService.answerTeacherQuestion` (same as web المساعد العلمي / كل مواد المدرس).

**Access**
- Students message a **shared** platform WhatsApp number from their **personal** phone (no login).
- Identity: match WhatsApp `from` to `users.phone` where `role = 'student'`.
- Unknown numbers get a denial reply.
- Student must be enrolled with a teacher who has plan feature `scientific_support` (Gold+) **and** uploaded scientific content.

**Teacher selection**
- One eligible teacher → auto-selected.
- Multiple → numbered list; student replies with a number; stored in conversation `metadata.teacher_id`.
- `تغيير المدرس` clears selection and re-lists.

**Capabilities**
- Text + inbound images (Pixtral path via existing service).
- Voice rejected.
- Long answers split into sequential WhatsApp chunks (~3500 chars).
- Human handoff: admin inbox reply sets `metadata.human_mute_until` (default **60 minutes**).

**Ops**
1. Run migration that seeds `student_scientific_bot` (disabled by default).
2. Create session e.g. `scientific-01`, scan QR, assign to `المساعد العلمي` pool, enable service.
3. Ensure each student’s `phone` matches the WhatsApp they will use.

## 5e) Teacher exam builder bot (`teacher_exam_builder_bot`)

Handler: `src/modules/whatsapp/automations/teacherExamBuilder/`. Reuses `ExamBuilderChatbotService` (same as web مساعد الامتحانات).

**Access**
- Teachers message a **shared** exam-builder WhatsApp number from their **personal** phone (no login).
- Identity: match WhatsApp `from` to `users.phone` or `users.whatsapp_number` where `role = 'teacher'`.
- Requires plan feature `exam_builder_ai` (Gold+).

**Capabilities (WhatsApp)**
- Propose question lists from natural language (e.g. أنشئ امتحان 10 أسئلة…).
- Adjust via NL (e.g. شيل السؤال 3).
- Regenerate: `أعد` / `إعادة اختيار` / `مجموعة جديدة`.
- **Approve list only:** `موافق` / `اعتماد` → `approveSession({ create_exam: false })`.
- Finish creating the exam (course/lecture/title) in the **web UI**.
- Text only; voice/images rejected.
- Long replies chunked (~3500 chars).
- Human handoff mute default **60 minutes**.

**Ops**
1. Run migration that seeds `teacher_exam_builder_bot` (disabled by default).
2. Create session e.g. `exam-builder-01`, scan QR, assign to `مساعد الامتحانات` pool, enable service.
3. Ensure each teacher’s `phone` / `whatsapp_number` matches the WhatsApp they will use.

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
| Bot silent | Service enabled + session in pool + handler loaded; or conversation still in `human` mute |
| Creative bot denies number | Teacher `phone`/`whatsapp_number` must match WhatsApp from; diamond plan required |
| Analyst bot denies number | Teacher `phone`/`whatsapp_number` must match WhatsApp from; diamond (`data_analyst`) required |
| Analyst ignores images/voice | Text-only channel by design; ask for report commands in text |
| Scientific bot denies number | Student `phone` must match WhatsApp from; enrollment + teacher Gold scientific content required |
| Scientific asks to pick teacher | Student enrolled with multiple eligible teachers; reply with list number or `تغيير المدرس` |
| Exam builder approve then what? | WhatsApp only approves the list; open web مساعد الامتحانات to attach course/lecture |
| Images ignored | Restart wwebjs with media forwarding; check `media_error` in inbound metadata |
| Generated image not sent | Outbound job has `media_url`; gateway `/v1/messages` media support; worker running |
| Password reset refused | Student must message from the same phone stored on the account |
