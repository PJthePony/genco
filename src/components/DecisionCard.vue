<script setup>
import { ref, nextTick } from 'vue'

const props = defineProps({
  card: Object,
})

const emit = defineEmits(['approve', 'skip', 'open-email', 'feedback'])

const showingAlts = ref(false)
const pendingAlt = ref(null)
const feedbackText = ref('')
const feedbackInput = ref(null)

function showAlts() { showingAlts.value = true }
function hideAlts() { showingAlts.value = false; pendingAlt.value = null }

function approve(msg) {
  emit('approve', props.card.id, msg)
}

function selectAlt(action, msg) {
  pendingAlt.value = { action, msg }
  feedbackText.value = ''
  nextTick(() => {
    feedbackInput.value?.focus()
  })
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
  approve(pendingAlt.value.msg)
  pendingAlt.value = null
  feedbackText.value = ''
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
  approve(pendingAlt.value.msg)
  pendingAlt.value = null
  feedbackText.value = ''
}
</script>

<template>
  <div class="card" :class="{ cleared: card.cleared }">
    <div class="card-sender">
      <div class="sender-avatar" :class="card.avatarClass">{{ card.initials }}</div>
      <div class="sender-info">
        <div class="sender-name">
          {{ card.sender }}
          <span class="sender-org">{{ card.org }}</span>
          <div class="priority-dot" :class="card.priority"></div>
        </div>
        <div class="sender-time">{{ card.time }}</div>
      </div>
    </div>

    <div class="card-subject">
      <a href="#" @click.prevent="$emit('open-email', card.emailId)">{{ card.subject }}</a>
    </div>
    <div class="card-summary">{{ card.summary }}</div>

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
      <button v-if="card.hasBriefing" class="btn-alt" @click="selectAlt('+ Briefing', card.sender + ' added to Daily Briefing')">
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
      <button v-if="card.action !== 'Unsubscribe'" class="btn-alt" @click="selectAlt('Unsubscribe', 'Unsubscribed')">
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
        </div>
      </form>
    </div>
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

@media (min-width: 641px) {
  .card { padding: 20px; }
  .btn-approve { flex: none; }
}
</style>
