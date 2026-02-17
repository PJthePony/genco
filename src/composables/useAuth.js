import { ref, computed } from 'vue'
import { supabase } from '../lib/supabase'

const LUCA_API = 'https://luca.tanzillo.ai'

// Module-scope state (singleton)
const user = ref(null)
const session = ref(null)
const loading = ref(true)
let initialized = false

/**
 * Sync the Supabase session to a shared .tanzillo.ai cookie
 * so Luca (luca.tanzillo.ai) can read it too.
 */
function syncSessionCookie(newSession, redirect = false) {
  if (!newSession) return

  const params = new URLSearchParams({
    token: newSession.access_token,
    refresh: newSession.refresh_token,
    returnTo: window.location.origin + window.location.pathname,
  })

  if (redirect) {
    window.location.href = `${LUCA_API}/auth/session?${params}`
  } else {
    // Silently update the cookie via fetch (for token refreshes)
    fetch(`${LUCA_API}/auth/session/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: newSession.access_token,
        refresh: newSession.refresh_token,
      }),
    }).catch(() => {})
  }
}

export function useAuth() {
  const isAuthenticated = computed(() => !!user.value)

  const initialize = () => {
    if (initialized) {
      return Promise.resolve()
    }
    initialized = true

    return new Promise((resolve) => {
      // Get the initial session
      supabase.auth.getSession().then(({ data: { session: currentSession } }) => {
        session.value = currentSession
        user.value = currentSession?.user ?? null
        loading.value = false
        resolve()
      })

      // Listen for auth state changes (login, logout, token refresh)
      supabase.auth.onAuthStateChange((event, newSession) => {
        session.value = newSession
        user.value = newSession?.user ?? null
        loading.value = false

        if (event === 'SIGNED_IN' && newSession && !sessionStorage.getItem('luca_synced')) {
          sessionStorage.setItem('luca_synced', '1')
          if (!import.meta.env.DEV) {
            // Production: redirect through Luca to set the shared .tanzillo.ai cookie
            syncSessionCookie(newSession, true)
          }
        } else if (event === 'TOKEN_REFRESHED' && newSession) {
          if (!import.meta.env.DEV) {
            // Production: silently update the cookie
            syncSessionCookie(newSession, false)
          }
        }
      })
    })
  }

  const signIn = async (email) => {
    const redirectTo = import.meta.env.DEV
      ? 'http://localhost:5173'
      : 'https://genco.tanzillo.ai'

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: redirectTo
      }
    })
    if (error) throw error
  }

  const signOut = async () => {
    sessionStorage.removeItem('luca_synced')
    const { error } = await supabase.auth.signOut()
    if (error) throw error
    // Clear the shared auth cookie via Luca
    window.location.href = `${LUCA_API}/auth/logout?returnTo=${encodeURIComponent(window.location.origin + '/login')}`
  }

  return {
    user,
    session,
    loading,
    isAuthenticated,
    initialize,
    signIn,
    signOut
  }
}
