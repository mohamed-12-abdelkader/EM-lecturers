# Scientific Chatbot API — Students

API documentation for **student** use of the Scientific Chatbot service: asking questions and retrieving chat history for a specific course.

---

## Overview

Students can:

- **Ask** questions to the scientific chatbot regarding a specific course. The chatbot answers contextually using the study material uploaded by the teacher. Students can also attach multiple images to their question.
- **Get History** of their previous conversations with the chatbot for a specific course.

**Base URL:** `http://localhost:8000/api/scientific-chatbot` (or your API host)

**Authentication:** All endpoints require a Bearer token. Role: `student`.

```
Authorization: Bearer <your_token>
```

---

## Endpoints

### 1. Ask a question

Ask a textual question to the chatbot, optionally attaching up to 5 images. The response includes the generated text answer and the retrieved text chunks from the course materials.

| | |
|---|---|
| **Method** | `POST` |
| **Path** | `/courses/:courseId/ask` |
| **Auth** | Student |
| **Content-Type** | `multipart/form-data` |

**Path parameters**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `courseId` | integer | Yes | Course ID |

**Form body**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `question` | string | Yes | The textual question to ask the chatbot. |
| `images` | file[] | No | Up to 5 image files attached to the message. Allowed MIME types: `image/*`. Max size: 5MB per image. |

**Success (200 OK)**

```json
{
  "answer": "The speed of light in a vacuum is approximately 299,792 kilometers per second.",
  "retrieved_chunks": [
    {
      "chunk_text": "The speed of light in a vacuum is exactly 299,792,458 metres per second...",
      "file_id": 12,
      "chunk_index": 4
    }
  ]
}
```

**Errors**

| Status | Body |
|--------|------|
| 400 | `{ "error": "Question is required" }` |
| 404 | `{ "error": "This course does not have uploaded content yet. Please ask your teacher to upload course materials." }` |
| 500 | `{ "error": "Error answering question" }` |
| 503 | `{ "error": "Answer service is temporarily unavailable. Please try again later." }` |

**Example (cURL)**

```bash
curl -X POST "http://localhost:8000/api/scientific-chatbot/courses/5/ask" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "question=What is the speed of light?" \
  -F "images=@/path/to/image1.png" \
  -F "images=@/path/to/image2.jpg"
```

---

### 2. Get chat history

Retrieve the student's conversation history with the scientific chatbot for a specific course. Supports pagination using the `limit` and `beforeId` query parameters.

| | |
|---|---|
| **Method** | `GET` |
| **Path** | `/courses/:courseId/history` |
| **Auth** | Student |

**Path parameters**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `courseId` | integer | Yes | Course ID |

**Query parameters**

| Name | Type | Required | Description | Default |
|------|------|----------|-------------|---------|
| `limit` | integer | No | Number of messages to fetch | `50` |
| `beforeId` | integer | No | Used for pagination. Fetch messages with an ID strictly less than `beforeId`. | `undefined` |

**Success (200 OK)**

```json
{
  "history": [
    {
      "id": 150,
      "student_id": 1234,
      "course_id": 5,
      "question": "What is the speed of light?",
      "rewritten_question": "What is the speed of light?",
      "answer": "The speed of light in a vacuum is approximately 299,792 kilometers per second.",
      "retrieved_chunks": [
        {
          "chunk_text": "The speed of light in a vacuum is exactly 299,792,458 metres per second...",
          "file_id": 12,
          "chunk_index": 4
        }
      ],
      "images": ["uploads/chat-images/chat-image-1712000000000.png"],
      "created_at": "2024-04-01T12:00:00.000Z"
    }
  ]
}
```

**Errors**

| Status | Body |
|--------|------|
| 500 | `{ "error": "Error getting chat history" }` |

**Example (cURL)**

```bash
curl -X GET "http://localhost:8000/api/scientific-chatbot/courses/5/history?limit=20&beforeId=150" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

---

## Summary

| Action | Method | Path |
|--------|--------|------|
| Ask question | POST | `/courses/:courseId/ask` |
| Get history | GET | `/courses/:courseId/history` |

All requests require `Authorization: Bearer <token>` belonging to a user with the `student` role.
