/**
 * API Client
 *
 * Thin fetch wrapper that adds bearer auth from Supabase session.
 */

import { createClient } from './supabase';
import { API_URL } from '@env';

/**
 * Make an authenticated API request to the web server.
 */
export async function apiFetch<T = any>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();

  if (!session) {
    throw new Error('Not authenticated');
  }

  if (!API_URL) {
    throw new Error('API_URL not configured');
  }

  const baseUrl = API_URL.startsWith('http') ? API_URL : `https://${API_URL}`;
  const url = `${baseUrl}${path}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
      ...options.headers,
    },
  });

  if (!response.ok) {
    const contentType = response.headers.get('content-type');
    if (contentType?.includes('application/json')) {
      const body = await response.json();
      throw new Error(body.error || `API error ${response.status}`);
    }
    throw new Error(`API error ${response.status}`);
  }

  return response.json();
}
