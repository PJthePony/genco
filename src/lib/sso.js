import { supabase } from './supabase'

// Bootstrap a Supabase session from a #sso= fragment handed off by the family
// hub. URL fragments don't hit server logs and are wiped before the user sees
// the address bar via history.replaceState.
export async function bootstrapSSO() {
  const hash = window.location.hash
  if (!hash.startsWith('#sso=')) return

  try {
    const encoded = hash.slice('#sso='.length)
    const payload = JSON.parse(atob(decodeURIComponent(encoded)))
    if (!payload.access_token || !payload.refresh_token) return

    await supabase.auth.setSession({
      access_token: payload.access_token,
      refresh_token: payload.refresh_token,
    })
    history.replaceState(null, '', location.pathname + location.search)
  } catch (e) {
    console.error('[sso] bootstrap failed:', e)
  }
}
