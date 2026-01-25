# API Utilities

Shared utilities for Next.js API routes.

## Authentication

Use `withAuth()` for routes that require authentication:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/api/auth'

export async function GET(request: NextRequest) {
  // Authenticate user
  const authResult = await withAuth(request)
  if ('error' in authResult) return authResult.error

  const { user, supabase } = authResult.data

  // Now you have:
  // - user: Authenticated user object
  // - supabase: Supabase client for database queries

  // Example query with user context
  const { data } = await supabase
    .from('rides')
    .select('*')
    .eq('user_id', user.id)

  return NextResponse.json({ data })
}
```

### Benefits
- **DRY**: No repeated auth boilerplate
- **Consistent**: Same auth pattern across all routes
- **Type-safe**: Returns typed `AuthContext` with user and client
- **Error handling**: Automatically returns 401 responses

### Migration Guide

**Before:**
```typescript
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const authHeader = request.headers.get('authorization')
if (!authHeader || !authHeader.startsWith('Bearer ')) {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}

const token = authHeader.replace('Bearer ', '')
const { data: { user }, error } = await supabase.auth.getUser(token)
if (error || !user) {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}
```

**After:**
```typescript
const authResult = await withAuth(request)
if ('error' in authResult) return authResult.error

const { user, supabase } = authResult.data
```

## Future Additions

As patterns emerge, consider adding:
- **Query builders**: Common database queries (e.g., `getRideForUser(supabase, userId, rideId)`)
- **Validation helpers**: Request param/body validation
- **Response helpers**: Standardized success/error responses
- **Rate limiting**: Per-user API rate limits
