import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Authenticated user and Supabase client for API routes
 */
export interface AuthContext {
  user: {
    id: string
    email?: string
    [key: string]: any
  }
  supabase: SupabaseClient
}

/**
 * Extract and validate auth token from request
 * Returns authenticated user and Supabase client, or error response
 */
export async function withAuth(
  request: NextRequest
): Promise<{ data: AuthContext } | { error: NextResponse }> {
  const authHeader = request.headers.get('authorization')

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return {
      error: NextResponse.json(
        { error: 'Unauthorized - No auth token' },
        { status: 401 }
      )
    }
  }

  const token = authHeader.replace('Bearer ', '')

  // Create Supabase client with service role for server-side operations
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data: { user }, error: authError } = await supabase.auth.getUser(token)

  if (authError || !user) {
    return {
      error: NextResponse.json(
        { error: 'Unauthorized - Invalid token' },
        { status: 401 }
      )
    }
  }

  return {
    data: {
      user,
      supabase
    }
  }
}

/**
 * Helper to create a Supabase client (without auth)
 * Use withAuth() for authenticated routes
 */
export function createServerSupabaseClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}
