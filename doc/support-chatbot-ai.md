# Technical Support Chatbot with DeepSeek LLM

## Overview

This system implements an intelligent technical support chatbot using DeepSeek LLM API that automatically handles common student problems and escalates complex issues to human admins.

## Features

- ✅ **Intent Detection**: Automatically identifies the type of problem (login, password reset, course access, etc.)
- ✅ **Automated Resolution**: Provides step-by-step troubleshooting guidance
- ✅ **Smart Escalation**: Detects when human intervention is needed
- ✅ **Status Tracking**: Tracks chat status (bot handling, waiting for admin, admin handling, closed)
- ✅ **Attempt Limiting**: Escalates after N failed bot attempts (default: 3)

## Chatbot Logic Flow

### Step 1: Identify the Problem (Intent Detection)

The bot uses DeepSeek LLM to classify student messages into one of these intents:

- `LOGIN_PROBLEM` - Can't log in / sign in
- `PASSWORD_RESET` - Password reset requests
- `ACCOUNT_LOCKED` - Account locked or suspended
- `COURSE_ACCESS` - Course access issues
- `VIDEO_LOADING` - Video not loading
- `PAYMENT` - Payment / subscription issues
- `BUG_ERROR` - Technical bugs or errors
- `OTHER` - General questions

### Step 2: Try Automated Resolution

For each intent, the bot:
1. Provides clear troubleshooting steps
2. Asks follow-up questions
3. Offers solutions based on the problem type

**Example (Login Problem):**
```
أهلاً بك! دعني أساعدك في حل مشكلة تسجيل الدخول.

يرجى التحقق من التالي:
1. هل تستخدم البريد الإلكتروني أو رقم الهاتف الصحيح؟
2. هل قمت بإعادة تعيين كلمة المرور مؤخراً؟
3. هل تظهر رسالة خطأ معينة؟
```

### Step 3: Detect When Bot is Stuck

The bot escalates to admin when:

✅ **Student says:**
- "لم يعمل" (This didn't work)
- "ما زال" (Still not solved)
- "أحتاج مساعدة" (I need help)
- "أريد أدمن" (Talk to admin)

✅ **Bot fails after N attempts** (default: 3 attempts)

✅ **Problem requires admin permissions:**
- Account activation
- Manual enrollment
- Payment verification
- Account locked issues

### Step 4: Escalation to Admin (Human Handoff)

When escalation is triggered:

**What the bot does:**
1. Tells the student clearly:
   ```
   "أفهم أن مشكلتك تحتاج إلى تدخل من فريق الدعم الفني. 
   سأقوم بنقل هذه المحادثة إلى أحد المسؤولين. 
   سيقوم أحد المسؤولين بالرد عليك قريباً."
   ```

2. Stops responding automatically
3. Marks the chat as "Waiting for Admin" (`waiting_for_admin`)

**Admins can:**
- See pending chats via `GET /api/support/chats?status=waiting_for_admin`
- Open chat and reply manually
- Take control (bot disabled when admin is assigned)
- Close ticket when solved

## Chat Statuses

- 🟢 **`bot_handling`** - Bot is handling the conversation
- 🟡 **`waiting_for_admin`** - Escalated, waiting for admin response
- 🔵 **`admin_handling`** - Admin is handling the conversation
- ⚫ **`closed`** - Chat is closed/resolved

## Database Schema

### Updated `support_chats` table:

```sql
ALTER TABLE support_chats 
  ADD COLUMN current_intent VARCHAR(50),
  ADD COLUMN bot_attempts INTEGER DEFAULT 0,
  ADD COLUMN escalation_reason TEXT,
  ADD COLUMN escalated_at TIMESTAMP;

-- New status values
ALTER TABLE support_chats 
  ADD CONSTRAINT support_chats_status_check 
  CHECK (status IN ('open', 'closed', 'resolved', 'bot_handling', 'waiting_for_admin', 'admin_handling'));
```

## API Endpoints

### For Students

**Send Message** (triggers bot):
```
POST /api/support/messages
Authorization: Bearer <student_token>
Body: { "text": "I can't log in" }
```

The bot will:
1. Detect intent
2. Generate response
3. Send automated reply
4. Escalate if needed

### For Admins

**Get Pending Chats**:
```
GET /api/support/chats?status=waiting_for_admin
Authorization: Bearer <admin_token>
```

**Assign Admin to Chat**:
```
POST /api/support/chats/:chatId/assign
Authorization: Bearer <admin_token>
```

This automatically changes status to `admin_handling` and disables bot responses.

**Update Chat Status**:
```
PATCH /api/support/chats/:chatId/status
Authorization: Bearer <admin_token>
Body: { "status": "closed" }
```

## Configuration

### Environment Variables

```env
DEEPSEEK_API_KEY=your_deepseek_api_key
DEEPSEEK_API_URL=https://api.deepseek.com  # Default
```

### Bot Settings

In `src/services/deepseekChatbot.ts`:

```typescript
private static readonly MAX_BOT_ATTEMPTS = 3; // Max attempts before escalation
```

## How It Works

### 1. Student Sends Message

```typescript
// Student sends: "I can't log in"
POST /api/support/messages
```

### 2. Intent Detection

```typescript
const intentResult = await DeepSeekChatbotService.detectIntent(message, context);
// Returns: { intent: 'LOGIN_PROBLEM', confidence: 0.9, requiresEscalation: false }
```

### 3. Generate Response

```typescript
const botResponse = await DeepSeekChatbotService.generateResponse(
  intentResult.intent,
  message,
  context
);
// Returns personalized Arabic response with troubleshooting steps
```

### 4. Check Escalation

```typescript
if (botResponse.shouldEscalate || context.botAttempts >= MAX_BOT_ATTEMPTS) {
  await SupportChatService.escalateChat(chatId, reason);
  await SupportChatService.updateChatStatus(chatId, 'waiting_for_admin');
}
```

### 5. Admin Takes Over

When admin assigns themselves:
```typescript
await SupportChatService.assignAdmin(chatId, adminId);
await SupportChatService.updateChatStatus(chatId, 'admin_handling');
// Bot stops responding automatically
```

## Socket.io Events

The chatbot works seamlessly with real-time Socket.io:

**Student sends message:**
```javascript
socket.emit('support:send-message', { text: 'I can\'t log in' });
```

**Bot responds automatically:**
```javascript
socket.on('support:new-message', (message) => {
  // message.is_auto_reply === true for bot messages
});
```

## Customization

### Adding New Intents

1. Update `IntentType` in `src/services/deepseekChatbot.ts`:
```typescript
export type IntentType = 
  | 'LOGIN_PROBLEM'
  | 'NEW_INTENT'  // Add here
  | ...
```

2. Add response template in `getResponseTemplate()`:
```typescript
NEW_INTENT: {
  instructions: `...`,
  defaultMessage: `...`,
  requiresEscalation: false,
}
```

### Modifying Response Templates

Edit the `getResponseTemplate()` method to customize responses for each intent.

### Adjusting Escalation Logic

Modify escalation detection in:
- `generateResponse()` - Check for escalation keywords
- `detectIntent()` - Set `requiresEscalation` flag
- `MAX_BOT_ATTEMPTS` - Change attempt limit

## Testing

### Test Intent Detection

```bash
curl -X POST http://localhost:8000/api/support/messages \
  -H "Authorization: Bearer <student_token>" \
  -H "Content-Type: application/json" \
  -d '{"text": "I forgot my password"}'
```

### Test Escalation

Send messages that trigger escalation:
- "This didn't work"
- "I need help from support"
- Send 3+ messages without solving

## Migration

Run the migration to update the database:

```bash
# The migration will be applied automatically on server start
# Or manually:
npm run migrate
```

Migration file: `migrations/1700000000950_enhance_support_chat_with_bot.sql`

## Notes

- The bot responds in Arabic by default
- Bot responses are marked with `is_auto_reply: true`
- Chat context includes last 10 messages for better understanding
- Bot attempts are tracked per hour (resets after 1 hour)
- DeepSeek API errors fallback to template responses

