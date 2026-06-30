# Web Push Notifications API

Backend notification system with **real-time (Socket.IO)**, **Web Push (Service Worker / VAPID)**, **Expo mobile push**, and a **database-backed delivery queue** with retries and delivery logs.

Base path: `/api/notifications`

## Setup

### 1. Generate VAPID keys

```bash
npx web-push generate-vapid-keys
```

Add to `.env.development` / production `.env`:

```env
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
VAPID_SUBJECT=mailto:support@your-domain.com
WEB_PUSH_WORKER_ENABLED=true
WEB_PUSH_WORKER_INTERVAL_MS=2000
WEB_PUSH_WORKER_BATCH_SIZE=50
WEB_PUSH_MAX_ATTEMPTS=5
```

### 2. Run migrations

Migration `1772600000000_web_push_notifications.sql` adds:

- `web_push_subscriptions`
- `notification_push_queue`
- `notification_push_delivery_logs`
- Extended `notifications` columns: `icon`, `image`, `url`, `updated_at`

### 3. Frontend (Service Worker)

1. Register a service worker.
2. Request notification permission.
3. Subscribe with `pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: VAPID_PUBLIC_KEY })`.
4. POST subscription to `/api/notifications/push-subscribe`.

---

## VAPID public key

### `GET /api/notifications/vapid-public-key`

Public endpoint (no auth).

**Response**

```json
{ "publicKey": "BEl..." }
```

---

## Push subscription management

All routes require authentication (`student`, `teacher`, or `admin`).

### `POST /api/notifications/push-subscribe`

Register or refresh a browser/device subscription.

**Body**

```json
{
  "endpoint": "https://fcm.googleapis.com/fcm/send/...",
  "keys": {
    "p256dh": "...",
    "auth": "..."
  },
  "browser": "Chrome",
  "device_label": "Work laptop"
}
```

**Response `201`**

```json
{
  "message": "Push subscription saved",
  "subscription": {
    "id": 1,
    "endpoint": "...",
    "browser": "Chrome",
    "device_label": "Work laptop",
    "created_at": "...",
    "updated_at": "..."
  }
}
```

### `GET /api/notifications/push-subscriptions`

List active subscriptions for the current user.

### `PUT /api/notifications/push-subscribe/:subscriptionId`

Update keys, endpoint, browser, or device label.

### `DELETE /api/notifications/push-subscribe/:subscriptionId`

Soft-deactivate a subscription (`is_active = false`).

---

## Send notifications (admin / teacher)

Rate limited. Teachers may only target students enrolled in their courses.

### `POST /api/notifications/send`

Send to one user.

**Auth:** `admin`, `teacher`

**Body**

```json
{
  "user_id": 42,
  "title": "New Course Available",
  "body": "A new course has been added.",
  "icon": "https://cdn.example/icon.png",
  "image": "https://cdn.example/banner.png",
  "url": "/courses/123",
  "type": "course"
}
```

### `POST /api/notifications/send-bulk`

**Body**

```json
{
  "user_ids": [1, 2, 3],
  "title": "...",
  "body": "...",
  "type": "announcement"
}
```

Max 5000 user IDs per request.

### `POST /api/notifications/broadcast`

**Auth:** `admin` only

Broadcast to all active users (`student`, `teacher`, `admin`).

---

## Notification center

### `GET /api/notifications`

Paginated notification list (existing behavior + enriched fields when present).

Query: `limit`, `offset`

### `GET /api/notifications/unread`

Unread notifications only.

### `GET /api/notifications/unread-count`

### `PATCH /notifications/:id/read` or `PUT /notifications/:id/read`

Mark one notification as read.

### `PATCH /notifications/read-all` or `PUT /notifications/read-all`

Mark all as read.

### `DELETE /notifications/:id`

Delete a notification owned by the current user.

---

## Notification record shape

Stored in `notifications` (API exposes `body` as alias for DB `message`):

| Field | Description |
|-------|-------------|
| `id` | Primary key |
| `user_id` | Recipient |
| `title` | Title |
| `body` / `message` | Body text |
| `type` | Event type |
| `icon` | Optional icon URL |
| `image` | Optional image URL |
| `url` | Deep link when notification is clicked |
| `is_read` | Read flag |
| `created_at` | Created timestamp |
| `updated_at` | Updated timestamp |

---

## Delivery pipeline

When a notification is created:

1. Row inserted in `notifications`
2. Real-time event via Socket.IO (`notification:new`)
3. Jobs enqueued in `notification_push_queue` (one per active web push subscription)
4. Background worker sends via Web Push Protocol (VAPID)
5. Legacy OneSignal + Expo mobile push (unchanged)

### Queue behavior

- Statuses: `pending` → `processing` → `sent` | `failed` | `dead`
- Exponential backoff retries (default 5 attempts)
- Expired subscriptions (HTTP 404/410) are deactivated automatically
- Every attempt logged in `notification_push_delivery_logs`

---

## Automatic triggers

Use `NotificationTriggers` from `src/services/notificationTriggers.ts`:

| Method | Event |
|--------|-------|
| `onCoursePublished` | New course published |
| `onLessonAdded` | New lesson added |
| `onExamAvailable` | New exam available |
| `onCoursePurchase` | Student purchases / activates course |
| `onAnnouncement` | Teacher announcement |
| `onAssignmentDeadline` | Assignment deadline reminder |
| `onPaymentConfirmed` | Payment confirmed |
| `onCouponGenerated` | Coupon generated |
| `onCashbackAdded` | Cashback points added |

Existing `NotificationService` methods (lecture added, exam added, etc.) also enqueue web push automatically.

**Wired example:** course activation (`POST /api/course/activate`) calls `NotificationTriggers.onCoursePurchase`.

---

## Security

- JWT authentication on all user-facing routes
- Role checks on send/broadcast endpoints
- Teachers limited to their enrolled students
- Rate limits:
  - Subscribe: 30 / 15 min
  - Send / bulk: 60 / 15 min
  - Broadcast: 10 / hour
- Zod validation on all write payloads

---

## Scalability notes

- Multiple devices per user: one queue job per subscription
- Queue uses `FOR UPDATE SKIP LOCKED` for safe concurrent workers
- Designed to add FCM/APNs mobile channels alongside Expo without changing the notification center API
- For very high volume, run multiple API instances; each runs the embedded worker (consider a dedicated worker process in production)

---

## Mobile (Expo)

Existing endpoint unchanged:

`POST /api/notifications/push-token` — register Expo push token for native apps.
