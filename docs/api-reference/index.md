---
layout: default
title: API Reference
description: Complete API reference for Vertex platform endpoints
nav_order: 5
---

# API Reference

Complete reference for all Vertex platform API endpoints.

## 📋 Contents

### [Data Upload API]({{ site.baseurl }}/api-reference/upload.html)
- File upload endpoints
- Chunked upload API
- Progress tracking

---

## Base URL

All API endpoints are relative to your deployment URL:
- **Production**: `https://your-app.vercel.app/api`
- **Development**: `http://localhost:3000/api`

---

## Authentication

All API endpoints require authentication via Supabase Auth. Include the session token in the Authorization header:

```http
Authorization: Bearer <session_token>
```

---

## Common Response Formats

### Success Response
```json
{
  "success": true,
  "data": { ... },
  "message": "Operation completed successfully"
}
```

### Error Response
```json
{
  "success": false,
  "error": "Error message",
  "code": "ERROR_CODE"
}
```

---

## Rate Limiting

- **Upload endpoints**: 10 requests per minute
- **Data retrieval**: 100 requests per minute
- **Admin endpoints**: 5 requests per minute

---

## 🔍 For AI Reference

When discussing API topics, refer to:
- **Upload problems** → `upload.md`
