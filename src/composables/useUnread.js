import { ref, onUnmounted } from 'vue'
import { api } from './useApi'

const POLL_INTERVAL_MS = 15 * 60 * 1000 // 15 minutes
const FAVICON_DEFAULT = '/favicon.svg'
const FAVICON_UNREAD = '/favicon-unread.svg'

// Module-scope state (singleton across components)
const unreadCount = ref(0)
const lastSeenCount = ref(0)
let pollTimer = null
let pollActive = false

/**
 * Swap the favicon <link> element's href.
 */
function setFavicon(href) {
  let link = document.querySelector("link[rel='icon']")
  if (!link) {
    link = document.createElement('link')
    link.rel = 'icon'
    link.type = 'image/svg+xml'
    document.head.appendChild(link)
  }
  if (link.href !== new URL(href, location.origin).href) {
    link.href = href
  }
}

/**
 * Update the document title and favicon based on unread state.
 */
function updateBadge() {
  const hasUnread = unreadCount.value > lastSeenCount.value

  // Title badge
  const baseTitle = 'Genco'
  if (hasUnread) {
    const newItems = unreadCount.value - lastSeenCount.value
    document.title = `(${newItems}) ${baseTitle}`
  } else {
    document.title = baseTitle
  }

  // Favicon badge
  setFavicon(hasUnread ? FAVICON_UNREAD : FAVICON_DEFAULT)
}

/**
 * Poll the server for the current actionable queue count.
 */
async function pollCount() {
  try {
    const data = await api('/queue/count')
    unreadCount.value = data.count ?? 0
    updateBadge()
  } catch {
    // Silently ignore poll failures (network blip, tab backgrounded, etc.)
  }
}

/**
 * Mark the current count as "seen" — clears the badge.
 * Call this when the user views the dashboard or fetches the full queue.
 */
function markSeen() {
  lastSeenCount.value = unreadCount.value
  updateBadge()
}

/**
 * Start polling. Idempotent — only one timer runs at a time.
 */
function startPolling() {
  if (pollActive) return
  pollActive = true

  // Initial poll
  pollCount()

  pollTimer = setInterval(pollCount, POLL_INTERVAL_MS)
}

/**
 * Stop polling.
 */
function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
  pollActive = false
}

/**
 * Re-fetch the count from the server immediately (e.g. after taking an action).
 */
function refreshCount() {
  pollCount()
}

export function useUnread() {
  return {
    unreadCount,
    markSeen,
    refreshCount,
    startPolling,
    stopPolling,
  }
}
