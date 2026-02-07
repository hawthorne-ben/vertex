import { useCallback, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

/**
 * Authenticated fetch response with type-safe JSON parsing
 */
export interface AuthFetchResponse<T = any> extends Response {
  json(): Promise<T>
}

/**
 * Hook that provides an authenticated fetch function
 * Automatically adds Authorization header with session token
 * Eliminates duplicate auth boilerplate across hooks
 *
 * @returns Object with authFetch function and authentication state
 * @throws {Error} If user is not authenticated
 *
 * @example
 * const { authFetch, isAuthenticated } = useAuthFetch()
 *
 * const response = await authFetch('/api/rides/123/samples')
 * const data = await response.json()
 *
 * @example
 * // With POST request
 * const response = await authFetch('/api/rides/batch-delete', {
 *   method: 'POST',
 *   body: JSON.stringify({ rideIds: ['1', '2'] })
 * })
 */
export function useAuthFetch() {
  const [isAuthenticated, setIsAuthenticated] = useState(true)

  const authFetch = useCallback(async (
    url: string,
    options: RequestInit = {}
  ): Promise<Response> => {
    const supabase = createClient()
    const { data: { session }, error: sessionError } = await supabase.auth.getSession()

    if (sessionError || !session) {
      setIsAuthenticated(false)
      throw new Error('Not authenticated')
    }

    return fetch(url, {
      ...options,
      headers: {
        ...options.headers,
        'Authorization': `Bearer ${session.access_token}`
      }
    })
  }, [])

  return { authFetch, isAuthenticated }
}
