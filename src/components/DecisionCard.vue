<script setup>
import { ref, computed, nextTick } from 'vue'

const props = defineProps({
  card: Object,
})

const emit = defineEmits(['approve', 'skip', 'open-email', 'feedback', 'override'])

const showingAlts = ref(false)
const pendingAlt = ref(null)
const feedbackText = ref('')
const feedbackInput = ref(null)

// ── Reply two-step state ──
// Step 1: show replySummary → approve or edit
// Step 2 (on approve): parent generates full draft via API, then executes
const reviewingReply = ref(false)
const replySummaryText = ref('')
const reviewTextarea = ref(null)

// ── Act two-step state ──
const pickingSubAction = ref(false)

const SUB_ACTIONS = [
  { key: 'unsubscribe', label: 'Unsubscribe', icon: 'bolt' },
  { key: 'add_task', label: '+ Task', icon: 'task' },
  { key: 'briefing', label: '+ Briefing', icon: 'book' },
]

const isReplyAction = computed(() =>
  pendingAlt.value?.action === 'Reply'
)

function showAlts() { showingAlts.value = true }
function hideAlts() { showingAlts.value = false; pendingAlt.value = null }

function approve() {
  const card = props.card

  // Reply cards → show summary review step
  if (card.actionKey === 'reply' && !reviewingReply.value) {
    replySummaryText.value = card.replySummary || ''
    reviewingReply.value = true
    nextTick(() => reviewTextarea.value?.focus())
    return
  }

  // Act cards → show sub-action picker
  if (card.actionKey === 'act' && !pickingSubAction.value) {
    pickingSubAction.value = true
    return
  }

  // Archive / already confirmed → execute
  emit('approve', card.id, card.actionMsg)
}

function confirmReply() {
  // Emit with the direction text — parent will call generateDraft() then executeAction()
  const direction = replySummaryText.value.trim()
  reviewingReply.value = false
  emit('approve', props.card.id, 'Reply draft created', { replyDirection: direction })
}

function cancelReview() {
  reviewingReply.value = false
  replySummaryText.value = ''
}

function pickSubAction(subKey) {
  pickingSubAction.value = false
  emit('approve', props.card.id, null, { subAction: subKey })
}

function cancelSubActionPick() {
  pickingSubAction.value = false
}

function switchAction(newActionKey) {
  pickingSubAction.value = false
  props.card.actionKey = newActionKey
  // Persist the override server-side (fire-and-forget)
  emit('override', { cardId: props.card.id, action: newActionKey, subAction: null })
  // Trigger the appropriate two-step flow for the new action
  approve()
}

function selectAlt(action, msg) {
  pendingAlt.value = { action, msg }
  feedbackText.value = ''
  nextTick(() => feedbackInput.value?.focus())
}

function submitFeedback() {
  const feedback = feedbackText.value.trim()
  emit('feedback', {
    cardId: props.card.id,
    sender: props.card.sender,
    originalAction: props.card.action,
    chosenAction: pendingAlt.value.action,
    reason: feedback || null,
    timestamp: new Date().toISOString(),
  })
  // Update card's actionKey to reflect the override, then approve
  const ACTION_KEY_MAP = { 'Reply': 'reply', 'Act': 'act', 'Archive': 'archive' }
  const newKey = ACTION_KEY_MAP[pendingAlt.value.action]
  if (newKey) {
    props.card.actionKey = newKey
    // Persist the override server-side (fire-and-forget)
    emit('override', { cardId: props.card.id, action: newKey, subAction: null })
  }
  pendingAlt.value = null
  feedbackText.value = ''
  // Trigger the two-step flow for the new action
  approve()
}

function skipFeedback() {
  emit('feedback', {
    cardId: props.card.id,
    sender: props.card.sender,
    originalAction: props.card.action,
    chosenAction: pendingAlt.value.action,
    reason: null,
    timestamp: new Date().toISOString(),
  })
  const ACTION_KEY_MAP = { 'Reply': 'reply', 'Act': 'act', 'Archive': 'archive' }
  const newKey = ACTION_KEY_MAP[pendingAlt.value.action]
  if (newKey) {
    props.card.actionKey = newKey
    emit('override', { cardId: props.card.id, action: newKey, subAction: null })
  }
  pendingAlt.value = null
  feedbackText.value = ''
  approve()
}

function cancelFeedback() {
  pendingAlt.value = null
  feedbackText.value = ''
  // Alt panel stays visible so user can re-choose
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

    <!-- Act sub-action picker -->
    <div v-else-if="pickingSubAction" class="sub-action-picker">
      <div class="review-label">What action?</div>
      <div class="sub-action-options">
        <button
          v-for="sa in SUB_ACTIONS"
          :key="sa.key"
          class="btn-sub-action"
          :class="{ suggested: sa.key === card.subActionKey }"
          @click="pickSubAction(sa.key)"
        >
          <svg v-if="sa.icon === 'bolt'" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
          <svg v-if="sa.icon === 'task'" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>
          <svg v-if="sa.icon === 'book'" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z"/><path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z"/></svg>
          {{ sa.label }}
          <span v-if="sa.key === card.subActionKey" class="suggested-tag">suggested</span>
        </button>
      </div>
      <div class="sub-action-divider"></div>
      <div class="sub-action-alts">
        <button class="btn-sub-alt" @click="switchAction('reply')">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z"/></svg>
          Reply instead
        </button>
        <button class="btn-sub-alt" @click="switchAction('archive')">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/></svg>
          Archive instead
        </button>
      </div>
      <button class="btn-back" @click="cancelSubActionPick">Back</button>
    </div>

    <template v-else>
    <div class="rec-label">Genco recommends</div>

    <!-- Default actions -->
    <div class="default-actions card-actions" :class="{ hidden: showingAlts }">
      <button class="btn btn-approve" @click="approve()">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
        {{ card.action }}
        <span v-if="card.subAction" class="approve-sub">· {{ card.subAction }}</span>
      </button>
      <button class="btn btn-change" @click="showAlts">Change</button>
      <button class="btn btn-skip" @click="$emit('skip', card.id)">Skip</button>
    </div>

    <!-- Alt actions — only Reply, Act, Archive -->
    <div class="alt-actions" :class="{ visible: showingAlts && !pendingAlt }">
      <button v-if="card.actionKey !== 'reply'" class="btn-alt" @click="selectAlt('Reply', 'Reply draft created')">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z"/></svg>
        Reply
      </button>
      <button v-if="card.actionKey !== 'act' && card.type !== 'message'" class="btn-alt" @click="selectAlt('Act', 'Done')">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
        Act
      </button>
      <button v-if="card.actionKey !== 'archive'" class="btn-alt" @click="selectAlt('Archive', 'Archived')">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/></svg>
        Archive
      </button>
      <button class="btn-back" @click="hideAlts">Back</button>
    </div>

    <!-- Feedback prompt -->
    <div class="feedback-prompt" :class="{ visible: pendingAlt }">
      <div class="feedback-change-label">
        <span class="feedback-from">{{ card.action }}</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14"/><path d="M12 5l7 7-7 7"/></svg>
        <span class="feedback-to">{{ pendingAlt?.action }}</span>
      </div>

      <div class="feedback-question">Why'd you change it?</div>
      <form class="feedback-form" @submit.prevent="submitFeedback">
        <input
          ref="feedbackInput"
          v-model="feedbackText"
          type="text"
          class="feedback-input"
          placeholder="e.g. I always reply to this person"
          maxlength="200"
        />
        <div class="feedback-actions">
          <button type="submit" class="btn-feedback-send" :disabled="!feedbackText.trim()">Send</button>
          <button type="button" class="btn-feedback-skip" @click="skipFeedback">Skip</button>
          <button type="button" class="btn-back feedback-back" @click="cancelFeedback">Back</button>
        </div>
      </form>
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
.av-red { background: rgba(239, 68, 68, 0.08); color: var(--color-danger); }

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
  color: #34C759;
  background: rgba(52, 199, 89, 0.1);
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
  border-left: 2px solid #34C759;
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

.btn-change {
  background: transparent;
  color: var(--color-text-secondary);
  border: 1px solid var(--color-border);
  padding: 8px 18px;
}

.btn-change:hover { background: var(--color-bg); }

.btn-skip {
  background: transparent;
  color: var(--color-text-muted);
  border: none;
  margin-left: auto;
  padding: 8px 10px;
  font-size: 0.72rem;
}

.btn-skip:hover { color: var(--color-text-secondary); }

.alt-actions {
  display: none;
  gap: 6px;
  flex-wrap: wrap;
  animation: fadeIn 0.15s ease;
}

.alt-actions.visible { display: flex; }

.btn-alt {
  padding: 9px 18px;
  border-radius: var(--radius-md);
  font-size: 0.875rem;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  transition: all var(--transition-fast);
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  color: var(--color-text-secondary);
  display: flex;
  align-items: center;
  gap: 5px;
  -webkit-tap-highlight-color: transparent;
}

.btn-alt:hover,
.btn-alt:active {
  border-color: var(--color-accent-border);
  color: var(--color-accent);
  background: var(--color-accent-soft);
}

.btn-alt svg { opacity: 0.5; flex-shrink: 0; }
.btn-alt:hover svg,
.btn-alt:active svg { opacity: 1; }

.btn-back {
  padding: 9px 12px;
  border-radius: var(--radius-md);
  font-size: 0.72rem;
  font-family: inherit;
  cursor: pointer;
  border: none;
  background: transparent;
  color: var(--color-text-muted);
  -webkit-tap-highlight-color: transparent;
}

.btn-back:hover { color: var(--color-text-secondary); }

.default-actions.hidden { display: none; }

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(3px); }
  to { opacity: 1; transform: translateY(0); }
}

/* ── Feedback Prompt ── */
.feedback-prompt {
  display: none;
  animation: fadeIn 0.15s ease;
}

.feedback-prompt.visible { display: block; }

.feedback-change-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.72rem;
  color: var(--color-text-muted);
  margin-bottom: 6px;
}

.feedback-from {
  text-decoration: line-through;
  opacity: 0.6;
}

.feedback-to {
  color: var(--color-accent);
  font-weight: 500;
}

.feedback-change-label svg {
  opacity: 0.4;
  flex-shrink: 0;
}

.feedback-question {
  font-size: 0.78rem;
  font-weight: 500;
  color: var(--color-text);
  margin-bottom: 8px;
}

.feedback-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.feedback-input {
  width: 100%;
  padding: 9px 12px;
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border);
  font-size: 0.78rem;
  font-family: inherit;
  color: var(--color-text);
  background: var(--color-bg);
  outline: none;
  transition: border-color var(--transition-fast);
}

.feedback-input::placeholder {
  color: var(--color-text-muted);
}

.feedback-input:focus {
  border-color: var(--color-accent-border);
}

.feedback-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.btn-feedback-send {
  padding: 7px 16px;
  border-radius: var(--radius-md);
  font-size: 0.75rem;
  font-weight: 500;
  font-family: inherit;
  border: none;
  background: var(--color-primary);
  color: #fff;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.btn-feedback-send:hover:not(:disabled) { background: var(--color-primary-hover); }
.btn-feedback-send:disabled { opacity: 0.4; cursor: default; }

.btn-feedback-skip {
  padding: 7px 12px;
  border-radius: var(--radius-md);
  font-size: 0.72rem;
  font-family: inherit;
  border: none;
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
}

.btn-feedback-skip:hover { color: var(--color-text-secondary); }

.feedback-back { margin-left: auto; }

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

/* ── Sub-Action Picker ── */
.sub-action-picker {
  animation: fadeIn 0.15s ease;
}

.sub-action-options {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}

.btn-sub-action {
  padding: 9px 18px;
  border-radius: var(--radius-md);
  font-size: 0.875rem;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  transition: all var(--transition-fast);
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  color: var(--color-text-secondary);
  display: flex;
  align-items: center;
  gap: 5px;
  -webkit-tap-highlight-color: transparent;
}

.btn-sub-action.suggested {
  border-color: var(--color-accent-border);
  color: var(--color-accent);
  background: var(--color-accent-soft);
}

.btn-sub-action:hover,
.btn-sub-action:active {
  border-color: var(--color-accent-border);
  color: var(--color-accent);
  background: var(--color-accent-soft);
}

.btn-sub-action svg { opacity: 0.5; flex-shrink: 0; }
.btn-sub-action.suggested svg,
.btn-sub-action:hover svg,
.btn-sub-action:active svg { opacity: 1; }

.suggested-tag {
  font-size: 0.55rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  opacity: 0.7;
}

.approve-sub {
  font-weight: 400;
  opacity: 0.8;
}

.sub-action-divider {
  height: 1px;
  background: var(--color-border);
  margin: 8px 0;
}

.sub-action-alts {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}

.btn-sub-alt {
  padding: 7px 14px;
  border-radius: var(--radius-md);
  font-size: 0.75rem;
  font-weight: 400;
  font-family: inherit;
  cursor: pointer;
  transition: all var(--transition-fast);
  border: 1px solid var(--color-border);
  background: transparent;
  color: var(--color-text-muted);
  display: flex;
  align-items: center;
  gap: 5px;
  -webkit-tap-highlight-color: transparent;
}

.btn-sub-alt:hover,
.btn-sub-alt:active {
  border-color: var(--color-border-light);
  color: var(--color-text-secondary);
  background: var(--color-bg);
}

.btn-sub-alt svg { opacity: 0.4; flex-shrink: 0; }
.btn-sub-alt:hover svg,
.btn-sub-alt:active svg { opacity: 0.7; }

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
  background: #34C759;
  color: #fff;
  cursor: pointer;
  transition: all var(--transition-fast);
  display: flex;
  align-items: center;
  gap: 5px;
}

.btn-send-reply:hover:not(:disabled) { background: #2db84d; }
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

  /* Lock action buttons into a consistent position on every card */
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

  .btn-change {
    padding: 10px 12px;
    flex-shrink: 0;
  }

  .btn-skip {
    padding: 10px 8px;
    flex-shrink: 0;
  }

  .alt-actions {
    gap: 6px;
  }

  .btn-alt {
    padding: 10px 14px;
    min-height: 44px;
    flex: 1 1 auto;
  }

  .btn-back {
    padding: 10px 12px;
  }

  .feedback-input {
    font-size: 0.75rem;
    padding: 10px 12px;
  }

  .btn-feedback-send {
    padding: 10px 14px;
  }

  .btn-feedback-skip {
    padding: 10px 12px;
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

  .btn-sub-action {
    padding: 10px 14px;
    min-height: 44px;
    flex: 1 1 auto;
  }

  .btn-sub-alt {
    padding: 10px 14px;
    min-height: 44px;
    flex: 1 1 auto;
  }
}

@media (min-width: 769px) {
  .card { padding: 20px; }
  .btn-approve { flex: none; }
}
</style>
