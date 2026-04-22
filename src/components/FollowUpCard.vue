<script setup>
import { ref, computed } from 'vue'
import DraftReplyPanel from './DraftReplyPanel.vue'

const props = defineProps({
  card: Object,
  expanded: Boolean,
})

const emit = defineEmits([
  'expand', 'snooze', 'dismiss', 'noise',
  'fetch-suggestions', 'generate-draft', 'send', 'save-draft', 'send-imessage',
])

const showSnoozeOptions = ref(false)
const draftOpen = ref(false)

const hasPhone = computed(() => !!props.card.contactPhone)

const gmailUrl = computed(() => {
  if (!props.card.gmailThreadId) return null
  return `https://mail.google.com/mail/u/0/#all/${props.card.gmailThreadId}`
})

const draftButtonLabel = computed(() => {
  return props.card.suggestedAction === 'nudge' ? 'Draft check-in' : 'Draft reply'
})

function truncate(text, max) {
  if (!text || text.length <= max) return text
  return text.slice(0, max).trimEnd() + '...'
}

function openDraft() {
  draftOpen.value = true
}

function onDraftClosed() {
  draftOpen.value = false
}
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

    <DraftReplyPanel
      v-if="draftOpen"
      :card-id="card.id"
      :contact-name="card.contactName"
      :contact-email="card.contactEmail"
      :contact-phone="card.contactPhone"
      :draft-button-label="draftButtonLabel"
      :initial-draft="card.aiDraft || ''"
      :can-send="true"
      :can-save-draft="true"
      :can-send-imessage="true"
      @fetch-suggestions="(id, resolve) => emit('fetch-suggestions', id, resolve)"
      @generate-draft="(id, opts, resolve) => emit('generate-draft', id, opts, resolve)"
      @send="(id, body) => emit('send', id, body)"
      @save-draft="(id, body) => emit('save-draft', id, body)"
      @send-imessage="(id, body) => emit('send-imessage', id, body)"
      @closed="onDraftClosed"
    />

    <!-- Action row (hidden while the draft panel is open) -->
    <div v-else class="expanded-actions">
      <button class="btn-action btn-draft" @click="openDraft">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        {{ card.aiDraft ? 'View draft' : draftButtonLabel }}
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
/* ── Compact row ── */
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
.av-red { background: var(--color-danger-soft); color: var(--color-danger); }

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
  font-family: var(--font-sans);
  font-size: 0.58rem;
  font-weight: 700;
  padding: 2px 7px;
  border-radius: var(--radius-pill);
  text-transform: uppercase;
  letter-spacing: 0.1em;
  white-space: nowrap;
}

.tag-went_cold { background: var(--color-accent-soft); color: var(--color-accent); }
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

@media (max-width: 768px) {
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
  padding: 8px 18px;
  border-radius: var(--radius-md);
  font-size: 0.875rem;
  font-weight: 600;
  letter-spacing: -0.005em;
  font-family: inherit;
  border: 1px solid var(--color-border);
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: all var(--transition-fast);
  -webkit-tap-highlight-color: transparent;
}

.btn-action:hover:not(:disabled) {
  border-color: var(--color-text-muted);
  color: var(--color-text);
}

.btn-draft:hover:not(:disabled) {
  border-color: var(--color-accent-border);
  color: var(--color-accent);
}

.snooze-wrapper { position: relative; }

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

.btn-noise {
  margin-left: auto;
  color: var(--color-text-muted);
  border-color: transparent;
  opacity: 0.6;
}
.btn-noise:hover {
  opacity: 1;
  color: var(--color-danger);
  border-color: rgba(168, 58, 74, 0.25);
}

@media (max-width: 768px) {
  .compact-row {
    gap: 8px;
    padding: 10px 0;
  }

  .compact-sender { font-size: 0.72rem; }
  .compact-subject { font-size: 0.68rem; }
  .compact-summary { font-size: 0.65rem; }

  .compact-right { gap: 4px; }

  .compact-tag {
    font-size: 0.5rem;
    padding: 2px 5px;
  }

  .compact-approve {
    width: 44px;
    height: 44px;
  }

  .expanded-panel {
    padding-left: 0;
  }

  .expanded-actions { gap: 6px; }

  .btn-action {
    padding: 10px 14px;
    min-height: 44px;
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
}
</style>
