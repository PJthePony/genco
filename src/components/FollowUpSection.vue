<script setup>
import { ref } from 'vue'
import FollowUpCard from './FollowUpCard.vue'

const props = defineProps({
  items: Array,
  scanning: Boolean,
  scanProgress: Object,
})

const emit = defineEmits(['draft', 'snooze', 'dismiss', 'act', 'save-draft', 'manage-network', 'scan-threads'])

const expanded = ref(true)

function toggle() { expanded.value = !expanded.value }

function handleSnooze(id, days) {
  emit('snooze', id, days)
}

function handleDismiss(id) {
  emit('dismiss', id)
}

function handleDraft(id) {
  emit('draft', id)
}

function handleSaveDraft(id, body) {
  emit('save-draft', id, body)
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
        <span v-if="items.length > 0" class="count-badge followup">{{ items.length }}</span>
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
          @draft="handleDraft"
          @snooze="handleSnooze"
          @dismiss="handleDismiss"
          @save-draft="handleSaveDraft"
          @act="$emit('act', $event)"
        />
      </template>
      <div v-else class="empty-state">
        <p>Scan your Gmail threads to find conversations that need attention.</p>
        <button class="btn-scan" @click.stop="$emit('scan-threads')" :disabled="scanning">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          Scan threads
        </button>
      </div>

      <div class="section-footer">
        <button class="btn-manage" @click.stop="$emit('scan-threads')" :disabled="scanning">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
          {{ scanning ? 'Scanning...' : 'Scan threads' }}
        </button>
        <button class="btn-manage" @click.stop="$emit('manage-network')">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
          Manage network
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
  margin-bottom: 16px;
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

.section-footer {
  padding: 10px 0 4px;
  display: flex;
  justify-content: center;
}

.btn-manage {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 6px 14px;
  border-radius: var(--radius-md);
  font-size: 0.68rem;
  font-weight: 500;
  font-family: inherit;
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  color: var(--color-text-muted);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.btn-manage:hover {
  color: var(--color-text-secondary);
  border-color: var(--color-text-muted);
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
</style>
