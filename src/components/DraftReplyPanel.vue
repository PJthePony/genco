<script setup>
import { ref, computed, onBeforeUnmount } from 'vue'

const props = defineProps({
  // Identity
  cardId: { type: String, required: true },
  contactName: { type: String, default: '' },
  contactEmail: { type: String, default: '' },
  contactPhone: { type: String, default: null },
  // Label for the default draft action button
  draftButtonLabel: { type: String, default: 'Draft reply' },
  // Channel flags: which send destinations are available
  canSend: { type: Boolean, default: true },
  canSaveDraft: { type: Boolean, default: true },
  canSendImessage: { type: Boolean, default: false },
  // Optional starting draft (e.g. AI-generated already cached on the card)
  initialDraft: { type: String, default: '' },
})

const emit = defineEmits([
  // All async ops use a resolve callback the parent must invoke
  'fetch-suggestions',       // (cardId, resolve(string[]))
  'generate-draft',          // (cardId, { direction?, previousDraft?, feedback?, voiceBucketId? }, resolve({ draft, voiceLabel, voiceSource, activeBucketId, availableBuckets }))
  'send',                    // (cardId, body, { cc: string[] })     — actually sends to Gmail
  'save-draft',              // (cardId, body)
  'send-imessage',           // (cardId, body)
  'closed',                  // user cancelled the flow
])

// State machine: 'direction' | 'drafting' | 'review'
const phase = ref(props.initialDraft ? 'review' : 'direction')
const directionOptions = ref([])
const loadingSuggestions = ref(false)
const customDirection = ref('')
const pickedDirection = ref('')
const draftText = ref(props.initialDraft || '')
const feedback = ref('')
const refining = ref(false)

// Voice
const voiceLabel = ref(null)
const voiceSource = ref(null)  // 'history' | 'bucket' | 'default'
const activeBucketId = ref(null)
const availableBuckets = ref([])
const showVoiceMenu = ref(false)

// Meeting detection → offer to CC Luca
const suggestsMeeting = ref(false)
const lucaEmail = ref(null)
const ccLuca = ref(false)

// Send / undo
const pendingSend = ref(false)
const undoSecondsLeft = ref(0)
let undoTimer = null
let undoInterval = null
const sendError = ref('')

const hasPhone = computed(() => !!props.contactPhone)

function emitAsync(eventName, ...args) {
  return new Promise((resolve) => {
    emit(eventName, ...args, resolve)
  })
}

async function loadSuggestions() {
  loadingSuggestions.value = true
  try {
    const opts = await emitAsync('fetch-suggestions', props.cardId)
    directionOptions.value = Array.isArray(opts) ? opts : []
  } finally {
    loadingSuggestions.value = false
  }
}

// Kick off suggestions on mount if we're in direction phase
if (phase.value === 'direction') {
  loadSuggestions()
}

function pickDirection(text) {
  pickedDirection.value = text
  customDirection.value = ''
  generate({ direction: text })
}

function pickCustom() {
  if (!customDirection.value.trim()) return
  pickedDirection.value = customDirection.value.trim()
  generate({ direction: pickedDirection.value })
}

function pickNoDirection() {
  pickedDirection.value = ''
  generate({ direction: '' })
}

async function generate(opts) {
  phase.value = 'drafting'
  const res = await emitAsync('generate-draft', props.cardId, opts)
  if (res && (res.draft || typeof res === 'string')) {
    const draft = typeof res === 'string' ? res : res.draft
    draftText.value = draft
    if (typeof res === 'object') {
      voiceLabel.value = res.voiceLabel || null
      voiceSource.value = res.voiceSource || null
      activeBucketId.value = res.activeBucketId || null
      if (Array.isArray(res.availableBuckets)) {
        availableBuckets.value = res.availableBuckets
      }
      if ('lucaEmail' in res) lucaEmail.value = res.lucaEmail || null
      if ('suggestsMeeting' in res) {
        suggestsMeeting.value = !!res.suggestsMeeting
        // Default the checkbox to on when we detect a meeting AND Luca is configured
        ccLuca.value = suggestsMeeting.value && !!lucaEmail.value
      }
    }
    phase.value = 'review'
  } else {
    phase.value = 'direction'
  }
}

async function refineDraft() {
  if (!feedback.value.trim()) return
  refining.value = true
  const res = await emitAsync('generate-draft', props.cardId, {
    previousDraft: draftText.value,
    feedback: feedback.value.trim(),
    voiceBucketId: activeBucketId.value,
  })
  if (res) {
    const draft = typeof res === 'string' ? res : res.draft
    if (draft) draftText.value = draft
    if (typeof res === 'object') {
      voiceLabel.value = res.voiceLabel || voiceLabel.value
      voiceSource.value = res.voiceSource || voiceSource.value
      if ('lucaEmail' in res) lucaEmail.value = res.lucaEmail || lucaEmail.value
      if ('suggestsMeeting' in res) {
        const now = !!res.suggestsMeeting
        // If the refined draft no longer suggests a meeting, auto-uncheck
        if (!now) ccLuca.value = false
        else if (!suggestsMeeting.value && lucaEmail.value) ccLuca.value = true
        suggestsMeeting.value = now
      }
    }
    feedback.value = ''
  }
  refining.value = false
}

async function switchVoice(bucketId) {
  showVoiceMenu.value = false
  if (!draftText.value.trim()) {
    // No draft yet — just remember selection for next generate
    activeBucketId.value = bucketId
    return
  }
  refining.value = true
  const res = await emitAsync('generate-draft', props.cardId, {
    previousDraft: draftText.value,
    feedback: 'Rewrite this in a different voice for the same recipient. Same meaning, different tone.',
    voiceBucketId: bucketId,
  })
  if (res) {
    const draft = typeof res === 'string' ? res : res.draft
    if (draft) draftText.value = draft
    if (typeof res === 'object') {
      voiceLabel.value = res.voiceLabel || voiceLabel.value
      voiceSource.value = res.voiceSource || 'bucket'
      activeBucketId.value = res.activeBucketId || bucketId
    }
  }
  refining.value = false
}

function cancelDraft() {
  clearUndoTimers()
  phase.value = 'direction'
  pickedDirection.value = ''
  customDirection.value = ''
  feedback.value = ''
  draftText.value = ''
  emit('closed')
}

// ── Send with 5s undo ────────────────────────────────────────────────────
const UNDO_SECONDS = 5

function handleSendNow() {
  if (!draftText.value.trim() || pendingSend.value) return
  const body = draftText.value.trim()
  pendingSend.value = true
  sendError.value = ''
  undoSecondsLeft.value = UNDO_SECONDS

  undoInterval = setInterval(() => {
    undoSecondsLeft.value -= 1
    if (undoSecondsLeft.value <= 0) {
      clearInterval(undoInterval)
      undoInterval = null
    }
  }, 1000)

  const cc = ccLuca.value && lucaEmail.value ? [lucaEmail.value] : []
  undoTimer = setTimeout(async () => {
    clearUndoTimers()
    try {
      await emitAsync('send', props.cardId, body, { cc })
    } catch (err) {
      sendError.value = err?.message || 'Send failed'
      pendingSend.value = false
    }
  }, UNDO_SECONDS * 1000)
}

function undoSend() {
  clearUndoTimers()
  pendingSend.value = false
  undoSecondsLeft.value = 0
}

function clearUndoTimers() {
  if (undoTimer) { clearTimeout(undoTimer); undoTimer = null }
  if (undoInterval) { clearInterval(undoInterval); undoInterval = null }
}

onBeforeUnmount(clearUndoTimers)

function handleSaveDraft() {
  if (!draftText.value.trim()) return
  emit('save-draft', props.cardId, draftText.value.trim())
}

function handleSendImessage() {
  if (!draftText.value.trim()) return
  emit('send-imessage', props.cardId, draftText.value.trim())
}
</script>

<template>
  <div class="draft-panel">
    <!-- Phase: direction -->
    <div v-if="phase === 'direction'">
      <div class="phase-label">{{ draftButtonLabel }} — pick a direction:</div>
      <div v-if="loadingSuggestions" class="loading-row">
        <span class="spinner"></span>
        Loading suggestions...
      </div>
      <template v-else>
        <div class="chips">
          <button
            v-for="opt in directionOptions"
            :key="opt"
            class="chip"
            @click="pickDirection(opt)"
          >{{ opt }}</button>
        </div>
        <div class="custom-row">
          <input
            v-model="customDirection"
            class="text-input"
            placeholder="Other — type your own…"
            @keyup.enter="pickCustom"
          />
          <button class="btn-primary" @click="pickCustom" :disabled="!customDirection.trim()">Generate</button>
        </div>
        <div class="footer-row">
          <button class="btn-link" @click="pickNoDirection">Skip — let AI decide</button>
          <button class="btn-link" @click="cancelDraft">Cancel</button>
        </div>
      </template>
    </div>

    <!-- Phase: drafting -->
    <div v-else-if="phase === 'drafting'" class="loading-row">
      <span class="spinner"></span>
      Drafting{{ pickedDirection ? `: ${pickedDirection}` : '' }}…
    </div>

    <!-- Phase: review -->
    <div v-else-if="phase === 'review'">
      <!-- Voice tag with switcher -->
      <div v-if="voiceLabel" class="voice-row">
        <div class="voice-tag">
          Voice: <strong>{{ voiceLabel }}</strong>
          <span class="voice-source">· {{ voiceSource === 'history' ? 'from your history' : 'inferred bucket' }}</span>
        </div>
        <div v-if="availableBuckets.length > 0" class="voice-switch">
          <button class="btn-link" @click="showVoiceMenu = !showVoiceMenu">
            Switch voice ▾
          </button>
          <div v-if="showVoiceMenu" class="voice-menu">
            <button
              v-for="b in availableBuckets"
              :key="b.id"
              class="voice-menu-item"
              :class="{ active: b.id === activeBucketId }"
              @click="switchVoice(b.id)"
            >
              {{ b.label }}
              <span class="dim">· {{ b.formalityScore }}/100</span>
            </button>
          </div>
        </div>
      </div>

      <textarea
        v-model="draftText"
        class="draft-textarea"
        rows="6"
        placeholder="Your reply..."
        :disabled="pendingSend"
      ></textarea>

      <!-- Refine row -->
      <div v-if="!pendingSend" class="refine-row">
        <input
          v-model="feedback"
          class="text-input"
          placeholder="Refine: shorter, less formal, mention the Tuesday call…"
          :disabled="refining"
          @keyup.enter="refineDraft"
        />
        <button class="btn-secondary" @click="refineDraft" :disabled="refining || !feedback.trim()">
          {{ refining ? 'Refining…' : 'Refine' }}
        </button>
      </div>

      <!-- Meeting → CC calendar assistant toggle -->
      <label v-if="!pendingSend && suggestsMeeting && lucaEmail" class="cc-luca-row">
        <input type="checkbox" v-model="ccLuca" />
        <span>
          Looks like a meeting — <strong>CC calendar assistant</strong> ({{ lucaEmail }}) to find a time
        </span>
      </label>

      <!-- Action row -->
      <div v-if="!pendingSend" class="actions-row">
        <button
          v-if="canSend"
          class="btn-send"
          @click="handleSendNow"
          :disabled="refining || !draftText.trim()"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
          Send
        </button>
        <button v-if="canSaveDraft" class="btn-secondary" @click="handleSaveDraft" :disabled="refining || !draftText.trim()">
          Save to Drafts
        </button>
        <button v-if="canSendImessage && hasPhone" class="btn-secondary" @click="handleSendImessage" :disabled="refining || !draftText.trim()">
          iMessage
        </button>
        <button class="btn-link" @click="cancelDraft" :disabled="refining">Cancel</button>
      </div>

      <!-- Undo pending state -->
      <div v-else class="undo-row">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
        Sending to {{ contactEmail || contactName }}{{ ccLuca && lucaEmail ? ` + ${lucaEmail}` : '' }} in {{ undoSecondsLeft }}s…
        <button class="btn-undo" @click="undoSend">Undo</button>
      </div>

      <p v-if="sendError" class="error-line">{{ sendError }}</p>
    </div>
  </div>
</template>

<style scoped>
.draft-panel {
  margin: 8px 0 10px;
}

.phase-label {
  font-size: 0.7rem;
  color: var(--color-text-muted);
  margin-bottom: 8px;
  letter-spacing: 0.02em;
}

.loading-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.72rem;
  color: var(--color-text-muted);
  padding: 12px 0;
}

.spinner {
  width: 14px;
  height: 14px;
  border: 2px solid var(--color-border);
  border-top-color: var(--color-accent);
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
  flex-shrink: 0;
}

@keyframes spin { to { transform: rotate(360deg); } }

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 10px;
}

.chip {
  padding: 6px 12px;
  border-radius: var(--radius-pill);
  font-size: 0.72rem;
  font-family: inherit;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.chip:hover {
  border-color: var(--color-accent-border);
  color: var(--color-accent);
  background: var(--color-accent-soft);
}

.custom-row {
  display: flex;
  gap: 6px;
  margin-bottom: 8px;
}

.text-input {
  flex: 1;
  padding: 8px 10px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  font-size: 0.72rem;
  font-family: inherit;
  background: var(--color-bg);
  color: var(--color-text);
}

.text-input:focus {
  outline: none;
  border-color: var(--color-accent-border);
}

.btn-primary {
  padding: 6px 14px;
  border-radius: var(--radius-md);
  font-size: 0.72rem;
  font-weight: 600;
  font-family: inherit;
  background: var(--color-primary, var(--color-accent));
  color: #fff;
  border: none;
  cursor: pointer;
}

.btn-primary:disabled { opacity: 0.4; cursor: default; }

.btn-secondary {
  padding: 6px 14px;
  border-radius: var(--radius-md);
  font-size: 0.72rem;
  font-weight: 600;
  font-family: inherit;
  background: var(--color-surface);
  color: var(--color-text-secondary);
  border: 1px solid var(--color-border);
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 4px;
}

.btn-secondary:hover:not(:disabled) {
  border-color: var(--color-accent-border);
  color: var(--color-accent);
}

.btn-secondary:disabled { opacity: 0.4; cursor: default; }

.btn-link {
  background: none;
  border: none;
  color: var(--color-text-muted);
  font-size: 0.68rem;
  font-family: inherit;
  cursor: pointer;
  padding: 0;
}

.btn-link:hover { color: var(--color-text); }

.footer-row {
  display: flex;
  gap: 12px;
  font-size: 0.68rem;
}

.voice-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
  flex-wrap: wrap;
}

.voice-tag {
  font-size: 0.62rem;
  color: var(--color-text-muted);
  letter-spacing: 0.02em;
}

.voice-tag strong { color: var(--color-text-secondary); font-weight: 600; }

.voice-source {
  opacity: 0.7;
  margin-left: 4px;
}

.voice-switch {
  position: relative;
}

.voice-menu {
  position: absolute;
  top: 100%;
  right: 0;
  margin-top: 4px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-md);
  z-index: 20;
  overflow: hidden;
  min-width: 180px;
}

.voice-menu-item {
  display: block;
  width: 100%;
  padding: 8px 12px;
  font-size: 0.72rem;
  font-family: inherit;
  color: var(--color-text-secondary);
  background: none;
  border: none;
  text-align: left;
  cursor: pointer;
  white-space: nowrap;
}

.voice-menu-item:hover { background: var(--color-bg); color: var(--color-text); }
.voice-menu-item.active { color: var(--color-accent); font-weight: 600; }

.dim { color: var(--color-text-muted); margin-left: 6px; }

.draft-textarea {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  font-size: 0.8rem;
  font-family: inherit;
  color: var(--color-text);
  background: var(--color-bg);
  resize: vertical;
  line-height: 1.5;
}

.draft-textarea:focus {
  outline: none;
  border-color: var(--color-accent-border);
}

.draft-textarea:disabled { opacity: 0.6; }

.refine-row {
  display: flex;
  gap: 6px;
  margin-top: 8px;
}

.actions-row {
  display: flex;
  gap: 8px;
  margin-top: 10px;
  flex-wrap: wrap;
  align-items: center;
}

.cc-luca-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 10px 0 0;
  padding: 8px 10px;
  border-radius: var(--radius-md);
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  font-size: 0.72rem;
  color: var(--color-text-secondary);
  cursor: pointer;
}

.cc-luca-row input[type="checkbox"] { cursor: pointer; }
.cc-luca-row strong { color: var(--color-text); font-weight: 600; }

.btn-send {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 16px;
  border-radius: var(--radius-md);
  font-size: 0.72rem;
  font-weight: 600;
  font-family: inherit;
  border: none;
  background: var(--color-accent);
  color: #fff;
  cursor: pointer;
}

.btn-send:hover:not(:disabled) { filter: brightness(1.05); }
.btn-send:disabled { opacity: 0.4; cursor: default; }

.undo-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  margin-top: 10px;
  border-radius: var(--radius-md);
  background: var(--color-accent-soft);
  border: 1px solid var(--color-accent-border, var(--color-accent));
  color: var(--color-accent);
  font-size: 0.72rem;
  font-weight: 500;
}

.btn-undo {
  margin-left: auto;
  padding: 4px 12px;
  border-radius: var(--radius-sm);
  font-size: 0.72rem;
  font-weight: 600;
  font-family: inherit;
  background: var(--color-surface);
  color: var(--color-accent);
  border: 1px solid var(--color-accent);
  cursor: pointer;
}

.btn-undo:hover { background: var(--color-accent); color: #fff; }

.error-line {
  color: var(--color-danger, #a83a4a);
  font-size: 0.72rem;
  margin: 6px 0 0;
}
</style>
