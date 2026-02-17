import { supabase } from '../lib/supabase'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001'

/**
 * Get the current Supabase access token for API auth.
 * Returns the token string or null if not authenticated.
 */
async function getAccessToken() {
  const { data: { session } } = await supabase.auth.getSession()
  return session?.access_token ?? null
}

/**
 * Make an authenticated API call to the Genco backend.
 * Sends the Supabase access token as a Bearer token in the Authorization header,
 * and also sends cookies (for production where the .tanzillo.ai cookie works).
 * Retries transient failures (5xx, network errors) with exponential backoff.
 */
export async function api(path, options = {}) {
  const maxRetries = options.method === 'GET' || !options.method ? 2 : 0
  let lastError = null

  // Get the access token once per call (not per retry)
  const token = await getAccessToken()

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 500))
      }

      const res = await fetch(`${API_URL}${path}`, {
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
          ...options.headers,
        },
        ...options,
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        const err = new Error(body.error || `API error ${res.status}`)
        err.status = res.status

        // Retry on 5xx or 429, throw immediately on 4xx
        if (res.status >= 500 || res.status === 429) {
          lastError = err
          if (attempt < maxRetries) continue
        }
        throw err
      }

      return res.json()
    } catch (err) {
      // Network error (fetch failed) — retry if attempts remain
      if (!err.status && attempt < maxRetries) {
        lastError = err
        continue
      }
      throw err
    }
  }

  throw lastError
}
