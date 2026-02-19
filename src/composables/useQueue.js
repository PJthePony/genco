import { ref, computed } from 'vue'
import { api } from './useApi'
import { avatarColor, getInitials, getOrg, timeAgo } from '../lib/formatters'

// Module-scope state (singleton)
const items = ref([])
const loading = ref(false)
const scanning = ref(false)
const error = ref(null)

// ── Action label mapping (3 top-level actions) ──
const ACTION_LABELS = {
  reply: 'Reply',
  act: 'Act',
  archive: 'Archive',
  skip: 'Skip',
}

const ACTION_MESSAGES = {
  reply: 'Reply draft created',
  act: 'Done',
  archive: 'Archived',
  skip: 'Skipped',
}

const SUB_ACTION_LABELS = {
  unsubscribe: 'Unsubscribe',
  add_task: '+ Task',
  briefing: '+ Briefing',
}

const SUB_ACTION_MESSAGES = {
  unsubscribe: 'Unsubscribed & archived',
  add_task: 'Task added to Tessio',
  briefing: 'Added to Daily Briefing',
}

/**
 * Map an API email queue item to the card format the DecisionCard component expects.
 */
/**
 * Normalize old action values to the 3-action model.
 * Old emails may have top-level "unsubscribe", "add_task", or "briefing".
 */
function normalizeAction(rawAction, rawSubAction) {
  let action = rawAction || 'archive'
  let subAction = rawSubAction || null

  // Backward compat: old top-level actions → act + sub-action
  if (action === 'unsubscribe') { action = 'act'; subAction = 'unsubscribe' }
  if (action === 'add_task') { action = 'act'; subAction = 'add_task' }
  if (action === 'briefing') { action = 'act'; subAction = 'briefing' }

  return { action, subAction }
}

function toCard(item) {
  const { action, subAction } = normalizeAction(
    item.aiRecommendedAction,
    item.aiRecommendedSubAction,
  )
  return {
    id: item.id,
    emailId: item.id,
    type: 'email',
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
    subActionKey: subAction,
    subAction: subAction ? (SUB_ACTION_LABELS[subAction] || subAction) : null,
    subActionMsg: subAction ? (SUB_ACTION_MESSAGES[subAction] || 'Done') : null,
    cleared: false,
    hasBriefing: action !== 'act' || subAction !== 'briefing',
    isUrgent: item.isUrgent,
    replySummary: item.aiReplyDraft, // one-line reply direction (repurposed column)
    taskTitle: item.aiTaskTitle,
    bodyHtml: item.bodyHtml,
    messageText: null,
    fromEmail: item.fromEmail,
    fromPhone: null,
    fromName: item.fromName,
    receivedAt: item.receivedAt,
  }
}

/**
 * Map an API message queue item to the same card format.
 */
function toMessageCard(item) {
  const { action, subAction } = normalizeAction(
    item.aiRecommendedAction || 'skip',
    item.aiRecommendedSubAction,
  )
  return {
    id: item.id,
    emailId: null,
    type: 'message',
    sender: item.senderName || item.senderPhone,
    org: '',
    initials: getInitials(item.senderName, item.senderPhone),
    avatarClass: avatarColor(item.senderPhone),
    time: timeAgo(item.receivedAt),
    priority: item.aiPriority === 'high' ? 'p-high' : item.aiPriority === 'medium' ? 'p-med' : 'p-low',
    subject: null,
    summary: item.aiSummary || item.messageText?.slice(0, 120),
    action: ACTION_LABELS[action] || 'Skip',
    actionKey: action,
    actionMsg: ACTION_MESSAGES[action] || 'Done',
    subActionKey: subAction,
    subAction: subAction ? (SUB_ACTION_LABELS[subAction] || subAction) : null,
    subActionMsg: subAction ? (SUB_ACTION_MESSAGES[subAction] || 'Done') : null,
    cleared: false,
    hasBriefing: false,
    isUrgent: item.isUrgent,
    replySummary: item.aiReplyDraft,
    taskTitle: null,
    bodyHtml: null,
    messageText: item.messageText,
    fromEmail: null,
    fromPhone: item.senderPhone,
    fromName: item.senderName,
    receivedAt: item.receivedAt,
  }
}

export function useQueue() {
  async function fetchQueue() {
    loading.value = true
    error.value = null
    try {
      const [emailData, msgData] = await Promise.all([
        api('/queue'),
        api('/messages/queue').catch(() => ({ items: [] })),
      ])
      const emailCards = (emailData.items || []).map(toCard)
      const msgCards = (msgData.items || []).map(toMessageCard)
      // Merge and sort: urgent first, then by recency
      items.value = [...emailCards, ...msgCards].sort((a, b) => {
        if (a.isUrgent !== b.isUrgent) return b.isUrgent ? 1 : -1
        return new Date(b.receivedAt) - new Date(a.receivedAt)
      })
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
    // Route to the correct endpoint based on card type
    const card = items.value.find(c => c.id === cardId)
    const endpoint = card?.type === 'message'
      ? `/messages/${cardId}/action`
      : `/queue/${cardId}/action`

    try {
      const data = await api(endpoint, {
        method: 'POST',
        body: JSON.stringify({ action, ...payload }),
      })
      return data
    } catch (err) {
      console.error('Action failed:', err)
      throw err
    }
  }

  /**
   * Generate a full reply draft from a direction/summary string.
   * Returns { draft } with the full reply body.
   */
  async function generateDraft(cardId, direction) {
    try {
      const data = await api(`/queue/${cardId}/draft`, {
        method: 'POST',
        body: JSON.stringify({ direction }),
      })
      return data
    } catch (err) {
      console.error('Draft generation failed:', err)
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
    generateDraft,
  }
}
