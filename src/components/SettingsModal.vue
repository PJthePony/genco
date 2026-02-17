<script setup>
import { computed, ref, watch } from 'vue'
import { api } from '../composables/useApi'

const props = defineProps({
  open: Boolean,
  sources: Array,
  feedbackLog: Array,
  overrideStats: Object,
  totalOverrides: Number,
})

const emit = defineEmits(['close', 'remove-source', 'add-source', 'clear-feedback'])

// Add sender form
const addingSource = ref(false)
const newEmail = ref('')
const newName = ref('')
const addError = ref('')
const addLoading = ref(false)

function startAddSource() {
  addingSource.value = true
  newEmail.value = ''
  newName.value = ''
  addError.value = ''
}

function cancelAddSource() {
  addingSource.value = false
  newEmail.value = ''
  newName.value = ''
  addError.value = ''
}

async function submitAddSource() {
  const email = newEmail.value.trim()
  const name = newName.value.trim()

  if (!email) {
    addError.value = 'Email address is required'
    return
  }
  if (!email.includes('@')) {
    addError.value = 'Enter a valid email address'
    return
  }
  if (!name) {
    addError.value = 'Display name is required'
    return
  }

  addLoading.value = true
  addError.value = ''

  try {
    await api('/settings/briefing-sources', {
      method: 'POST',
      body: JSON.stringify({
        emailAddress: email,
        displayName: name,
      }),
    })
    addingSource.value = false
    newEmail.value = ''
    newName.value = ''
    emit('add-source')
  } catch (err) {
    addError.value = 'Failed to add source'
  } finally {
    addLoading.value = false
  }
}

// Gmail connection status
const gmailEmail = ref(null)
const gmailConnected = ref(false)
const connectingGmail = ref(false)

async function loadGmailStatus() {
  try {
    const data = await api('/settings/gmail')
    gmailConnected.value = data.connected
    gmailEmail.value = data.email
  } catch (err) {
    console.error('Failed to load Gmail status:', err)
  }
}

async function connectGmail() {
  connectingGmail.value = true
  try {
    const data = await api('/auth/google')
    if (data.url) {
      window.location.href = data.url
    }
  } catch (err) {
    console.error('Failed to start Gmail connect:', err)
    connectingGmail.value = false
  }
}

// Load Gmail status when settings modal opens
watch(() => props.open, (isOpen) => {
  if (isOpen) loadGmailStatus()
})

const recentFeedback = computed(() =>
  (props.feedbackLog || []).slice(0, 5)
)

const hasOverrides = computed(() => props.totalOverrides > 0)

function timeAgo(timestamp) {
  const now = new Date()
  const then = new Date(timestamp)
  const diff = Math.floor((now - then) / 1000)
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}
</script>

<template>
  <div class="settings-overlay" :class="{ visible: open }" @click="$emit('close')">
    <div class="settings-modal" @click.stop>
      <div class="settings-header">
        <h2>Settings</h2>
        <button class="modal-close" @click="$emit('close')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="settings-body">
        <div class="settings-group">
          <div class="settings-label">Email Accounts</div>
          <div v-if="gmailConnected" class="settings-row">
            <span>Gmail</span>
            <span class="settings-value">{{ gmailEmail }}</span>
          </div>
          <div v-else class="settings-row">
            <span>Gmail</span>
            <button class="btn-connect" @click="connectGmail" :disabled="connectingGmail">
              {{ connectingGmail ? 'Connecting…' : 'Connect Gmail' }}
            </button>
          </div>
        </div>
        <div class="settings-group">
          <div class="settings-label">Scan Frequency</div>
          <div class="settings-row"><span>Check inbox</span> <span class="settings-value">Every hour</span></div>
          <div class="settings-row"><span>Urgent SMS alerts</span> <span class="settings-value">Enabled</span></div>
        </div>
        <div class="settings-group">
          <div class="settings-label">Daily Briefing Sources</div>
          <div class="settings-row" v-for="(source, i) in sources" :key="source.name">
            <span>{{ source.name }}</span>
            <div class="settings-row-right">
              <span class="settings-value" :class="source.tagClass">{{ source.tag }}</span>
              <button class="settings-remove" @click="$emit('remove-source', i)" title="Remove">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
          </div>
          <!-- Add sender form -->
          <div v-if="addingSource" class="add-source-form">
            <input
              v-model="newEmail"
              type="email"
              placeholder="email@example.com"
              class="add-source-input"
              @keydown.enter="submitAddSource"
              @keydown.escape="cancelAddSource"
            />
            <input
              v-model="newName"
              type="text"
              placeholder="Display name"
              class="add-source-input"
              @keydown.enter="submitAddSource"
              @keydown.escape="cancelAddSource"
            />
            <div v-if="addError" class="add-source-error">{{ addError }}</div>
            <div class="add-source-actions">
              <button class="btn-add-cancel" @click="cancelAddSource">Cancel</button>
              <button class="btn-add-confirm" @click="submitAddSource" :disabled="addLoading">
                {{ addLoading ? 'Adding…' : 'Add' }}
              </button>
            </div>
          </div>
          <div v-else class="settings-row add-row" @click="startAddSource">
            <span class="add-label">+ Add sender</span>
          </div>
        </div>

        <!-- AI Learning / Feedback Log -->
        <div class="settings-group">
          <div class="settings-label">
            AI Learning
            <span v-if="hasOverrides" class="learning-badge">{{ totalOverrides }} correction{{ totalOverrides === 1 ? '' : 's' }}</span>
          </div>

          <div v-if="!hasOverrides" class="learning-empty">
            <div class="learning-empty-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>
            </div>
            <p>No corrections yet. When you change Genco's recommendation, your feedback helps it learn your preferences.</p>
          </div>

          <template v-else>
            <!-- Override patterns -->
            <div v-if="overrideStats" class="override-patterns">
              <div v-for="(stat, action) in overrideStats" :key="action" class="override-row">
                <div class="override-action">
                  <span class="override-action-name">{{ action }}</span>
                  <span class="override-count">overridden {{ stat.overridden }}×</span>
                </div>
                <div class="override-replacements">
                  <span v-for="(count, replacement) in stat.replacedWith" :key="replacement" class="override-chip">
                    → {{ replacement }} ({{ count }})
                  </span>
                </div>
              </div>
            </div>

            <!-- Recent corrections -->
            <div class="recent-label">Recent</div>
            <div v-for="entry in recentFeedback" :key="entry.timestamp" class="feedback-entry">
              <div class="feedback-entry-top">
                <span class="feedback-sender">{{ entry.sender }}</span>
                <span class="feedback-time">{{ timeAgo(entry.timestamp) }}</span>
              </div>
              <div class="feedback-entry-change">
                <span class="feedback-old">{{ entry.originalAction }}</span>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14"/><path d="M12 5l7 7-7 7"/></svg>
                <span class="feedback-new">{{ entry.chosenAction }}</span>
              </div>
              <div v-if="entry.reason" class="feedback-entry-reason">"{{ entry.reason }}"</div>
            </div>

            <button class="btn-clear-feedback" @click="$emit('clear-feedback')">Reset learning data</button>
          </template>
        </div>

        <div class="settings-group">
          <div class="settings-label">Integrations</div>
          <div class="settings-row"><span>Tessio</span> <span class="settings-value">Connected</span></div>
          <div class="settings-row"><span>Luca</span> <span class="settings-value">Connected</span></div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.settings-overlay {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.4);
  backdrop-filter: blur(4px);
  z-index: 400;
  display: none;
  align-items: center;
  justify-content: center;
  padding: 20px;
}

.settings-overlay.visible { display: flex; }

.settings-modal {
  background: var(--color-surface);
  border-radius: 14px;
  width: 100%;
  max-width: 420px;
  max-height: 85vh;
  overflow-y: auto;
  box-shadow: var(--shadow-lg);
  animation: fadeIn 0.2s ease;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(3px); }
  to { opacity: 1; transform: translateY(0); }
}

.settings-header {
  padding: 18px 20px;
  border-bottom: 1px solid var(--color-border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  position: sticky;
  top: 0;
  background: var(--color-surface);
  z-index: 1;
  border-radius: 14px 14px 0 0;
}

.settings-header h2 {
  font-size: 0.95rem;
  font-weight: 600;
  letter-spacing: -0.02em;
}

.modal-close {
  width: 30px;
  height: 30px;
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  color: var(--color-text-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  -webkit-tap-highlight-color: transparent;
}

.modal-close:active { background: var(--color-bg); }

.settings-body {
  padding: 20px;
}

.settings-group {
  margin-bottom: 20px;
}

.settings-group:last-child { margin-bottom: 0; }

.settings-label {
  font-size: 0.72rem;
  font-weight: 500;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-bottom: 10px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.learning-badge {
  font-size: 0.65rem;
  font-weight: 500;
  text-transform: none;
  letter-spacing: 0;
  color: var(--color-accent);
  background: var(--color-accent-soft);
  padding: 2px 8px;
  border-radius: 10px;
}

.settings-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 0;
  border-bottom: 1px solid var(--color-border);
  font-size: 0.82rem;
}

.settings-row:last-child { border-bottom: none; }

.settings-row span {
  color: var(--color-text-secondary);
}

.settings-value {
  font-size: 0.78rem;
  color: var(--color-text-muted);
}

.settings-value.tag-sale { color: var(--color-accent); }
.settings-value.tag-news { color: var(--color-blue); }
.settings-value.tag-update { color: var(--color-purple); }

.settings-row-right {
  display: flex;
  align-items: center;
  gap: 10px;
}

.settings-remove {
  width: 22px;
  height: 22px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  color: var(--color-text-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all var(--transition-fast);
  -webkit-tap-highlight-color: transparent;
  flex-shrink: 0;
}

.settings-remove:hover {
  border-color: var(--color-danger);
  color: var(--color-danger);
  background: rgba(239, 68, 68, 0.06);
}

.add-row {
  justify-content: center;
  border-bottom: none;
  cursor: pointer;
  border-radius: var(--radius-md);
  transition: background var(--transition-fast);
}

.add-row:hover {
  background: var(--color-bg);
}

.add-label {
  font-size: 0.72rem;
  color: var(--color-text-muted) !important;
}

/* ── Add Source Form ── */
.add-source-form {
  padding: 10px 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.add-source-input {
  width: 100%;
  padding: 8px 10px;
  font-size: 0.8rem;
  font-family: inherit;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-bg);
  color: var(--color-text);
  outline: none;
  transition: border-color var(--transition-fast);
  box-sizing: border-box;
}

.add-source-input:focus {
  border-color: var(--color-accent);
}

.add-source-input::placeholder {
  color: var(--color-text-muted);
}

.add-source-error {
  font-size: 0.72rem;
  color: var(--color-danger);
}

.add-source-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.btn-add-cancel {
  font-size: 0.72rem;
  font-family: inherit;
  padding: 5px 12px;
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border);
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.btn-add-cancel:hover {
  color: var(--color-text-secondary);
  border-color: var(--color-text-muted);
}

.btn-add-confirm {
  font-size: 0.72rem;
  font-weight: 500;
  font-family: inherit;
  padding: 5px 14px;
  border-radius: var(--radius-md);
  border: 1px solid var(--color-accent-border);
  background: var(--color-accent-soft);
  color: var(--color-accent);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.btn-add-confirm:hover:not(:disabled) {
  background: var(--color-accent);
  color: white;
}

.btn-add-confirm:disabled {
  opacity: 0.6;
  cursor: default;
}

/* ── AI Learning Section ── */
.learning-empty {
  text-align: center;
  padding: 16px 12px;
  background: var(--color-bg);
  border-radius: var(--radius-lg);
}

.learning-empty-icon {
  color: var(--color-text-muted);
  margin-bottom: 8px;
  opacity: 0.5;
}

.learning-empty p {
  font-size: 0.75rem;
  color: var(--color-text-muted);
  line-height: 1.5;
}

.override-patterns {
  margin-bottom: 14px;
}

.override-row {
  padding: 8px 0;
  border-bottom: 1px solid var(--color-border);
}

.override-row:last-child { border-bottom: none; }

.override-action {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
}

.override-action-name {
  font-size: 0.8rem;
  font-weight: 500;
  color: var(--color-text);
}

.override-count {
  font-size: 0.7rem;
  color: var(--color-text-muted);
}

.override-replacements {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.override-chip {
  font-size: 0.68rem;
  color: var(--color-accent);
  background: var(--color-accent-soft);
  padding: 2px 8px;
  border-radius: 8px;
}

.recent-label {
  font-size: 0.68rem;
  font-weight: 500;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-bottom: 6px;
}

.feedback-entry {
  padding: 8px 0;
  border-bottom: 1px solid var(--color-border);
}

.feedback-entry:last-of-type { border-bottom: none; }

.feedback-entry-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 3px;
}

.feedback-sender {
  font-size: 0.78rem;
  font-weight: 500;
  color: var(--color-text);
}

.feedback-time {
  font-size: 0.68rem;
  color: var(--color-text-muted);
}

.feedback-entry-change {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 0.72rem;
  margin-bottom: 2px;
}

.feedback-entry-change svg {
  color: var(--color-text-muted);
  opacity: 0.5;
}

.feedback-old {
  color: var(--color-text-muted);
  text-decoration: line-through;
}

.feedback-new {
  color: var(--color-accent);
  font-weight: 500;
}

.feedback-entry-reason {
  font-size: 0.72rem;
  color: var(--color-text-secondary);
  font-style: italic;
  margin-top: 2px;
}

.btn-clear-feedback {
  display: block;
  width: 100%;
  margin-top: 12px;
  padding: 8px;
  border-radius: var(--radius-md);
  font-size: 0.72rem;
  font-family: inherit;
  border: 1px solid var(--color-border);
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.btn-clear-feedback:hover {
  border-color: var(--color-danger);
  color: var(--color-danger);
}

.btn-connect {
  font-size: 0.75rem;
  font-weight: 500;
  font-family: inherit;
  padding: 5px 14px;
  border-radius: var(--radius-md);
  border: 1px solid var(--color-accent-border);
  background: var(--color-accent-soft);
  color: var(--color-accent);
  cursor: pointer;
  transition: all var(--transition-fast);
  -webkit-tap-highlight-color: transparent;
}

.btn-connect:hover:not(:disabled) {
  background: var(--color-accent);
  color: white;
}

.btn-connect:disabled {
  opacity: 0.6;
  cursor: default;
}
</style>
