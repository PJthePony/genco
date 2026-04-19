<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuth } from '../composables/useAuth'
import { useFeedback } from '../composables/useFeedback'
import { useGroupedQueue } from '../composables/useGroupedQueue'
import { useDigest } from '../composables/useDigest'
import { useNetwork } from '../composables/useNetwork'
import { useUnread } from '../composables/useUnread'
import { api } from '../composables/useApi'
import AppHeader from '../components/AppHeader.vue'
import ActionSection from '../components/ActionSection.vue'
import FollowUpSection from '../components/FollowUpSection.vue'
import DailyDigest from '../components/DailyDigest.vue'
import EmailModal from '../components/EmailModal.vue'
import SettingsModal from '../components/SettingsModal.vue'
import NetworkModal from '../components/NetworkModal.vue'
import ToastNotification from '../components/ToastNotification.vue'

const route = useRoute()
const router = useRouter()
const { signOut } = useAuth()
const { addFeedback, feedbackLog, overrideStats, totalOverrides, clearFeedback } = useFeedback()
const { sections, items: cards, loading, scanning, error, remaining, urgentCount, fetchQueue, scanInbox, executeAction, overrideAction, generateDraft: generateReplyDraft } = useGroupedQueue()
const { items: digestItems, fetchDigest, promoteItem } = useDigest()
const { followUps, followUpCount, fetchFollowUps, actOnFollowUp, generateDraft, saveDraftToGmail, sendFollowUpAsMessage, scanThreads, scanningThreads, scanProgress } = useNetwork()
const { markSeen, refreshCount, startPolling, stopPolling } = useUnread()

const actionSection = computed(() => sections.value.find(s => s.key === 'action'))
const archiveSection = computed(() => sections.value.find(s => s.key === 'archive'))

// Initial-load gate: only true while the first queue fetch is in flight and
// there's nothing on screen yet. Post-action refreshes also flip `loading`,
// so we guard on cards.length to avoid flicker during routine re-fetches.
const initialLoading = computed(() => loading.value && cards.value.length === 0)


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
    refreshCount()
    showToast('Snoozed')
  } catch (err) {
    showToast('Snooze failed')
  }
}

async function handleFollowUpDismiss(id) {
  try {
    await actOnFollowUp(id, 'dismiss')
    refreshCount()
    showToast('Dismissed')
  } catch (err) {
    showToast('Dismiss failed')
  }
}

async function handleFollowUpNoise(id) {
  try {
    await actOnFollowUp(id, 'noise')
    refreshCount()
    showToast('Blocked — sender removed from network')
  } catch (err) {
    showToast('Block failed')
  }
}

async function handleFollowUpDraft(id) {
  try {
    await generateDraft(id)
  } catch (err) {
    showToast('Draft generation failed')
  }
}

async function handleSaveDraft(id, body) {
  try {
    await saveDraftToGmail(id, body)
    refreshCount()
    showToast('Draft saved to Gmail')
  } catch (err) {
    showToast('Failed to save draft')
  }
}

async function handleSendMessage(id, body) {
  try {
    await sendFollowUpAsMessage(id, body)
    refreshCount()
    showToast('Message queued for sending')
  } catch (err) {
    showToast('Failed to queue message')
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

async function openDigestEmail(itemId) {
  const item = digestItems.value.find(d => d.id === itemId)
  if (!item) return

  const formattedDate = new Date(item.receivedAt).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit'
  })

  // If we already have the body cached, show it immediately
  if (item.bodyHtml) {
    activeEmail.value = {
      subject: item.subject || item.summary,
      from: item.fromName ? `${item.fromName} <${item.fromEmail}>` : item.fromEmail,
      to: 'pjtanzillo@gmail.com',
      date: formattedDate,
      body: item.bodyHtml,
    }
    emailModalOpen.value = true
    return
  }

  // Otherwise fetch the body (may re-fetch from Gmail if pruned)
  activeEmail.value = {
    subject: item.subject || item.summary,
    from: item.fromName ? `${item.fromName} <${item.fromEmail}>` : item.fromEmail,
    to: 'pjtanzillo@gmail.com',
    date: formattedDate,
    body: '<p style="color:var(--color-text-muted)">Loading…</p>',
  }
  emailModalOpen.value = true

  try {
    const data = await api(`/queue/${itemId}/body`)
    activeEmail.value = {
      ...activeEmail.value,
      body: data.body || '<p>(No content available)</p>',
    }
    // Cache it for next time
    item.bodyHtml = data.body
  } catch (err) {
    activeEmail.value = {
      ...activeEmail.value,
      body: '<p>(Failed to load email body)</p>',
    }
  }
}

function closeEmail() {
  emailModalOpen.value = false
}

// ── Decision Card Actions ──
async function approveCard(cardId, message, extra = {}) {
  const card = cards.value.find(c => c.id === cardId)
  if (!card) return

  try {
    // Reply flow: generate full draft from direction, then execute
    if (card.actionKey === 'reply' && extra.replyDirection !== undefined) {
      showToast('Generating draft…')
      const draftResult = await generateReplyDraft(cardId, extra.replyDirection)

      // iMessages: show the draft for review before sending
      if (card.type === 'message') {
        card.pendingReply = draftResult.draft
        return
      }

      // Emails: save as Gmail Draft (user reviews in Gmail)
      const result = await executeAction(cardId, 'reply', {
        replyBody: draftResult.draft,
      })
      card.cleared = true
      showToast('Reply draft created')
      return
    }

    // iMessage reply: user approved the reviewed draft text
    if (extra.approvedReply) {
      const result = await executeAction(cardId, 'reply', {
        replyBody: extra.approvedReply,
      })
      card.cleared = true
      showToast('Message queued')
      return
    }

    // Act flow: subAction comes from the picker
    if (card.actionKey === 'act' && extra.subAction) {
      const result = await executeAction(cardId, 'act', {
        subAction: extra.subAction,
        taskTitle: card.taskTitle,
      })
      card.cleared = true

      // Handle unsubscribe result
      if (result.unsubscribeMethod === 'one-click') {
        showToast('Unsubscribed (one-click)')
      } else if (result.unsubscribeMethod === 'mailto') {
        showToast('Unsubscribe email sent')
      } else if (result.unsubscribeMethod === 'url' && result.unsubscribeUrl) {
        showToast('Archived — open link to finish unsubscribing')
        window.open(result.unsubscribeUrl, '_blank', 'noopener')
      } else {
        const SUB_MSGS = { unsubscribe: 'Unsubscribed & archived', add_task: 'Task added to Tessio', briefing: 'Added to Daily Briefing' }
        showToast(SUB_MSGS[extra.subAction] || 'Done')
      }
      return
    }

    // Archive / other — use override action if user picked a different action
    const effectiveAction = extra.overrideAction || card.actionKey
    const payload = { taskTitle: card.taskTitle }
    // Always include subAction when executing 'act' to avoid server rejection
    if (effectiveAction === 'act') {
      payload.subAction = extra.subAction || card.subActionKey
    }
    const result = await executeAction(cardId, effectiveAction, payload)
    card.cleared = true

    // Handle unsubscribe result (backward compat for old cards)
    if (result.unsubscribeMethod === 'one-click') {
      showToast('Unsubscribed (one-click)')
    } else if (result.unsubscribeMethod === 'mailto') {
      showToast('Unsubscribe email sent')
    } else if (result.unsubscribeMethod === 'url' && result.unsubscribeUrl) {
      showToast('Archived — open link to finish unsubscribing')
      window.open(result.unsubscribeUrl, '_blank', 'noopener')
    } else {
      showToast(message || card.actionMsg)
    }
  } catch (err) {
    showToast(err.message || 'Action failed — try again')
  } finally {
    refreshCount()
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
  } finally {
    refreshCount()
  }
}

function handleOverride(entry) {
  // Persist the action override server-side (fire-and-forget)
  overrideAction(entry.cardId, entry.action, entry.subAction || null)
}

// ── Scan (inbox + threads in one button) ──
async function handleScan() {
  try {
    // Run sequentially — both endpoints refresh Gmail tokens independently,
    // and parallel refresh can race (one invalidates the other's token).
    await scanInbox()
    await scanThreads()
    markSeen()
    await fetchDigest()
    showToast('Scan complete')
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

  // Reply cards need individual review — skip them in bulk
  // Act cards with a sub-action can be bulk-approved
  const cardsToApprove = [...section.cards].filter(c => c.actionKey !== 'reply')
  const skippedReplies = section.cards.length - cardsToApprove.length

  if (cardsToApprove.length === 0) {
    showToast(`${skippedReplies} replies need individual review`)
    return
  }

  bulkProgress.value[sectionKey] = {
    active: true,
    completed: 0,
    total: cardsToApprove.length,
  }

  // Process in batches to avoid overwhelming Gmail API rate limits.
  // Firing all requests at once causes many to fail silently.
  const BATCH_SIZE = 5
  for (let i = 0; i < cardsToApprove.length; i += BATCH_SIZE) {
    const batch = cardsToApprove.slice(i, i + BATCH_SIZE)
    await Promise.allSettled(batch.map(async (card) => {
      try {
        if (card.actionKey === 'act' && card.subActionKey) {
          await executeAction(card.id, 'act', {
            subAction: card.subActionKey,
            taskTitle: card.taskTitle,
          })
        } else if (card.actionKey === 'act') {
          // act without sub-action — skip this card in bulk
          return
        } else {
          await executeAction(card.id, card.actionKey, {
            taskTitle: card.taskTitle,
          })
        }
        card.cleared = true
      } catch (err) {
        console.error(`Bulk action failed for ${card.id}:`, err)
      } finally {
        bulkProgress.value[sectionKey].completed++
      }
    }))
  }

  const successCount = cardsToApprove.filter(c => c.cleared).length
  const failCount = cardsToApprove.length - successCount

  bulkProgress.value[sectionKey] = { active: false, completed: 0, total: 0 }

  let msg = failCount === 0
    ? `${successCount} items processed`
    : `${successCount} done, ${failCount} failed`
  if (skippedReplies > 0) msg += ` (${skippedReplies} replies need review)`
  showToast(msg)
}

// ── Promote digest item to decision queue ──
async function promoteDigestItem(itemId) {
  try {
    await promoteItem(itemId)
    // Re-fetch queue to pick up the re-classified card
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
    pullDistance.value = 0 // snap back; the scan button shows "Loading"
    refreshing.value = true
    try {
      await handleScan()
    } finally {
      refreshing.value = false
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

  // Handle Gmail OAuth redirect
  if (route.query.gmail === 'connected') {
    settingsOpen.value = true
    showToast('Gmail connected')
    router.replace({ query: {} })
  } else if (route.query.gmail === 'error') {
    showToast('Gmail connection failed')
    router.replace({ query: {} })
  }

  await fetchQueue()
  markSeen()
  await fetchDigest()
  fetchFollowUps()
  loadBriefingSources()
  startPolling()
})

onUnmounted(() => {
  document.removeEventListener('touchstart', onTouchStart)
  document.removeEventListener('touchmove', onTouchMove)
  document.removeEventListener('touchend', onTouchEnd)
  stopPolling()
})
</script>

<template>
  <div class="app-container">
    <AppHeader @open-settings="settingsOpen = true" @logout="handleLogout" />

    <div class="app-body" :style="{ transform: `translateY(${pullDistance}px)` }"  >
      <div class="briefing-header">
        <div class="briefing-date">{{ dateStr }}</div>
        <h1>The Sit-Down</h1>
        <div class="briefing-stats">
          <div class="briefing-stat"><strong>{{ remaining }}</strong> to review</div>
          <div v-if="urgentCount > 0" class="briefing-stat urgent"><strong>{{ urgentCount }}</strong> urgent</div>
        </div>
      </div>

      <!-- Action buttons -->
      <div class="action-buttons">
        <button
          class="btn-scan"
          :class="{ scanning: scanning || refreshing || initialLoading }"
          @click="handleScan"
          :disabled="scanning || refreshing || initialLoading"
        >
          <svg v-if="!scanning && !refreshing && !initialLoading" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
          <span v-if="scanning || refreshing || initialLoading" class="scan-spinner"></span>
          {{ (refreshing || initialLoading) ? 'Loading' : (scanning ? 'Scanning…' : 'Scan') }}
        </button>
      </div>

      <!-- Error state -->
      <div v-if="error && cards.length === 0" class="error-state">
        <p>{{ error }}</p>
        <button class="btn-retry" @click="fetchQueue">Retry</button>
      </div>

      <!-- Daily Briefing -->
      <DailyDigest
        :items="digestItems"
        @manage-sources="settingsOpen = true"
        @promote="promoteDigestItem"
        @open-email="openDigestEmail"
      />

      <!-- Action Items (replies + tasks) -->
      <ActionSection
        v-if="actionSection"
        :section="actionSection"
        :bulk-progress="bulkProgress['action']"
        @approve="approveCard"
        @skip="skipCard"
        @open-email="openEmail"

        @override="handleOverride"
        @bulk-approve="handleBulkApprove"
      />

      <!-- Follow Up (proactive outreach) -->
      <FollowUpSection
        :items="followUps"
        :scanning="scanningThreads"
        :scan-progress="scanProgress"
        @draft="handleFollowUpDraft"
        @snooze="handleFollowUpSnooze"
        @dismiss="handleFollowUpDismiss"
        @noise="handleFollowUpNoise"
        @save-draft="handleSaveDraft"
        @send-imessage="handleSendMessage"
        @manage-network="networkModalOpen = true"
      />

      <!-- Archive (low priority cleanup) -->
      <ActionSection
        v-if="archiveSection"
        :section="archiveSection"
        :bulk-progress="bulkProgress['archive']"
        @approve="approveCard"
        @skip="skipCard"
        @open-email="openEmail"

        @override="handleOverride"
        @bulk-approve="handleBulkApprove"
      />
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
  max-width: 720px;
  margin: 0 auto;
  padding: 20px 16px 100px;
}

.briefing-header {
  margin-bottom: 28px;
}

.briefing-date {
  font-family: var(--font-sans);
  font-size: 0.72rem;
  font-weight: 700;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.2em;
  margin-bottom: 6px;
  font-feature-settings: "c2sc", "smcp";
}

.briefing-stats {
  display: flex;
  gap: 20px;
  margin-top: 18px;
  align-items: baseline;
}

.briefing-stat {
  display: flex;
  align-items: baseline;
  gap: 6px;
  font-family: var(--font-sans);
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  font-feature-settings: "c2sc", "smcp";
  color: var(--text-muted);
}

.briefing-stat strong {
  font-family: var(--font-serif);
  font-weight: 600;
  font-size: 1.1rem;
  letter-spacing: -0.015em;
  color: var(--text);
  font-variation-settings: 'opsz' 24, 'WONK' 1;
  font-variant-numeric: tabular-nums lining-nums;
}

.briefing-stat.urgent strong {
  color: var(--accent);
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
  padding: 8px 18px;
  border-radius: var(--radius-md);
  font-size: 0.875rem;
  font-weight: 600;
  font-family: inherit;
  letter-spacing: -0.005em;
  border: 1px solid var(--color-border);
  background: transparent;
  color: var(--color-primary);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.btn-scan:hover:not(:disabled) {
  background: var(--color-primary-ghost);
  border-color: var(--color-primary);
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

.error-state {
  text-align: center;
  padding: 40px 20px;
  color: var(--color-text-secondary);
  font-size: 0.82rem;
}

.btn-retry {
  margin-top: 12px;
  padding: 8px 18px;
  border-radius: var(--radius-md);
  font-size: 0.875rem;
  font-weight: 600;
  font-family: inherit;
  letter-spacing: -0.005em;
  border: 1px solid var(--color-border);
  background: transparent;
  color: var(--color-primary);
  cursor: pointer;
  transition: all var(--transition-fast);
}


@keyframes fadeIn {
  from { opacity: 0; transform: translateY(3px); }
  to { opacity: 1; transform: translateY(0); }
}

/* Pull-to-refresh: body translates down on pull for tactile feedback;
   when released past threshold, the scan button takes over with "Loading". */
.app-body {
  transition: transform 0.1s ease-out;
}

@media (max-width: 768px) {
  .app-body {
    padding: 1rem 1rem 80px;
  }

  .briefing-header {
    margin-bottom: 16px;
  }

  .briefing-stats {
    gap: 12px;
    margin-top: 10px;
  }

  .btn-scan {
    min-height: 44px;
  }

  .btn-retry {
    min-height: 44px;
  }

  .action-buttons {
    margin-bottom: 16px;
  }
}

@media (min-width: 769px) {
  .app-body {
    padding: 2rem 2rem 4rem;
  }
}
</style>
