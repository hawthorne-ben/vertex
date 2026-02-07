import { createClient } from '@/lib/supabase/client'

/**
 * Get authentication headers for API requests
 * Non-hook utility for use in API layer and non-component code
 *
 * @returns Promise resolving to headers object with Authorization
 * @throws {Error} If user is not authenticated
 *
 * @example
 * const headers = await getAuthHeaders()
 * const response = await fetch('/api/endpoint', { headers })
 */
export async function getAuthHeaders(): Promise<Record<string, string>> {
  const supabase = createClient()
  const { data: { session }, error } = await supabase.auth.getSession()

  if (error || !session) {
    throw new Error('Not authenticated')
  }

  return {
    'Authorization': `Bearer ${session.access_token}`
  }
}

/**
 * Authenticated fetch wrapper for non-hook contexts
 * Automatically adds Authorization header
 *
 * @param url - URL to fetch
 * @param options - Fetch options (headers will be merged with auth headers)
 * @returns Promise resolving to Response
 * @throws {Error} If user is not authenticated
 *
 * @example
 * const response = await authFetch('/api/recordings/batch-download', {
 *   method: 'POST',
 *   body: JSON.stringify({ recordingIds: ids })
 * })
 */
export async function authFetch(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const authHeaders = await getAuthHeaders()

  return fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      ...authHeaders
    }
  })
}
