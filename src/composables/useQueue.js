import { ref, computed } from 'vue'
import { api } from './useApi'
import { avatarColor, getInitials, getOrg, timeAgo } from '../lib/formatters'

// Module-scope state (singleton)
const items = ref([])
const loading = ref(false)
const scanning = ref(false)
const error = ref(null)

// ── Action label mapping ──
const ACTION_LABELS = {
  reply: 'Reply',
  add_task: '+ Task',
  archive: 'Archive',
  unsubscribe: 'Unsubscribe',
  briefing: '+ Briefing',
  act: 'Act',
}

const ACTION_MESSAGES = {
  reply: 'Reply draft created',
  add_task: 'Task added to Tessio',
  archive: 'Archived',
  unsubscribe: 'Unsubscribed & archived',
  briefing: 'Added to Daily Briefing',
  act: 'Done',
}

/**
 * Map an API queue item to the card format the DecisionCard component expects.
 */
function toCard(item) {
  const action = item.aiRecommendedAction || 'archive'
  return {
    id: item.id,
    emailId: item.id,
    sender: item.fromName || item.fromEmail.split('@')[0],
    org: getOrg(item.fromEmail),
    initials: getInitials(item.fromName, item.fromEmail),
    avatarClass: avatarColor(item.fromEmail),
    time: timeAgo(item.receivedAt),
    priority: item.aiPriority === 'high' ? 'p-high' : item.aiPriority === 'medium' ? 'p-med' : 'p-low',
    subject: item.subject,
    summary: item.aiSummary || item.subject,
    action: ACTION_LABELS[action] || 'Archive',
    actionKey: action,
    actionMsg: ACTION_MESSAGES[action] || 'Done',
    cleared: false,
    hasBriefing: !['briefing'].includes(action),
    isUrgent: item.isUrgent,
    replyDraft: item.aiReplyDraft,
    taskTitle: item.aiTaskTitle,
    bodyHtml: item.bodyHtml,
    fromEmail: item.fromEmail,
    fromName: item.fromName,
    receivedAt: item.receivedAt,
  }
}

export function useQueue() {
  async function fetchQueue() {
    loading.value = true
    error.value = null
    try {
      const data = await api('/queue')
      items.value = (data.items || []).map(toCard)
    } catch (err) {
      error.value = err.message
      console.error('Failed to fetch queue:', err)
    } finally {
      loading.value = false
    }
  }

  async function scanInbox() {
    scanning.value = true
    error.value = null
    try {
      const data = await api('/emails/scan', { method: 'POST' })
      // Refresh the queue after scanning
      await fetchQueue()
      return data
    } catch (err) {
      error.value = err.message
      console.error('Scan failed:', err)
      throw err
    } finally {
      scanning.value = false
    }
  }

  async function executeAction(cardId, action, payload = {}) {
    try {
      const data = await api(`/queue/${cardId}/action`, {
        method: 'POST',
        body: JSON.stringify({ action, ...payload }),
      })
      return data
    } catch (err) {
      console.error('Action failed:', err)
      throw err
    }
  }

  const remaining = computed(() => items.value.filter(c => !c.cleared).length)
  const urgentCount = computed(() => items.value.filter(c => !c.cleared && c.isUrgent).length)
  const allCleared = computed(() => items.value.length > 0 && remaining.value === 0)

  return {
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
