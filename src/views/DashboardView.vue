<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useAuth } from '../composables/useAuth'
import { useFeedback } from '../composables/useFeedback'
import { useGroupedQueue } from '../composables/useGroupedQueue'
import { useDigest } from '../composables/useDigest'
import { useNetwork } from '../composables/useNetwork'
import { api } from '../composables/useApi'
import AppHeader from '../components/AppHeader.vue'
import ActionSection from '../components/ActionSection.vue'
import FollowUpSection from '../components/FollowUpSection.vue'
import DailyDigest from '../components/DailyDigest.vue'
import EmailModal from '../components/EmailModal.vue'
import SettingsModal from '../components/SettingsModal.vue'
import NetworkModal from '../components/NetworkModal.vue'
import ToastNotification from '../components/ToastNotification.vue'

const { signOut } = useAuth()
const { addFeedback, feedbackLog, overrideStats, totalOverrides, clearFeedback } = useFeedback()
const { sections, items: cards, loading, scanning, error, remaining, urgentCount, allCleared, fetchQueue, scanInbox, executeAction } = useGroupedQueue()
const { items: digestItems, fetchDigest } = useDigest()
const { followUps, followUpCount, fetchFollowUps, actOnFollowUp, generateDraft } = useNetwork()

const actionSection = computed(() => sections.value.find(s => s.key === 'action'))
const archiveSection = computed(() => sections.value.find(s => s.key === 'archive'))

// ── Delayed section visibility ──
// When the last card in a section is cleared, keep the section visible
// for 400ms so the CompactRow's CSS exit animation can finish.
const showActionSection = ref(false)
const showArchiveSection = ref(false)
let actionHideTimer = null
let archiveHideTimer = null

watch(() => actionSection.value?.count, (count) => {
  clearTimeout(actionHideTimer)
  if (count > 0) {
    showActionSection.value = true
  } else {
    actionHideTimer = setTimeout(() => { showActionSection.value = false }, 400)
  }
}, { immediate: true })

watch(() => archiveSection.value?.count, (count) => {
  clearTimeout(archiveHideTimer)
  if (count > 0) {
    showArchiveSection.value = true
  } else {
    archiveHideTimer = setTimeout(() => { showArchiveSection.value = false }, 400)
  }
}, { immediate: true })

// ── Toast ──
const toastMessage = ref('')
const toastVisible = ref(false)
let toastTimer = null

function showToast(message) {
  toastMessage.value = message
  toastVisible.value = true
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { toastVisible.value = false }, 1600)
}

// ── Settings ──
const settingsOpen = ref(false)

// ── Network ──
const networkModalOpen = ref(false)

async function handleFollowUpSnooze(id, days) {
  try {
    await actOnFollowUp(id, 'snooze', days)
    showToast('Snoozed')
  } catch (err) {
    showToast('Snooze failed')
  }
}

async function handleFollowUpDismiss(id) {
  try {
    await actOnFollowUp(id, 'dismiss')
    showToast('Dismissed')
  } catch (err) {
    showToast('Dismiss failed')
  }
}

async function handleFollowUpDraft(id) {
  try {
    await generateDraft(id)
  } catch (err) {
    showToast('Draft generation failed')
  }
}

// ── Briefing Sources ──
const briefingSources = ref([])

async function loadBriefingSources() {
  try {
    const data = await api('/settings/briefing-sources')
    briefingSources.value = (data.sources || []).map(s => ({
      id: s.id,
      name: s.displayName,
      tag: s.tag || 'Update',
      tagClass: s.tag ? `tag-${s.tag.toLowerCase()}` : 'tag-update',
    }))
  } catch (err) {
    console.error('Failed to load briefing sources:', err)
  }
}

async function removeBriefingSource(index) {
  const source = briefingSources.value[index]
  try {
    await api(`/settings/briefing-sources/${source.id}`, { method: 'DELETE' })
    briefingSources.value.splice(index, 1)
    showToast(`${source.name} removed from briefing`)
  } catch (err) {
    showToast('Failed to remove source')
  }
}

// ── Email Modal ──
const emailModalOpen = ref(false)
const activeEmail = ref(null)

function openEmail(emailId) {
  const card = cards.value.find(c => c.id === emailId)
  if (card) {
    activeEmail.value = {
      subject: card.subject,
      from: card.fromName ? `${card.fromName} <${card.fromEmail}>` : card.fromEmail,
      to: 'pjtanzillo@gmail.com',
      date: new Date(card.receivedAt).toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit'
      }),
      body: card.bodyHtml || '<p>(No content)</p>',
    }
    emailModalOpen.value = true
  }
}

function closeEmail() {
  emailModalOpen.value = false
}

// ── Decision Card Actions ──
async function approveCard(cardId, message) {
  const card = cards.value.find(c => c.id === cardId)
  if (!card) return

  try {
    const result = await executeAction(cardId, card.actionKey, {
      replyBody: card.replyDraft,
      replyContext: card.replyContext || undefined,
      taskTitle: card.taskTitle,
    })
    card.cleared = true

    // Handle unsubscribe result — show appropriate message
    if (result.unsubscribeMethod === 'one-click') {
      showToast('Unsubscribed (one-click)')
    } else if (result.unsubscribeMethod === 'mailto') {
      showToast('Unsubscribe email sent')
    } else if (result.unsubscribeMethod === 'url' && result.unsubscribeUrl) {
      showToast('Archived — open link to finish unsubscribing')
      // Open the unsub URL in a new tab for the user
      window.open(result.unsubscribeUrl, '_blank', 'noopener')
    } else {
      showToast(message)
    }
  } catch (err) {
    showToast(err.message || 'Action failed — try again')
  }
}

async function skipCard(cardId) {
  try {
    await executeAction(cardId, 'skip')
    const card = cards.value.find(c => c.id === cardId)
    if (card) card.cleared = true
    showToast('Skipped')
  } catch (err) {
    showToast('Skip failed')
  }
}

async function handleFeedback(entry) {
  // Map the chosen display label back to the backend action key
  // and update the card BEFORE the async call so approveCard
  // (which fires synchronously after this) reads the new key
  const ACTION_KEY_MAP = {
    'Reply': 'reply',
    '+ Task': 'add_task',
    'Archive': 'archive',
    'Unsubscribe': 'unsubscribe',
    '+ Briefing': 'briefing',
    'Act': 'act',
  }

  const card = cards.value.find(c => c.id === entry.cardId)
  if (card) {
    const newKey = ACTION_KEY_MAP[entry.chosenAction]
    if (newKey) {
      card.actionKey = newKey
    }
    if (entry.replyContext) {
      card.replyContext = entry.replyContext
    }
  }

  // Also update local state
  addFeedback(entry)

  // Save feedback to backend (fire-and-forget, doesn't block approve)
  try {
    await api('/feedback', {
      method: 'POST',
      body: JSON.stringify({
        emailQueueId: entry.cardId,
        sender: entry.sender,
        originalAction: entry.originalAction,
        chosenAction: entry.chosenAction,
        reason: entry.reason,
      }),
    })
  } catch (err) {
    console.error('Failed to save feedback:', err)
  }
}

// ── Scan ──
async function handleScan() {
  try {
    await scanInbox()
    await fetchDigest()
    showToast('Inbox scanned')
  } catch (err) {
    showToast('Scan failed — check Gmail connection')
  }
}

// ── Date ──
const today = new Date()
const dateStr = today.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })

function handleLogout() {
  signOut()
}

// ── Bulk Approve ──
const bulkProgress = ref({})

async function handleBulkApprove(sectionKey) {
  const section = sections.value.find(s => s.key === sectionKey)
  if (!section || section.count === 0) return

  const cardsToApprove = [...section.cards]
  bulkProgress.value[sectionKey] = {
    active: true,
    completed: 0,
    total: cardsToApprove.length,
  }

  const promises = cardsToApprove.map(async (card) => {
    try {
      await executeAction(card.id, card.actionKey, {
        replyBody: card.replyDraft,
        replyContext: card.replyContext || undefined,
        taskTitle: card.taskTitle,
      })
      card.cleared = true
    } catch (err) {
      console.error(`Bulk action failed for ${card.id}:`, err)
    } finally {
      bulkProgress.value[sectionKey].completed++
    }
  })

  await Promise.allSettled(promises)

  const successCount = cardsToApprove.filter(c => c.cleared).length
  const failCount = cardsToApprove.length - successCount

  bulkProgress.value[sectionKey] = { active: false, completed: 0, total: 0 }

  if (failCount === 0) {
    showToast(`${successCount} items processed`)
  } else {
    showToast(`${successCount} done, ${failCount} failed`)
  }
}

// ── Promote digest item to decision queue ──
async function promoteDigestItem(itemId) {
  try {
    await api(`/queue/${itemId}/promote`, { method: 'POST' })
    // Remove from digest, refresh queue to show the new card
    digestItems.value = digestItems.value.filter(d => d.id !== itemId)
    await fetchQueue()
    showToast('Moved to action queue')
  } catch (err) {
    showToast(err.message || 'Failed to promote item')
  }
}

// ── Pull-to-refresh ──
const pullDistance = ref(0)
const pulling = ref(false)
const refreshing = ref(false)
let startY = 0

function onTouchStart(e) {
  if (window.scrollY === 0 && !refreshing.value && !scanning.value) {
    startY = e.touches[0].clientY
    pulling.value = true
  }
}

function onTouchMove(e) {
  if (!pulling.value) return
  const diff = e.touches[0].clientY - startY
  if (diff > 0) {
    pullDistance.value = Math.min(diff * 0.4, 80)
  }
}

async function onTouchEnd() {
  if (!pulling.value) return
  pulling.value = false

  if (pullDistance.value > 50) {
    refreshing.value = true
    pullDistance.value = 40 // hold at spinner position
    try {
      await handleScan()
    } finally {
      refreshing.value = false
      pullDistance.value = 0
    }
  } else {
    pullDistance.value = 0
  }
}

// ── Init ──
onMounted(async () => {
  document.addEventListener('touchstart', onTouchStart, { passive: true })
  document.addEventListener('touchmove', onTouchMove, { passive: true })
  document.addEventListener('touchend', onTouchEnd)

  await fetchQueue()
  await fetchDigest()
  fetchFollowUps()
  loadBriefingSources()
})

onUnmounted(() => {
  document.removeEventListener('touchstart', onTouchStart)
  document.removeEventListener('touchmove', onTouchMove)
  document.removeEventListener('touchend', onTouchEnd)
  clearTimeout(actionHideTimer)
  clearTimeout(archiveHideTimer)
})
</script>

<template>
  <div class="app-container">
    <!-- Pull-to-refresh indicator -->
    <div class="pull-indicator" :style="{ transform: `translateY(${pullDistance}px)`, opacity: pullDistance > 10 ? 1 : 0 }">
      <span class="pull-spinner" :class="{ active: refreshing }"></span>
      <span class="pull-text">{{ refreshing ? 'Refreshing…' : 'Pull to refresh' }}</span>
    </div>

    <AppHeader @open-settings="settingsOpen = true" @logout="handleLogout" />

    <div class="app-body" :style="{ transform: `translateY(${pullDistance}px)` }"  >
      <div class="briefing-header">
        <div class="briefing-date">{{ dateStr }}</div>
        <h1 class="briefing-title">Morning Briefing</h1>
        <div class="briefing-stats">
          <div class="briefing-stat"><strong>{{ remaining }}</strong> to review</div>
          <div v-if="urgentCount > 0" class="briefing-stat urgent"><strong>{{ urgentCount }}</strong> urgent</div>
        </div>
      </div>

      <!-- Action buttons -->
      <div class="action-buttons">
        <button class="btn-scan" :class="{ scanning }" @click="handleScan" :disabled="scanning">
          <svg v-if="!scanning" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
          <span v-if="scanning" class="scan-spinner"></span>
          {{ scanning ? 'Scanning…' : 'Scan inbox' }}
        </button>
      </div>

      <!-- Loading state -->
      <div v-if="loading && cards.length === 0" class="loading-state">
        <p>Loading your queue…</p>
      </div>

      <!-- Error state -->
      <div v-if="error && cards.length === 0" class="error-state">
        <p>{{ error }}</p>
        <button class="btn-retry" @click="fetchQueue">Retry</button>
      </div>

      <!-- Action Items (replies + tasks) -->
      <ActionSection
        v-if="showActionSection"
        :section="actionSection"
        :bulk-progress="bulkProgress['action']"
        @approve="approveCard"
        @skip="skipCard"
        @open-email="openEmail"
        @feedback="handleFeedback"
        @bulk-approve="handleBulkApprove"
      />

      <!-- Follow Up (proactive outreach) -->
      <FollowUpSection
        :items="followUps"
        @draft="handleFollowUpDraft"
        @snooze="handleFollowUpSnooze"
        @dismiss="handleFollowUpDismiss"
        @manage-network="networkModalOpen = true"
      />

      <!-- Daily Digest -->
      <DailyDigest
        v-if="digestItems.length > 0"
        :items="digestItems"
        @manage-sources="settingsOpen = true"
        @promote="promoteDigestItem"
      />

      <!-- Archive (low priority cleanup) -->
      <ActionSection
        v-if="showArchiveSection"
        :section="archiveSection"
        :bulk-progress="bulkProgress['archive']"
        @approve="approveCard"
        @skip="skipCard"
        @open-email="openEmail"
        @feedback="handleFeedback"
        @bulk-approve="handleBulkApprove"
      />

      <div v-if="allCleared" class="empty-state visible">
        <h2>All clear, Don.</h2>
        <p>You've handled everything. Check Gmail drafts when you're ready.</p>
      </div>

      <div v-if="!loading && cards.length === 0 && !allCleared" class="empty-state visible">
        <h2>Nothing here yet.</h2>
        <p>Hit "Scan inbox" to pull in your unread emails.</p>
      </div>
    </div>

    <EmailModal
      :open="emailModalOpen"
      :email="activeEmail"
      @close="closeEmail"
    />

    <SettingsModal
      :open="settingsOpen"
      :sources="briefingSources"
      :feedback-log="feedbackLog"
      :override-stats="overrideStats"
      :total-overrides="totalOverrides"
      @close="settingsOpen = false"
      @remove-source="removeBriefingSource"
      @add-source="loadBriefingSources"
      @clear-feedback="clearFeedback"
    />

    <NetworkModal
      :open="networkModalOpen"
      @close="networkModalOpen = false"
    />

    <ToastNotification :message="toastMessage" :visible="toastVisible" />
  </div>
</template>

<style scoped>
.app-container {
  min-height: 100vh;
}

.app-body {
  max-width: 540px;
  margin: 0 auto;
  padding: 20px 16px 100px;
}

.briefing-header {
  margin-bottom: 20px;
}

.briefing-date {
  font-size: 0.7rem;
  font-weight: 500;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin-bottom: 4px;
}

.briefing-title {
  font-size: 1.15rem;
  font-weight: 600;
  letter-spacing: -0.02em;
  margin-bottom: 2px;
}

.briefing-stats {
  display: flex;
  gap: 16px;
  margin-top: 12px;
}

.briefing-stat {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.78rem;
  color: var(--color-text-secondary);
}

.briefing-stat strong {
  font-weight: 600;
  color: var(--color-text);
}

.briefing-stat.urgent strong {
  color: var(--color-accent);
}

.action-buttons {
  display: flex;
  gap: 8px;
  margin-bottom: 20px;
}

.btn-scan {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 9px 18px;
  border-radius: var(--radius-md);
  font-size: 0.78rem;
  font-weight: 500;
  font-family: inherit;
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.btn-scan:hover:not(:disabled) {
  border-color: var(--color-accent-border);
  color: var(--color-accent);
}

.btn-scan:disabled {
  opacity: 0.6;
  cursor: default;
}

.btn-scan.scanning {
  color: var(--color-accent);
  border-color: var(--color-accent-border);
}

.scan-spinner {
  width: 14px;
  height: 14px;
  border: 2px solid var(--color-accent-border);
  border-top-color: var(--color-accent);
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.loading-state,
.error-state {
  text-align: center;
  padding: 40px 20px;
  color: var(--color-text-secondary);
  font-size: 0.82rem;
}

.btn-retry {
  margin-top: 12px;
  padding: 8px 16px;
  border-radius: var(--radius-md);
  font-size: 0.78rem;
  font-family: inherit;
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  color: var(--color-text-secondary);
  cursor: pointer;
}

.empty-state {
  text-align: center;
  padding: 60px 20px;
  animation: fadeIn 0.4s ease;
}

.empty-state h2 {
  font-size: 1.15rem;
  font-weight: 600;
  letter-spacing: -0.02em;
  margin-bottom: 6px;
}

.empty-state p {
  font-size: 0.82rem;
  color: var(--color-text-secondary);
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(3px); }
  to { opacity: 1; transform: translateY(0); }
}

/* ── Pull-to-refresh ── */
.pull-indicator {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 12px;
  z-index: 100;
  transition: opacity 0.2s ease;
  pointer-events: none;
}

.pull-spinner {
  width: 16px;
  height: 16px;
  border: 2px solid var(--color-border);
  border-top-color: var(--color-accent);
  border-radius: 50%;
}

.pull-spinner.active {
  animation: spin 0.6s linear infinite;
}

.pull-text {
  font-size: 0.72rem;
  color: var(--color-text-muted);
  font-weight: 500;
}

.app-body {
  transition: transform 0.1s ease-out;
}

@media (min-width: 641px) {
  .app-body {
    padding: 28px 20px 100px;
  }
}
</style>
