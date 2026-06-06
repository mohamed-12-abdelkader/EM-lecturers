# Scientific Chatbot API — Teachers

API documentation for **teacher and admin** use of the Scientific Chatbot service: uploading and managing course content files and embeddings. Student endpoints (ask, history) are not covered here.

---

## Overview

Teachers and admins can:

- **Upload** course content files (`.txt`, `.md`, `.pdf`) for a course. Files are chunked and stored as vector embeddings for RAG.
- **List** all content files for a course.
- **Delete** a content file and its embeddings.
- **Reset embeddings** for a course (delete and regenerate from existing files).

**Base URL:** `http://localhost:8000/api/scientific-chatbot` (or your API host)

**Authentication:** All endpoints require a Bearer token. Roles: `teacher` or `admin`.

```
Authorization: Bearer <your_token>
```

- **Teacher:** Can manage only courses where they are the course teacher (`course.teacher_id`).
- **Admin:** Can manage any course (no ownership check).

---

## Endpoints

### 1. Upload course content file

Upload a text/markdown/PDF file. It is processed, chunked, and stored as embeddings for the scientific chatbot.

| | |
|---|---|
| **Method** | `POST` |
| **Path** | `/courses/:courseId/files` |
| **Auth** | Teacher or Admin |
| **Content-Type** | `multipart/form-data` |

**Path parameters**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `courseId` | integer | Yes | Course ID |

**Form body**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `file` | file | Yes | Course content file. Allowed: `.txt`, `.md`, `.pdf`. Max size: 10MB. MIME: `text/plain`, `text/markdown`, `application/pdf` |

**Success (201 Created)**

```json
{
  "message": "File uploaded and processed successfully",
  "file": {
    "id": 1,
    "course_id": 5,
    "teacher_id": 10,
    "file_name": "lecture-notes.txt",
    "file_path": "uploads/course-content/scientific-content-1234567890.txt",
    "file_size": 45678,
    "file_type": "text/plain",
    "content_text": "Course content text...",
    "uploaded_at": "2024-01-15T10:00:00Z",
    "updated_at": "2024-01-15T10:00:00Z"
  }
}
```

**Errors**

| Status | Body |
|--------|------|
| 400 | `{ "error": "No file uploaded" }` or file read error |
| 403 | `{ "error": "You do not have permission to upload files for this course" }` |
| 404 | `{ "error": "Course not found" }` |
| 500 | `{ "error": "Error uploading file" }` |

**Example (cURL)**

```bash
curl -X POST "http://localhost:8000/api/scientific-chatbot/courses/5/files" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "file=@lecture-notes.txt"
```

---

### 2. List course content files

Return all content files uploaded for a course.

| | |
|---|---|
| **Method** | `GET` |
| **Path** | `/courses/:courseId/files` |
| **Auth** | Teacher or Admin |

**Path parameters**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `courseId` | integer | Yes | Course ID |

**Success (200 OK)**

```json
{
  "files": [
    {
      "id": 1,
      "course_id": 5,
      "teacher_id": 10,
      "file_name": "lecture-notes.txt",
      "file_path": "uploads/course-content/scientific-content-1234567890.txt",
      "file_size": 45678,
      "file_type": "text/plain",
      "content_text": "Course content text...",
      "uploaded_at": "2024-01-15T10:00:00Z",
      "updated_at": "2024-01-15T10:00:00Z"
    }
  ]
}
```

**Errors**

| Status | Body |
|--------|------|
| 403 | `{ "error": "You do not have permission to view files for this course" }` |
| 404 | `{ "error": "Course not found" }` |
| 500 | `{ "error": "Error listing files" }` |

**Example (cURL)**

```bash
curl -X GET "http://localhost:8000/api/scientific-chatbot/courses/5/files" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

---

### 3. Delete course content file

Delete a content file and its associated embeddings. Only the file owner (or admin) can delete.

| | |
|---|---|
| **Method** | `DELETE` |
| **Path** | `/files/:fileId` |
| **Auth** | Teacher or Admin |

**Path parameters**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `fileId` | integer | Yes | Content file ID (from upload or list response) |

**Success (200 OK)**

```json
{
  "message": "File deleted successfully"
}
```

**Errors**

| Status | Body |
|--------|------|
| 403 | `{ "error": "You do not have permission to delete this file" }` (or similar) |
| 404 | `{ "error": "File not found" }` |
| 500 | `{ "error": "Error deleting file" }` |

**Example (cURL)**

```bash
curl -X DELETE "http://localhost:8000/api/scientific-chatbot/files/1" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

---

### 4. Reset course embeddings

Delete all embeddings for the course and regenerate them from the current uploaded files. Use when you need to re-process all content (e.g. after changing chunking or model).

| | |
|---|---|
| **Method** | `POST` |
| **Path** | `/courses/:courseId/reset-embeddings` |
| **Auth** | Teacher or Admin |

**Path parameters**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `courseId` | integer | Yes | Course ID |

**Success (200 OK)**

```json
{
  "message": "Embeddings reset successfully"
}
```

**Errors**

| Status | Body |
|--------|------|
| 403 | `{ "error": "You do not have permission to reset embeddings for this course" }` |
| 404 | `{ "error": "Course not found" }` |
| 500 | `{ "error": "Error resetting embeddings" }` |

**Example (cURL)**

```bash
curl -X POST "http://localhost:8000/api/scientific-chatbot/courses/5/reset-embeddings" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

---

## Summary

| Action | Method | Path |
|--------|--------|------|
| Upload file | POST | `/courses/:courseId/files` |
| List files | GET | `/courses/:courseId/files` |
| Delete file | DELETE | `/files/:fileId` |
| Reset embeddings | POST | `/courses/:courseId/reset-embeddings` |

All requests require `Authorization: Bearer <token>` with a user that has role `teacher` or `admin`. Teachers are restricted to courses they teach; admins can access any course.
