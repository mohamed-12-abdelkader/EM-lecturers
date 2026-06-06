# Enhanced Notification System

## Overview

This document describes the enhanced notification system that provides comprehensive event-based notifications for students based on their subscriptions and memberships.

## Architecture

### 1. Event-Based System

The notification system uses an event-driven architecture with the following components:

- **Event Emitter** (`src/services/notificationEvents.ts`): Central event emitter that dispatches notification events
- **Event Handlers**: Automatically handle events and create notifications
- **Notification Service** (`src/services/notifications.ts`): Core service for creating and managing notifications

### 2. Database Schema

The `notifications` table includes the following key columns:

```sql
- id: Primary key
- user_id: Student who receives the notification
- title: Notification title
- message: Notification message
- description: Optional detailed description
- type: Notification type (see types below)
- course_id: Related regular course
- general_course_id: Related general course
- lecture_id: Related lecture
- package_id: Related package
- subject_id: Related package subject
- lesson_id: Related lesson
- exam_id: Related exam
- video_id: Related video
- group_id: Related chat group
- sender_id: Message sender (for direct/group messages)
- is_read: Read status
- created_at: Creation timestamp
- metadata: JSONB for additional data
```

### 3. Notification Types

The system supports the following notification types:

#### Course Events
- `lecture_added`: New lecture added to a course
- `video_added`: New video added to a lecture
- `file_added`: New file added to a lecture
- `exam_added`: New exam created
- `exam_updated`: Exam updated
- `quiz_added`: New quiz added
- `quiz_updated`: Quiz updated

#### Package Events
- `package_lesson_added`: New lesson in a package
- `package_video_added`: New video in a package lesson
- `package_assignment_added`: New assignment in a package
- `package_exam_added`: New exam in a package
- `package_exam_updated`: Package exam updated
- `package_file_added`: New file in a package

#### Messaging Events
- `group_message`: New message in a group
- `direct_message`: Direct message from teacher/admin

#### Social Events
- `social_comment`: Comment on a post
- `social_reply`: Reply to a comment
- `social_like`: Like on a post
- `social_reaction`: Reaction to a post

## Event Flow

### 1. Event Emission

When an action occurs (e.g., lecture created, message sent), the controller emits an event:

```typescript
import { notificationEvents, NotificationEventType } from '../services/notificationEvents';

notificationEvents.emit(NotificationEventType.LECTURE_ADDED, {
  courseId: 123,
  lectureId: 456,
  lectureTitle: 'Introduction to Math',
  courseTitle: 'Mathematics 101',
  courseType: 'regular',
});
```

### 2. Event Handling

The event handler automatically:
1. Determines which students should receive the notification
2. Creates notifications in the database
3. Sends push notifications (if configured)

### 3. Notification Delivery

Students receive notifications through:
- **Database**: Stored in `notifications` table
- **API**: Retrieved via `GET /api/notifications`
- **Push Notifications**: Sent via OneSignal (if configured)

## Subscription-Based Filtering

### For Students

The system ensures students only receive notifications for entities they are subscribed to:

1. **Regular Courses**: Only if enrolled (`enrollments` table)
2. **General Courses**: Only if enrolled (`general_course_enrollments` table)
3. **Packages**: Only if actively subscribed (`package_activations` table with `is_active = TRUE`)
4. **Groups**: Only if member (`chat_group_members` table)
5. **Direct Messages**: Always visible (from teachers/admins)
6. **Social Notifications**: Always visible

### Query Filtering

The `getUserNotifications` method automatically filters notifications based on subscriptions:

```sql
-- Example: Only show course notifications if student is enrolled
(n.course_id IS NOT NULL AND EXISTS (
  SELECT 1 FROM enrollments e 
  WHERE e.user_id = $1 AND e.course_id = n.course_id
))
```

## Integration Points

### 1. Lecture Creation

**File**: `src/controllers/courses.ts`, `src/controllers/courseContent.ts`, `src/controllers/generalCourseLectures.ts`

```typescript
// After creating a lecture
notificationEvents.emit(NotificationEventType.LECTURE_ADDED, {
  courseId,
  lectureId: result.rows[0].id,
  lectureTitle: title,
  courseTitle,
  courseType: 'regular', // or 'general'
  generalCourseId: generalCourseId, // if general course
});
```

### 2. Video Addition

**File**: `src/controllers/generalCourseLectures.ts`

```typescript
notificationEvents.emit(NotificationEventType.VIDEO_ADDED, {
  courseId,
  lectureId,
  videoId: result.rows[0].id,
  videoTitle: name,
  lectureTitle,
  courseTitle,
  courseType: 'general',
  generalCourseId,
});
```

### 3. Exam Creation/Update

**File**: `src/controllers/exams.ts`

```typescript
notificationEvents.emit(NotificationEventType.EXAM_ADDED, {
  courseId,
  lectureId, // optional
  examId: exam.id,
  examTitle: titleInput,
  lectureTitle, // optional
  courseTitle,
  courseType: 'regular',
});
```

### 4. Direct Messages

**File**: `src/controllers/chat.ts`, `src/index.ts`

```typescript
// Only for teacher/admin to student messages
if ((user.role === 'teacher' || user.role === 'admin') && otherId) {
  notificationEvents.emit(NotificationEventType.DIRECT_MESSAGE, {
    senderId: user.id,
    recipientId: otherId,
    senderName,
    messageText: text,
    senderRole: user.role as 'teacher' | 'admin',
  });
}
```

### 5. Group Messages

**File**: `src/controllers/chat.ts`

```typescript
notificationEvents.emit(NotificationEventType.GROUP_MESSAGE, {
  groupId,
  senderId: user.id,
  senderName,
  messageText: text,
  groupName,
});
```

### 6. Package Content

Package notifications are already integrated in the existing package content controllers. The event system can be added similarly.

## API Endpoints

### Get Notifications

```
GET /api/notifications?limit=20&offset=0
```

**Response**:
```json
{
  "notifications": [
    {
      "id": "notification_123",
      "type": "notification",
      "notification_type": "lecture_added",
      "title": "محاضرة جديدة",
      "message": "تم إضافة محاضرة جديدة \"Introduction\" في كورس \"Math 101\"",
      "description": null,
      "course_id": 123,
      "lecture_id": 456,
      "is_read": false,
      "created_at": "2024-01-15T10:30:00Z",
      "course_title": "Math 101",
      "lecture_title": "Introduction"
    }
  ],
  "pagination": {
    "limit": 20,
    "offset": 0,
    "total": 50,
    "hasMore": true
  }
}
```

### Mark as Read

```
PUT /api/notifications/:notificationId/read
```

### Mark All as Read

```
PUT /api/notifications/read-all
```

### Get Unread Count

```
GET /api/notifications/unread-count
```

## Extensibility

### Adding New Event Types

1. **Add to enum** in `src/services/notificationEvents.ts`:
```typescript
export enum NotificationEventType {
  // ... existing types
  NEW_EVENT_TYPE = 'new:event:type',
}
```

2. **Add payload interface**:
```typescript
export interface NewEventPayload {
  // ... payload fields
}
```

3. **Add event handler**:
```typescript
notificationEvents.on(NotificationEventType.NEW_EVENT_TYPE, async (payload: NewEventPayload) => {
  // Handle the event
  await NotificationService.handleNewEvent(payload);
});
```

4. **Add notification type** to database constraint in migration
5. **Emit event** in the appropriate controller

### Adding New Notification Methods

Add methods to `NotificationService` class:

```typescript
static async notifyNewEvent(payload: NewEventPayload) {
  // Determine recipients
  // Create notifications
  // Send push notifications
}
```

## Database Migration

Run the migration to add new columns and constraints:

```bash
# The migration file is: migrations/1700000008000_enhance_notifications_system.sql
```

This migration:
- Adds `description` and `general_course_id` columns
- Updates type constraint to include all notification types
- Creates indexes for better query performance

## Best Practices

1. **Always emit events** after creating/updating content
2. **Use event system** instead of direct service calls for consistency
3. **Handle errors gracefully** - fallback to direct calls if events fail
4. **Filter by subscriptions** - ensure students only see relevant notifications
5. **Use appropriate types** - choose the correct notification type
6. **Include metadata** - add relevant IDs for navigation

## Testing

To test the notification system:

1. **Create a lecture** in a course with enrolled students
2. **Check notifications** via API: `GET /api/notifications`
3. **Verify filtering** - ensure students only see notifications for subscribed courses
4. **Test direct messages** - send message from teacher to student
5. **Test group messages** - send message in a group

## Future Enhancements

Potential improvements:

1. **Notification Preferences**: Allow students to configure which notifications they want
2. **Notification Channels**: Support email, SMS in addition to push
3. **Batch Notifications**: Group similar notifications together
4. **Notification Templates**: Use templates for consistent messaging
5. **Analytics**: Track notification open rates and engagement
6. **Scheduled Notifications**: Support time-based notifications
