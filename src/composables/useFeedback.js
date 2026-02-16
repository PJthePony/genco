import { ref, computed } from 'vue'

const STORAGE_KEY = 'genco-feedback'

// ── State (module-scope singleton) ──
const feedbackLog = ref([])
let initialized = false

function loadFromStorage() {
  if (initialized) return
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) feedbackLog.value = JSON.parse(stored)
  } catch (e) {
    console.warn('Failed to load feedback log:', e)
  }
  initialized = true
}

function saveToStorage() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(feedbackLog.value))
  } catch (e) {
    console.warn('Failed to save feedback log:', e)
  }
}

export function useFeedback() {
  loadFromStorage()

  function addFeedback(entry) {
    feedbackLog.value.unshift(entry)
    saveToStorage()
  }

  function clearFeedback() {
    feedbackLog.value = []
    saveToStorage()
  }

  // ── Derived insights ──
  // How often does the user override each action type?
  const overrideStats = computed(() => {
    const stats = {}
    for (const entry of feedbackLog.value) {
      const key = entry.originalAction
      if (!stats[key]) stats[key] = { overridden: 0, replacedWith: {} }
      stats[key].overridden++
      const chosen = entry.chosenAction
      stats[key].replacedWith[chosen] = (stats[key].replacedWith[chosen] || 0) + 1
    }
    return stats
  })

  // Per-sender patterns: what does the user usually do with emails from X?
  const senderPatterns = computed(() => {
    const patterns = {}
    for (const entry of feedbackLog.value) {
      const sender = entry.sender
      if (!patterns[sender]) patterns[sender] = { overrides: 0, preferredActions: {} }
      patterns[sender].overrides++
      const chosen = entry.chosenAction
      patterns[sender].preferredActions[chosen] = (patterns[sender].preferredActions[chosen] || 0) + 1
    }
    return patterns
  })

  // Accuracy rate: how often does Genco get it right (approves vs changes)
  // This will be calculated once we also track approvals
  const totalOverrides = computed(() => feedbackLog.value.length)

  const feedbackWithReasons = computed(() =>
    feedbackLog.value.filter(e => e.reason)
  )

  return {
    feedbackLog,
    addFeedback,
    clearFeedback,
    overrideStats,
    senderPatterns,
    totalOverrides,
    feedbackWithReasons,
  }
}
