<script setup>
import { ref, computed, nextTick } from 'vue'

const props = defineProps({
  card: Object,
})

const emit = defineEmits(['approve', 'skip', 'open-email', 'feedback'])

const showingAlts = ref(false)
const pendingAlt = ref(null)
const feedbackText = ref('')
const replyContext = ref('')
const feedbackInput = ref(null)
const replyContextInput = ref(null)

// Reply review state — lets user see/edit draft before sending
const reviewingReply = ref(false)
const reviewDraft = ref('')
const reviewTextarea = ref(null)

const isReplyAction = computed(() =>
  pendingAlt.value?.action === 'Reply'
)

// True when the default action is Reply on an iMessage card
const isMessageReply = computed(() =>
  props.card.type === 'message' && props.card.actionKey === 'reply'
)

function showAlts() { showingAlts.value = true }
function hideAlts() { showingAlts.value = false; pendingAlt.value = null }

function approve(msg) {
  // Intercept: if this is a message reply, show the review step first
  if (isMessageReply.value && !reviewingReply.value) {
    reviewDraft.value = props.card.replyDraft || ''
    reviewingReply.value = true
    nextTick(() => reviewTextarea.value?.focus())
    return
  }
  emit('approve', props.card.id, msg)
}

function confirmReply() {
  // Update the card's replyDraft with the (possibly edited) text
  props.card.replyDraft = reviewDraft.value.trim()
  reviewingReply.value = false
  emit('approve', props.card.id, 'Reply sent')
}

function cancelReview() {
  reviewingReply.value = false
  reviewDraft.value = ''
}

function selectAlt(action, msg) {
  pendingAlt.value = { action, msg }
  feedbackText.value = ''
  replyContext.value = ''
  nextTick(() => {
    if (action === 'Reply') {
      replyContextInput.value?.focus()
    } else {
      feedbackInput.value?.focus()
    }
  })
}

function submitFeedback() {
  const feedback = feedbackText.value.trim()
  const replyInstructions = replyContext.value.trim()
  emit('feedback', {
    cardId: props.card.id,
    sender: props.card.sender,
    originalAction: props.card.action,
    chosenAction: pendingAlt.value.action,
    reason: feedback || null,
    replyContext: replyInstructions || null,
    timestamp: new Date().toISOString(),
  })
  // If switching to Reply on a message card, show review step
  if (pendingAlt.value.action === 'Reply' && props.card.type === 'message') {
    props.card.actionKey = 'reply'
    pendingAlt.value = null
    feedbackText.value = ''
    replyContext.value = ''
    // The draft will be generated server-side via replyContext;
    // for now show what we have or a placeholder
    reviewDraft.value = props.card.replyDraft || ''
    reviewingReply.value = true
    nextTick(() => reviewTextarea.value?.focus())
    return
  }
  approve(pendingAlt.value.msg)
  pendingAlt.value = null
  feedbackText.value = ''
  replyContext.value = ''
}

function skipFeedback() {
  const replyInstructions = replyContext.value.trim()
  emit('feedback', {
    cardId: props.card.id,
    sender: props.card.sender,
    originalAction: props.card.action,
    chosenAction: pendingAlt.value.action,
    reason: null,
    replyContext: replyInstructions || null,
    timestamp: new Date().toISOString(),
  })
  // If switching to Reply on a message card, show review step
  if (pendingAlt.value.action === 'Reply' && props.card.type === 'message') {
    props.card.actionKey = 'reply'
    pendingAlt.value = null
    feedbackText.value = ''
    replyContext.value = ''
    reviewDraft.value = props.card.replyDraft || ''
    reviewingReply.value = true
    nextTick(() => reviewTextarea.value?.focus())
    return
  }
  approve(pendingAlt.value.msg)
  pendingAlt.value = null
  feedbackText.value = ''
  replyContext.value = ''
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

    <!-- Reply review step — shows draft before sending -->
    <div v-if="reviewingReply" class="reply-review">
      <div class="review-label">Review reply to {{ card.sender }}</div>
      <textarea
        ref="reviewTextarea"
        v-model="reviewDraft"
        class="review-textarea"
        rows="3"
        placeholder="Type your reply…"
      />
      <div class="review-actions">
        <button class="btn btn-send-reply" :disabled="!reviewDraft.trim()" @click="confirmReply">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
          Send
        </button>
        <button class="btn btn-cancel-review" @click="cancelReview">Back</button>
      </div>
    </div>

    <template v-if="!reviewingReply">
    <div class="rec-label">Genco recommends</div>

    <!-- Default actions -->
    <div class="default-actions card-actions" :class="{ hidden: showingAlts }">
      <button class="btn btn-approve" @click="approve(card.actionMsg)">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
        {{ card.action }}
      </button>
      <button class="btn btn-change" @click="showAlts">Change</button>
      <button class="btn btn-skip" @click="$emit('skip', card.id)">Skip</button>
    </div>

    <!-- Alt actions -->
    <div class="alt-actions" :class="{ visible: showingAlts && !pendingAlt }">
      <button v-if="card.hasBriefing && card.type !== 'message'" class="btn-alt" @click="selectAlt('+ Briefing', card.sender + ' added to Daily Briefing')">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z"/><path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z"/></svg>
        + Briefing
      </button>
      <button v-if="card.action !== 'Reply'" class="btn-alt" @click="selectAlt('Reply', 'Reply draft created')">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z"/></svg>
        Reply
      </button>
      <button v-if="card.action !== '+ Task'" class="btn-alt" @click="selectAlt('+ Task', 'Task added to Tessio')">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>
        + Task
      </button>
      <button v-if="card.action !== 'Archive'" class="btn-alt" @click="selectAlt('Archive', 'Archived')">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/></svg>
        Archive
      </button>
      <button v-if="card.action !== 'Unsubscribe' && card.type !== 'message'" class="btn-alt" @click="selectAlt('Unsubscribe', 'Unsubscribed')">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
        Act
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

      <!-- Reply context input — only shown when changing to Reply -->
      <template v-if="isReplyAction">
        <div class="feedback-question">What should the reply say?</div>
        <textarea
          ref="replyContextInput"
          v-model="replyContext"
          class="feedback-input reply-context-input"
          placeholder="e.g. Tell them I'm free Thursday afternoon, ask about the budget"
          maxlength="500"
          rows="2"
        />
      </template>

      <div class="feedback-question">{{ isReplyAction ? 'Any feedback for Genco?' : "Why'd you change it?" }}</div>
      <form class="feedback-form" @submit.prevent="submitFeedback">
        <input
          ref="feedbackInput"
          v-model="feedbackText"
          type="text"
          class="feedback-input"
          :placeholder="isReplyAction ? 'e.g. I always reply to this person' : 'e.g. I always reply to this person'"
          maxlength="200"
        />
        <div class="feedback-actions">
          <button type="submit" class="btn-feedback-send" :disabled="isReplyAction ? !replyContext.trim() : !feedbackText.trim()">
            {{ isReplyAction ? 'Generate Reply' : 'Send' }}
          </button>
          <button type="button" class="btn-feedback-skip" @click="skipFeedback">Skip</button>
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
  font-size: 0.78rem;
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
  padding: 8px 14px;
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
  padding: 9px 14px;
  border-radius: var(--radius-md);
  font-size: 0.75rem;
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

.reply-context-input {
  resize: vertical;
  min-height: 50px;
  max-height: 120px;
  margin-bottom: 8px;
  line-height: 1.45;
  box-sizing: border-box;
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

@media (max-width: 640px) {
  .btn {
    min-height: 44px;
  }

  /* Lock action buttons into a consistent position on every card */
  .card-actions {
    flex-wrap: nowrap;
  }

  .btn-approve {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .btn-change,
  .btn-skip {
    flex-shrink: 0;
  }

  .alt-actions {
    gap: 8px;
  }

  .btn-alt {
    min-height: 44px;
    flex: 1 1 auto;
  }

  .btn-feedback-send,
  .btn-feedback-skip {
    min-height: 44px;
  }

  .btn-send-reply,
  .btn-cancel-review {
    min-height: 44px;
  }

  .card-subject {
    word-break: break-word;
  }

  .sender-org {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 120px;
  }
}

@media (min-width: 641px) {
  .card { padding: 20px; }
  .btn-approve { flex: none; }
}
</style>
