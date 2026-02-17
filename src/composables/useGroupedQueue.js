import { computed } from 'vue'
import { useQueue } from './useQueue'

const SECTIONS = [
  {
    key: 'action',
    label: 'Action Items',
    sublabel: 'Replies & tasks',
    actionKeys: ['reply', 'add_task'],
    defaultExpanded: true,
  },
  {
    key: 'archive',
    label: 'Archive',
    sublabel: 'Low priority — confirm & clear',
    actionKeys: ['archive', 'unsubscribe', 'act'],
    defaultExpanded: false,
  },
]

export function useGroupedQueue() {
  const {
    items, loading, scanning, error,
    remaining, urgentCount, allCleared,
    fetchQueue, scanInbox, executeAction,
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
  }
}
