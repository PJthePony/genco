<script setup>
import { ref, computed, watch, nextTick } from 'vue'

const props = defineProps({
  card: Object,
})

const emit = defineEmits(['approve', 'skip', 'open-email', 'override'])

// ── Reply two-step state ──
const reviewingReply = ref(false)
const replySummaryText = ref('')
const reviewTextarea = ref(null)

// ── iMessage draft review state ──
const reviewingDraft = ref(false)
const draftText = ref('')
const draftTextarea = ref(null)

// When the parent sets pendingReply on the card, enter draft review mode
watch(() => props.card.pendingReply, (val) => {
  if (val) {
    draftText.value = val
    reviewingReply.value = false
    reviewingDraft.value = true
    nextTick(() => draftTextarea.value?.focus())
  }
})

// ── All available actions for the flat palette ──
const ALL_ACTIONS = [
  { key: 'reply', actionKey: 'reply', label: 'Reply', icon: 'reply' },
  { key: 'add_task', actionKey: 'act', label: '+ Task', icon: 'task', subAction: 'add_task' },
  { key: 'briefing', actionKey: 'act', label: '+ Briefing', icon: 'book', subAction: 'briefing' },
  { key: 'unsubscribe', actionKey: 'act', label: 'Unsubscribe', icon: 'bolt', subAction: 'unsubscribe', emailOnly: true },
  { key: 'archive', actionKey: 'archive', label: 'Archive', icon: 'archive', emailOnly: true },
  { key: 'dismiss', actionKey: 'skip', label: 'Dismiss', icon: 'x' },
]

// The suggested action key (for highlighting)
const suggestedKey = computed(() => {
  const card = props.card
  if (card.actionKey === 'act' && card.subActionKey) return card.subActionKey
  if (card.actionKey === 'reply') return 'reply'
  if (card.actionKey === 'archive') return 'archive'
  return 'dismiss'
})

// Filter actions: hide emailOnly actions for iMessages, exclude the suggested action from the alt list
const altActions = computed(() => {
  const isMessage = props.card.type === 'message'
  return ALL_ACTIONS.filter(a => {
    if (a.key === suggestedKey.value) return false
    if (a.emailOnly && isMessage) return false
    return true
  })
})

// The suggested action object
const suggestedAction = computed(() =>
  ALL_ACTIONS.find(a => a.key === suggestedKey.value) || ALL_ACTIONS[ALL_ACTIONS.length - 1]
)

function handleAction(action) {
  const card = props.card

  // If choosing a different action than suggested, record the override silently
  if (action.key !== suggestedKey.value) {
    emit('override', { cardId: card.id, action: action.actionKey, subAction: action.subAction || null })
  }

  // Reply → enter reply direction textarea
  if (action.key === 'reply') {
    replySummaryText.value = card.replySummary || ''
    reviewingReply.value = true
    nextTick(() => reviewTextarea.value?.focus())
    return
  }

  // Sub-actions (add_task, briefing, unsubscribe)
  if (action.subAction) {
    emit('approve', card.id, null, { subAction: action.subAction })
    return
  }

  // Archive
  if (action.key === 'archive') {
    emit('approve', card.id, 'Archived', { overrideAction: 'archive' })
    return
  }

  // Dismiss
  if (action.key === 'dismiss') {
    emit('skip', card.id)
    return
  }

  // Fallback
  emit('approve', card.id, card.actionMsg)
}

function confirmReply() {
  const direction = replySummaryText.value.trim()
  reviewingReply.value = false
  emit('approve', props.card.id, 'Reply draft created', { replyDirection: direction })
}

function cancelReview() {
  reviewingReply.value = false
  replySummaryText.value = ''
}

function confirmDraft() {
  const body = draftText.value.trim()
  reviewingDraft.value = false
  props.card.pendingReply = null
  emit('approve', props.card.id, 'Message queued', { approvedReply: body })
}

function cancelDraft() {
  reviewingDraft.value = false
  draftText.value = ''
  props.card.pendingReply = null
}
</script>

<template>
  <div class="card" :class="{ cleared: card.cleared }">
    <div class="card-sender">
      <div class="sender-avatar" :class="card.avatarClass">{{ card.initials }}</div>
      <div class="sender-info">
        <div class="sender-name">
          {{ card.sender }}
          <span v-if="card.org" class="sender-org">{{ card.org }}</span>
          <span v-if="card.type === 'message'" class="type-badge type-message">iMessage</span>
          <div class="priority-dot" :class="card.priority"></div>
        </div>
        <div class="sender-time">{{ card.time }}</div>
      </div>
    </div>

    <div v-if="card.subject" class="card-subject">
      <a href="#" @click.prevent="$emit('open-email', card.emailId)">{{ card.subject }}</a>
    </div>
    <div v-if="card.type === 'message' && card.messageText" class="card-message-text">{{ card.messageText }}</div>
    <div class="card-summary">{{ card.summary }}</div>

    <!-- Reply review step — shows AI's one-line summary for approval/editing -->
    <div v-if="reviewingReply" class="reply-review">
      <div class="review-label">Reply direction</div>
      <textarea
        ref="reviewTextarea"
        v-model="replySummaryText"
        class="review-textarea"
        rows="2"
        placeholder="What should the reply say?"
      />
      <div class="review-hint">Approve to generate a full draft, or edit the direction first.</div>
      <div class="review-actions">
        <button class="btn btn-send-reply" :disabled="!replySummaryText.trim()" @click="confirmReply">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          Generate Draft
        </button>
        <button class="btn btn-cancel-review" @click="cancelReview">Back</button>
      </div>
    </div>

    <!-- iMessage draft review step — shows generated reply for approval/editing -->
    <div v-else-if="reviewingDraft" class="reply-review">
      <div class="review-label">Review reply</div>
      <textarea
        ref="draftTextarea"
        v-model="draftText"
        class="review-textarea"
        rows="3"
        placeholder="Reply text…"
      />
      <div class="review-hint">This will be sent as an iMessage. Edit if needed.</div>
      <div class="review-actions">
        <button class="btn btn-send-reply" :disabled="!draftText.trim()" @click="confirmDraft">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
          Send
        </button>
        <button class="btn btn-cancel-review" @click="cancelDraft">Cancel</button>
      </div>
    </div>

    <!-- Flat action palette -->
    <template v-else>
      <div class="rec-label">Genco recommends</div>

      <!-- Suggested action (prominent) -->
      <div class="card-actions">
        <button class="btn btn-approve" @click="handleAction(suggestedAction)">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          {{ suggestedAction.label }}
        </button>
      </div>

      <!-- All alternative actions -->
      <div class="alt-actions">
        <button
          v-for="action in altActions"
          :key="action.key"
          class="btn-alt"
          @click="handleAction(action)"
        >
          <svg v-if="action.icon === 'reply'" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z"/></svg>
          <svg v-if="action.icon === 'task'" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>
          <svg v-if="action.icon === 'book'" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z"/><path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z"/></svg>
          <svg v-if="action.icon === 'bolt'" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
          <svg v-if="action.icon === 'archive'" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/></svg>
          <svg v-if="action.icon === 'x'" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          {{ action.label }}
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.card {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  padding: 18px;
  margin-bottom: 10px;
  box-shadow: var(--shadow-sm);
  transition: all 0.35s cubic-bezier(0.16, 1, 0.3, 1);
  position: relative;
}

.card.cleared {
  opacity: 0;
  transform: translateX(40px) scale(0.98);
  margin-bottom: 0;
  padding-top: 0;
  padding-bottom: 0;
  max-height: 0;
  border-color: transparent;
  box-shadow: none;
  overflow: hidden;
}

.card-sender {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}

.sender-avatar {
  width: 30px;
  height: 30px;
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.65rem;
  font-weight: 600;
  flex-shrink: 0;
}

.av-orange { background: var(--color-accent-soft); color: var(--color-accent); }
.av-blue { background: var(--color-blue-soft); color: var(--color-blue); }
.av-purple { background: var(--color-purple-soft); color: var(--color-purple); }
.av-green { background: var(--color-success-soft); color: var(--color-success); }
.av-red { background: var(--color-danger-soft); color: var(--color-danger); }

.sender-info { flex: 1; min-width: 0; }

.sender-name {
  font-size: 0.8rem;
  font-weight: 500;
  color: var(--color-text);
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  min-width: 0;
}

.sender-org {
  font-weight: 400;
  color: var(--color-text-muted);
  font-size: 0.75rem;
}

.sender-time {
  font-size: 0.68rem;
  color: var(--color-text-muted);
}

.type-badge {
  font-size: 0.55rem;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 100px;
  letter-spacing: 0.02em;
}

.type-message {
  color: var(--color-success);
  background: var(--color-success-soft);
}

.priority-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  flex-shrink: 0;
}

.p-high { background: var(--color-accent); }
.p-med { background: var(--color-blue); }
.p-low { background: var(--color-border-light); }

.card-subject {
  font-size: 0.85rem;
  font-weight: 500;
  color: var(--color-text);
  margin-bottom: 4px;
  letter-spacing: -0.01em;
}

.card-subject a {
  color: var(--color-text);
  text-decoration: none;
  transition: color var(--transition-fast);
  -webkit-tap-highlight-color: transparent;
}

.card-subject a:hover,
.card-subject a:active {
  color: var(--color-accent);
}

.card-message-text {
  font-size: 0.82rem;
  color: var(--color-text);
  font-weight: 400;
  line-height: 1.5;
  margin-bottom: 6px;
  padding: 8px 10px;
  background: var(--color-bg);
  border-radius: var(--radius-md);
  border-left: 2px solid var(--color-success);
}

.card-summary {
  font-size: 0.78rem;
  color: var(--color-text-secondary);
  font-weight: 400;
  line-height: 1.55;
  margin-bottom: 14px;
}

.rec-label {
  font-size: 0.65rem;
  color: var(--color-text-muted);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  margin-bottom: 8px;
  display: flex;
  align-items: center;
  gap: 4px;
}

.card-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}

.btn {
  padding: 8px 18px;
  border-radius: var(--radius-md);
  font-size: 0.875rem;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  transition: all var(--transition-fast);
  border: none;
  letter-spacing: -0.01em;
  -webkit-tap-highlight-color: transparent;
}

.btn-approve {
  background: var(--color-primary);
  color: #fff;
  flex: 1;
}

.btn-approve:hover { background: var(--color-primary-hover); }
.btn-approve:active { transform: scale(0.98); }

.btn-approve svg {
  display: inline-block;
  vertical-align: -2px;
  margin-right: 4px;
}

/* ── Alt actions (flat palette) ── */
.alt-actions {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  animation: fadeIn 0.15s ease;
}

.btn-alt {
  padding: 7px 14px;
  border-radius: var(--radius-md);
  font-size: 0.75rem;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  transition: all var(--transition-fast);
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  color: var(--color-text-muted);
  display: flex;
  align-items: center;
  gap: 5px;
  -webkit-tap-highlight-color: transparent;
}

.btn-alt:hover,
.btn-alt:active {
  border-color: var(--color-border-light);
  color: var(--color-text-secondary);
  background: var(--color-bg);
}

.btn-alt svg { opacity: 0.4; flex-shrink: 0; }
.btn-alt:hover svg,
.btn-alt:active svg { opacity: 0.7; }

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(3px); }
  to { opacity: 1; transform: translateY(0); }
}

/* ── Reply Review Step ── */
.reply-review {
  animation: fadeIn 0.15s ease;
}

.review-label {
  font-size: 0.72rem;
  font-weight: 500;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: 8px;
}

.review-hint {
  font-size: 0.68rem;
  color: var(--color-text-muted);
  margin-top: 6px;
}

.review-textarea {
  width: 100%;
  padding: 10px 12px;
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border);
  font-size: 0.82rem;
  font-family: inherit;
  color: var(--color-text);
  background: var(--color-bg);
  outline: none;
  transition: border-color var(--transition-fast);
  resize: vertical;
  min-height: 60px;
  max-height: 200px;
  line-height: 1.5;
  box-sizing: border-box;
}

.review-textarea:focus {
  border-color: var(--color-accent-border);
}

.review-textarea::placeholder {
  color: var(--color-text-muted);
}

.review-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
}

.btn-send-reply {
  padding: 8px 18px;
  border-radius: var(--radius-md);
  font-size: 0.78rem;
  font-weight: 500;
  font-family: inherit;
  border: none;
  background: var(--color-success);
  color: #fff;
  cursor: pointer;
  transition: all var(--transition-fast);
  display: flex;
  align-items: center;
  gap: 5px;
}

.btn-send-reply:hover:not(:disabled) { background: var(--teal-800); }
.btn-send-reply:active:not(:disabled) { transform: scale(0.98); }
.btn-send-reply:disabled { opacity: 0.4; cursor: default; }

.btn-send-reply svg {
  display: inline-block;
  vertical-align: -1px;
}

.btn-cancel-review {
  padding: 8px 12px;
  border-radius: var(--radius-md);
  font-size: 0.72rem;
  font-family: inherit;
  border: none;
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
}

.btn-cancel-review:hover { color: var(--color-text-secondary); }

@media (max-width: 768px) {
  .card {
    padding: 14px;
  }

  .card-sender {
    gap: 8px;
    margin-bottom: 8px;
  }

  .sender-name {
    font-size: 0.75rem;
    gap: 4px;
  }

  .sender-org {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 100px;
  }

  .card-subject {
    font-size: 0.8rem;
    word-break: break-word;
  }

  .card-summary {
    font-size: 0.75rem;
    margin-bottom: 12px;
  }

  .card-actions {
    gap: 6px;
    flex-wrap: nowrap;
  }

  .btn {
    padding: 10px 18px;
    min-height: 44px;
  }

  .btn-approve {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .alt-actions {
    gap: 6px;
  }

  .btn-alt {
    padding: 10px 14px;
    min-height: 44px;
    flex: 1 1 auto;
  }

  .review-textarea {
    font-size: 0.78rem;
    padding: 10px 12px;
  }

  .btn-send-reply {
    padding: 10px 16px;
  }

  .btn-cancel-review {
    padding: 10px 12px;
  }
}

@media (min-width: 769px) {
  .card { padding: 20px; }
  .btn-approve { flex: none; }
}
</style>
