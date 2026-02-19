<script setup>
import { ref, computed } from 'vue'

const props = defineProps({
  card: Object,
  expanded: Boolean,
})

const emit = defineEmits(['expand', 'draft', 'snooze', 'dismiss', 'noise', 'act', 'save-draft', 'send-imessage', 'open-email'])

const showSnoozeOptions = ref(false)
const draftText = ref('')
const editingDraft = ref(false)
const savingDraft = ref(false)
const sendingMessage = ref(false)

const hasPhone = computed(() => !!props.card.contactPhone)

const gmailUrl = computed(() => {
  if (!props.card.gmailThreadId) return null
  return `https://mail.google.com/mail/u/0/#all/${props.card.gmailThreadId}`
})

function truncate(text, max) {
  if (!text || text.length <= max) return text
  return text.slice(0, max).trimEnd() + '...'
}

function handleSaveDraft() {
  if (!draftText.value.trim()) return
  savingDraft.value = true
  emit('save-draft', props.card.id, draftText.value.trim())
}

function handleSendMessage() {
  if (!draftText.value.trim()) return
  sendingMessage.value = true
  emit('send-imessage', props.card.id, draftText.value.trim())
}

function handleDraft() {
  if (props.card.aiDraft) {
    draftText.value = props.card.aiDraft
    editingDraft.value = !editingDraft.value
  } else {
    emit('draft', props.card.id)
  }
}

function onDraftReady() {
  if (props.card.aiDraft && !editingDraft.value) {
    draftText.value = props.card.aiDraft
    editingDraft.value = true
  }
}

defineExpose({ onDraftReady })
</script>

<template>
  <!-- Compact row (collapsed) -->
  <div class="compact-row" :class="{ cleared: card.cleared }">
    <div class="compact-avatar" :class="card.avatarClass">{{ card.initials }}</div>
    <div class="compact-content" @click="$emit('expand')">
      <div class="compact-top">
        <span class="compact-sender">{{ card.contactName }}</span>
        <span class="compact-time">
          {{ card.daysAgo === 0 ? 'Today' : card.daysAgo === 1 ? '1d' : `${card.daysAgo}d` }}
        </span>
      </div>
      <div class="compact-subject">{{ truncate(card.lastSubject || card.contextSnapshot, 60) }}</div>
      <div class="compact-summary">{{ truncate(card.contextSnapshot, 80) }}</div>
    </div>
    <div class="compact-right">
      <span class="compact-tag" :class="'tag-' + card.reason">{{ card.reasonLabel }}</span>
      <button class="compact-approve" @click.stop="$emit('dismiss', card.id)" aria-label="Dismiss">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
      </button>
    </div>
  </div>

  <!-- Expanded detail panel -->
  <div v-if="expanded" class="expanded-panel">
    <div class="expanded-meta">
      <span v-if="card.lastDirection" class="meta-direction">
        {{ card.lastDirection === 'sent' ? 'You sent last' : 'They sent last' }}
      </span>
      <a v-if="gmailUrl" :href="gmailUrl" target="_blank" rel="noopener" class="meta-link" @click.stop>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
        View in Gmail
      </a>
    </div>

    <div class="expanded-context">{{ card.contextSnapshot }}</div>

    <!-- Draft section -->
    <div v-if="editingDraft || card.drafting" class="draft-section">
      <div v-if="card.drafting" class="draft-loading">
        <span class="draft-spinner"></span>
        Drafting...
      </div>
      <div v-else-if="editingDraft" class="draft-content">
        <textarea
          v-model="draftText"
          class="draft-textarea"
          rows="4"
          placeholder="Your follow-up message..."
        ></textarea>
        <div class="draft-actions">
          <button class="btn-draft-save" @click="handleSaveDraft" :disabled="savingDraft || sendingMessage || !draftText.trim()">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
            {{ savingDraft ? 'Saving...' : 'Save to Gmail Drafts' }}
          </button>
          <button v-if="hasPhone" class="btn-draft-imessage" @click="handleSendMessage" :disabled="savingDraft || sendingMessage || !draftText.trim()">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            {{ sendingMessage ? 'Sending...' : 'Send as iMessage' }}
          </button>
          <button class="btn-draft-cancel" @click="editingDraft = false" :disabled="savingDraft || sendingMessage">Cancel</button>
        </div>
      </div>
    </div>

    <!-- Action row -->
    <div class="expanded-actions">
      <button class="btn-action btn-draft" @click="handleDraft" :disabled="card.drafting">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        {{ card.aiDraft ? 'View draft' : (card.suggestedAction === 'nudge' ? 'Draft nudge' : 'Draft reply') }}
      </button>

      <div class="snooze-wrapper">
        <button class="btn-action btn-snooze" @click="showSnoozeOptions = !showSnoozeOptions">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          Snooze
        </button>
        <div v-if="showSnoozeOptions" class="snooze-dropdown">
          <button @click="showSnoozeOptions = false; $emit('snooze', card.id, 3)">3 days</button>
          <button @click="showSnoozeOptions = false; $emit('snooze', card.id, 7)">1 week</button>
          <button @click="showSnoozeOptions = false; $emit('snooze', card.id, 14)">2 weeks</button>
          <button @click="showSnoozeOptions = false; $emit('snooze', card.id, 30)">1 month</button>
        </div>
      </div>

      <button class="btn-action btn-dismiss" @click="$emit('dismiss', card.id)">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        Dismiss
      </button>

      <button class="btn-action btn-noise" @click="$emit('noise', card.id)">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
        Not a person
      </button>
    </div>
  </div>
</template>

<style scoped>
/* ── Compact row (matches CompactRow.vue style) ── */
.compact-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 0;
  border-bottom: 1px solid var(--color-border);
  transition: all 0.35s cubic-bezier(0.16, 1, 0.3, 1);
}

.compact-row:last-child { border-bottom: none; }

.compact-row.cleared {
  opacity: 0;
  max-height: 0;
  padding: 0;
  overflow: hidden;
  border-color: transparent;
}

.compact-avatar {
  width: 30px;
  height: 30px;
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.6rem;
  font-weight: 600;
  flex-shrink: 0;
}

.av-orange { background: var(--color-accent-soft); color: var(--color-accent); }
.av-blue { background: var(--color-blue-soft); color: var(--color-blue); }
.av-purple { background: var(--color-purple-soft); color: var(--color-purple); }
.av-green { background: var(--color-success-soft); color: var(--color-success); }
.av-red { background: rgba(239, 68, 68, 0.08); color: var(--color-danger); }

.compact-content {
  flex: 1;
  min-width: 0;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.compact-top {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 2px;
}

.compact-sender {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--color-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.compact-time {
  font-size: 0.62rem;
  color: var(--color-text-muted);
  white-space: nowrap;
  flex-shrink: 0;
}

.compact-subject {
  font-size: 0.72rem;
  font-weight: 500;
  color: var(--color-text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 1px;
}

.compact-summary {
  font-size: 0.68rem;
  color: var(--color-text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.4;
}

.compact-right {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.compact-tag {
  font-size: 0.55rem;
  font-weight: 600;
  padding: 2px 6px;
  border-radius: 100px;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  white-space: nowrap;
}

.tag-ball_in_your_court { background: var(--color-accent-soft); color: var(--color-accent); }
.tag-went_cold { background: var(--color-blue-soft); color: var(--color-blue); }
.tag-date_coming_up { background: var(--color-success-soft); color: var(--color-success); }

.compact-approve {
  width: 44px;
  height: 44px;
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  color: var(--color-text-muted);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all var(--transition-fast);
  -webkit-tap-highlight-color: transparent;
}

.compact-approve:hover,
.compact-approve:active {
  color: var(--color-success);
  border-color: var(--color-success);
  background: var(--color-success-soft);
}

/* ── Expanded panel ── */
.expanded-panel {
  padding: 0 0 12px 40px;
  border-bottom: 1px solid var(--color-border);
  animation: fadeIn 0.2s ease;
}

@media (max-width: 640px) {
  .expanded-panel {
    padding-left: 0;
  }
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(-4px); }
  to { opacity: 1; transform: translateY(0); }
}

.expanded-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
  padding-top: 2px;
}

.meta-direction {
  font-size: 0.68rem;
  color: var(--color-text-muted);
}

.meta-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 0.68rem;
  font-weight: 500;
  color: var(--color-blue);
  text-decoration: none;
  transition: opacity var(--transition-fast);
}

.meta-link:hover { opacity: 0.75; }

.expanded-context {
  font-size: 0.75rem;
  color: var(--color-text-secondary);
  line-height: 1.45;
  margin-bottom: 10px;
}

.expanded-actions {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.btn-action {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 12px;
  border-radius: var(--radius-md);
  font-size: 0.7rem;
  font-weight: 500;
  font-family: inherit;
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: all var(--transition-fast);
  -webkit-tap-highlight-color: transparent;
}

.btn-action:hover:not(:disabled) {
  border-color: var(--color-text-muted);
  color: var(--color-text);
}

.btn-action:disabled {
  opacity: 0.5;
  cursor: default;
}

.btn-draft:hover:not(:disabled) {
  border-color: var(--color-accent-border);
  color: var(--color-accent);
}

.snooze-wrapper {
  position: relative;
}

.snooze-dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  margin-top: 4px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-md);
  z-index: 10;
  overflow: hidden;
}

.snooze-dropdown button {
  display: block;
  width: 100%;
  padding: 8px 16px;
  font-size: 0.72rem;
  font-family: inherit;
  color: var(--color-text-secondary);
  background: none;
  border: none;
  text-align: left;
  cursor: pointer;
  white-space: nowrap;
}

.snooze-dropdown button:hover {
  background: var(--color-bg);
  color: var(--color-text);
}

/* ── Draft section ── */
.draft-section {
  margin: 8px 0 10px;
}

.draft-loading {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.72rem;
  color: var(--color-text-muted);
  padding: 12px 0;
}

.draft-spinner {
  width: 14px;
  height: 14px;
  border: 2px solid var(--color-border);
  border-top-color: var(--color-accent);
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.draft-textarea {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  font-size: 0.75rem;
  font-family: inherit;
  color: var(--color-text);
  background: var(--color-bg);
  resize: vertical;
  line-height: 1.45;
}

.draft-textarea:focus {
  outline: none;
  border-color: var(--color-accent-border);
}

.draft-actions {
  display: flex;
  gap: 8px;
  margin-top: 8px;
  flex-wrap: wrap;
}

.btn-draft-save {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 14px;
  border-radius: var(--radius-md);
  font-size: 0.72rem;
  font-weight: 600;
  font-family: inherit;
  border: none;
  background: var(--color-primary);
  color: #fff;
  cursor: pointer;
}

.btn-draft-save:hover { background: var(--color-primary-hover); }

.btn-draft-imessage {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 14px;
  border-radius: var(--radius-md);
  font-size: 0.72rem;
  font-weight: 600;
  font-family: inherit;
  border: none;
  background: #34C759;
  color: #fff;
  cursor: pointer;
}

.btn-draft-imessage:hover:not(:disabled) { background: #2db84e; }
.btn-draft-imessage:disabled { opacity: 0.4; cursor: default; }

.btn-draft-cancel {
  padding: 6px 14px;
  border-radius: var(--radius-md);
  font-size: 0.72rem;
  font-weight: 500;
  font-family: inherit;
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  color: var(--color-text-muted);
  cursor: pointer;
}

.btn-draft-cancel:hover { color: var(--color-text-secondary); }

.btn-noise {
  margin-left: auto;
  color: var(--color-text-muted);
  border-color: transparent;
  opacity: 0.6;
}
.btn-noise:hover {
  opacity: 1;
  color: #ef4444;
  border-color: #ef444433;
}

@media (max-width: 640px) {
  .compact-row {
    gap: 8px;
    padding: 10px 0;
  }

  .compact-sender {
    font-size: 0.72rem;
  }

  .compact-subject {
    font-size: 0.68rem;
  }

  .compact-summary {
    font-size: 0.65rem;
  }

  .compact-right {
    gap: 4px;
  }

  .compact-tag {
    font-size: 0.5rem;
    padding: 2px 5px;
  }

  .compact-approve {
    width: 40px;
    height: 40px;
  }

  .expanded-panel {
    padding-left: 0;
  }

  .expanded-actions {
    gap: 6px;
  }

  .btn-action {
    padding: 10px 10px;
    font-size: 0.65rem;
    gap: 3px;
  }

  .btn-action svg {
    width: 11px;
    height: 11px;
    flex-shrink: 0;
  }

  .btn-noise {
    margin-left: 0;
  }

  .draft-actions {
    flex-wrap: wrap;
    gap: 6px;
  }

  .btn-draft-save,
  .btn-draft-imessage {
    padding: 10px 12px;
    font-size: 0.68rem;
    flex: 1 1 auto;
    justify-content: center;
  }

  .btn-draft-cancel {
    padding: 10px 12px;
    font-size: 0.68rem;
  }

  .draft-textarea {
    font-size: 0.72rem;
  }

  .snooze-dropdown button {
    padding: 12px 16px;
    font-size: 0.72rem;
  }
}
</style>
