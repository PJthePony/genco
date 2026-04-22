import { computed } from 'vue'
import { useQueue } from './useQueue'

const SECTIONS = [
  {
    key: 'action',
    label: 'Action Items',
    sublabel: 'Replies & tasks',
    actionKeys: ['reply', 'act'],
    defaultExpanded: true,
  },
  {
    key: 'archive',
    label: 'Archive',
    sublabel: 'Low priority — confirm & clear',
    actionKeys: ['archive'],
    defaultExpanded: false,
  },
]

const ALL_VISIBLE_KEYS = SECTIONS.flatMap(s => s.actionKeys)

export function useGroupedQueue() {
  const {
    items, loading, scanning, error,
    fetchQueue, scanInbox, executeAction, overrideAction, generateDraft,
    fetchDirectionSuggestions, sendReply,
  } = useQueue()

  const sections = computed(() => {
    const active = items.value.filter(c => !c.cleared)

    return SECTIONS.map(def => {
      const cards = active
        .filter(c => def.actionKeys.includes(c.actionKey))
        .sort((a, b) => {
          if (a.isUrgent !== b.isUrgent) return b.isUrgent ? 1 : -1
          return new Date(b.receivedAt) - new Date(a.receivedAt)
        })

      return {
        ...def,
        cards,
        count: cards.length,
        urgentCount: cards.filter(c => c.isUrgent).length,
      }
    })
  })

  // Only count items that actually appear in a visible section
  const remaining = computed(() =>
    items.value.filter(c => !c.cleared && ALL_VISIBLE_KEYS.includes(c.actionKey)).length
  )
  const urgentCount = computed(() =>
    items.value.filter(c => !c.cleared && c.isUrgent && ALL_VISIBLE_KEYS.includes(c.actionKey)).length
  )
  const allCleared = computed(() => items.value.length > 0 && remaining.value === 0)

  return {
    sections,
    items,
    loading,
    scanning,
    error,
    remaining,
    urgentCount,
    allCleared,
    fetchQueue,
    scanInbox,
    executeAction,
    overrideAction,
    generateDraft,
    fetchDirectionSuggestions,
    sendReply,
  }
}
