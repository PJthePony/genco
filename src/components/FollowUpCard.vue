<script setup>
import { ref } from 'vue'

const props = defineProps({
  card: Object,
})

const emit = defineEmits(['draft', 'snooze', 'dismiss', 'act', 'save-draft'])

const showSnoozeOptions = ref(false)
const draftText = ref('')
const editingDraft = ref(false)
const savingDraft = ref(false)

function handleSaveDraft() {
  if (!draftText.value.trim()) return
  savingDraft.value = true
  emit('save-draft', props.card.id, draftText.value.trim())
}

function handleDraft() {
  if (props.card.aiDraft) {
    // Already have a draft — toggle edit view
    draftText.value = props.card.aiDraft
    editingDraft.value = !editingDraft.value
  } else {
    // Generate a new draft
    emit('draft', props.card.id)
  }
}

// Watch for draft arriving after generation
function onDraftReady() {
  if (props.card.aiDraft && !editingDraft.value) {
    draftText.value = props.card.aiDraft
    editingDraft.value = true
  }
}

// Use a simple reactive check
defineExpose({ onDraftReady })
</script>

<template>
  <div class="followup-card" :class="[`reason-${card.reason}`]">
    <div class="card-header">
      <div class="avatar" :class="card.avatarClass">{{ card.initials }}</div>
      <div class="card-info">
        <div class="card-name">
          {{ card.contactName }}
          <span v-if="card.company" class="card-company">{{ card.company }}</span>
        </div>
        <div class="card-meta">
          <span v-if="card.daysAgo !== null" class="meta-text">
            {{ card.daysAgo === 0 ? 'Today' : card.daysAgo === 1 ? 'Yesterday' : `${card.daysAgo}d ago` }}
            <span v-if="card.lastDirection"> &middot; {{ card.lastDirection === 'sent' ? 'you sent last' : 'they sent last' }}</span>
          </span>
          <span v-if="card.lastSubject" class="meta-subject">&middot; {{ card.lastSubject }}</span>
        </div>
      </div>
      <span class="reason-tag" :class="card.reason">{{ card.reasonLabel }}</span>
    </div>

    <div class="card-context">{{ card.contextSnapshot }}</div>

    <!-- Draft display -->
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
          <button class="btn-draft-save" @click="handleSaveDraft" :disabled="savingDraft || !draftText.trim()">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
            {{ savingDraft ? 'Saving...' : 'Save to Gmail Drafts' }}
          </button>
          <button class="btn-draft-cancel" @click="editingDraft = false" :disabled="savingDraft">Cancel</button>
        </div>
      </div>
    </div>

    <!-- Action row -->
    <div class="card-actions">
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
    </div>
  </div>
</template>

<style scoped>
.followup-card {
  padding: 14px 0;
  border-bottom: 1px solid var(--color-border);
}

.followup-card:last-child {
  border-bottom: none;
}

.card-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}

.avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.62rem;
  font-weight: 600;
  flex-shrink: 0;
  color: #fff;
}

.avatar.av-orange { background: #f97316; }
.avatar.av-blue { background: #3b82f6; }
.avatar.av-purple { background: #8b5cf6; }
.avatar.av-green { background: #059669; }
.avatar.av-red { background: #ef4444; }

.card-info {
  flex: 1;
  min-width: 0;
}

.card-name {
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--color-text);
  letter-spacing: -0.01em;
}

.card-company {
  font-weight: 400;
  color: var(--color-text-muted);
  margin-left: 4px;
}

.card-meta {
  font-size: 0.68rem;
  color: var(--color-text-muted);
  margin-top: 1px;
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

.meta-subject {
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.reason-tag {
  font-size: 0.58rem;
  font-weight: 600;
  padding: 3px 8px;
  border-radius: 100px;
  letter-spacing: 0.02em;
  white-space: nowrap;
  flex-shrink: 0;
}

.reason-tag.ball_in_your_court {
  color: var(--color-accent);
  background: var(--color-accent-soft);
}

.reason-tag.went_cold {
  color: var(--color-blue);
  background: var(--color-blue-soft);
}

.reason-tag.date_coming_up {
  color: var(--color-success);
  background: var(--color-success-soft);
}

.card-context {
  font-size: 0.75rem;
  color: var(--color-text-secondary);
  line-height: 1.45;
  margin-bottom: 10px;
  padding-left: 42px;
}

.card-actions {
  display: flex;
  gap: 6px;
  padding-left: 42px;
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

/* Draft section */
.draft-section {
  margin: 8px 0 10px;
  padding-left: 42px;
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
</style>
