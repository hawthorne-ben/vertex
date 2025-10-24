---
layout: default
title: API Reference
description: Complete API reference for Vertex platform endpoints
---

# API Reference

Complete reference for all Vertex platform API endpoints.

## 📋 Contents

### [Authentication](/vertex/api-reference/auth/)
- OAuth integration
- Session management
- User profile endpoints

### [Data Upload](/vertex/api-reference/upload/)
- File upload endpoints
- Chunked upload API
- Progress tracking

### [Admin Endpoints](/vertex/api-reference/admin/)
- File management
- Storage cleanup
- System health checks

### [Health Checks](/vertex/api-reference/health/)
- System status endpoints
- Performance monitoring
- Error reporting

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
- **Authentication issues** → `auth.md`
- **Upload problems** → `upload.md`
- **Admin operations** → `admin.md`
- **Health monitoring** → `health.md`
