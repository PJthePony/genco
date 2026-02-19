<script setup>
import { ref } from 'vue'
import FollowUpCard from './FollowUpCard.vue'

const props = defineProps({
  items: Array,
  scanning: Boolean,
  scanProgress: Object,
})

const emit = defineEmits(['draft', 'snooze', 'dismiss', 'noise', 'act', 'save-draft', 'send-imessage', 'scan-threads'])

const expanded = ref(props.items.length > 0)
const expandedCardId = ref(null)

function toggle() { expanded.value = !expanded.value }

function toggleCard(id) {
  expandedCardId.value = expandedCardId.value === id ? null : id
}

function handleSnooze(id, days) {
  expandedCardId.value = null
  emit('snooze', id, days)
}

function handleDismiss(id) {
  expandedCardId.value = null
  emit('dismiss', id)
}

function handleDraft(id) {
  emit('draft', id)
}

function handleSaveDraft(id, body) {
  emit('save-draft', id, body)
}

function handleSendMessage(id, body) {
  emit('send-imessage', id, body)
}

function handleNoise(id) {
  expandedCardId.value = null
  emit('noise', id)
}
</script>

<template>
  <div class="action-section" :class="{ expanded }">
    <div class="section-header" @click="toggle">
      <div class="section-header-left">
        <div class="section-icon followup">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
        </div>
        <div>
          <div class="section-label">Follow Up</div>
          <div class="section-sublabel">Threads needing attention</div>
        </div>
      </div>
      <div class="section-header-right">
        <span class="count-badge followup">{{ items.length }}</span>
        <svg class="section-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
      </div>
    </div>

    <div v-if="expanded" class="section-body">
      <!-- Scan progress -->
      <div v-if="scanning" class="scan-progress">
        <span class="scan-spinner"></span>
        <span class="scan-phase">{{ scanProgress?.phase || 'Scanning...' }}</span>
        <span v-if="scanProgress?.found" class="scan-found">{{ scanProgress.found }} found</span>
      </div>

      <template v-else-if="items.length > 0">
        <FollowUpCard
          v-for="card in items"
          :key="card.id"
          :card="card"
          :expanded="expandedCardId === card.id"
          @expand="toggleCard(card.id)"
          @draft="handleDraft"
          @snooze="handleSnooze"
          @dismiss="handleDismiss"
          @noise="handleNoise"
          @save-draft="handleSaveDraft"
          @send-imessage="handleSendMessage"
        />
      </template>
      <div v-else class="empty-state">
        <p>Scan your Gmail threads to find conversations that need attention.</p>
        <button class="btn-scan" @click.stop="$emit('scan-threads')" :disabled="scanning">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
          Scan threads
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.action-section {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  margin-bottom: 10px;
  box-shadow: var(--shadow-sm);
  overflow: hidden;
}

.section-header {
  padding: 14px 18px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: background var(--transition-fast);
}

.section-header:hover { background: var(--color-bg); }

.section-header-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.section-icon {
  width: 30px;
  height: 30px;
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.section-icon.followup {
  background: var(--color-success-soft);
  color: var(--color-success);
}

.section-label {
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--color-text);
  letter-spacing: -0.01em;
}

.section-sublabel {
  font-size: 0.7rem;
  color: var(--color-text-muted);
  margin-top: 1px;
}

.section-header-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.count-badge {
  font-size: 0.62rem;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 100px;
  letter-spacing: 0.02em;
}

.count-badge.followup {
  color: var(--color-success);
  background: var(--color-success-soft);
}

.section-chevron {
  color: var(--color-text-muted);
  transition: transform var(--transition-fast);
  flex-shrink: 0;
}

.action-section.expanded .section-chevron {
  transform: rotate(180deg);
}

.section-body {
  padding: 0 18px 8px;
  border-top: 1px solid var(--color-border);
}

.empty-state {
  padding: 16px 4px 8px;
  text-align: center;
}

.empty-state p {
  font-size: 0.72rem;
  color: var(--color-text-muted);
  line-height: 1.5;
  margin: 0 0 12px;
}

.btn-scan {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 8px 18px;
  border-radius: var(--radius-md);
  font-size: 0.72rem;
  font-weight: 600;
  font-family: inherit;
  border: none;
  background: var(--color-primary);
  color: #fff;
  cursor: pointer;
  transition: background var(--transition-fast);
}

.btn-scan:hover:not(:disabled) { background: var(--color-primary-hover); }
.btn-scan:disabled { opacity: 0.5; cursor: default; }

.scan-progress {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 16px 4px;
}

.scan-spinner {
  width: 14px;
  height: 14px;
  border: 2px solid var(--color-border);
  border-top-color: var(--color-accent);
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
  flex-shrink: 0;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.scan-phase {
  font-size: 0.72rem;
  color: var(--color-text-muted);
}

.scan-found {
  font-size: 0.68rem;
  font-weight: 600;
  color: var(--color-success);
  margin-left: auto;
}

@media (max-width: 640px) {
  .btn-scan {
    min-height: 44px;
  }

  .section-header {
    padding: 14px 14px;
  }

  .section-body {
    padding: 0 14px 8px;
  }
}
</style>
