<script setup>
import { ref, watch, computed } from 'vue'
import CompactRow from './CompactRow.vue'
import DecisionCard from './DecisionCard.vue'

const props = defineProps({
  section: Object,
  bulkProgress: Object,
})

const emit = defineEmits([
  'approve',
  'skip',
  'open-email',
  'feedback',
  'bulk-approve',
])

const expanded = ref(props.section.count > 0)
const expandedCardId = ref(null)

function toggle() { expanded.value = !expanded.value }

// Reset expanded card if it leaves the section (action override moved it)
watch(() => props.section.cards, (cards) => {
  if (expandedCardId.value && !cards.find(c => c.id === expandedCardId.value)) {
    expandedCardId.value = null
  }
})

const bulkLabel = computed(() => {
  const n = props.section.count
  if (props.section.key === 'archive') return `Archive all ${n}`
  return `Approve all ${n}`
})

function handleApprove(cardId, msg) {
  expandedCardId.value = null
  emit('approve', cardId, msg)
}

function handleQuickApprove(card) {
  // iMessage replies need review — expand instead of quick-approving
  if (card.type === 'message' && card.actionKey === 'reply') {
    expandedCardId.value = card.id
    return
  }
  emit('approve', card.id, card.actionMsg)
}

function handleSkip(cardId) {
  expandedCardId.value = null
  emit('skip', cardId)
}
</script>

<template>
  <div class="action-section" :class="{ expanded }">
    <div class="section-header" @click="toggle">
      <div class="section-header-left">
        <div class="section-icon" :class="section.key">
          <svg v-if="section.key === 'action'" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
          <svg v-else width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/></svg>
        </div>
        <div>
          <div class="section-label">{{ section.label }}</div>
          <div class="section-sublabel">{{ section.sublabel }}</div>
        </div>
      </div>
      <div class="section-header-right">
        <span v-if="section.urgentCount" class="urgent-badge">{{ section.urgentCount }} urgent</span>
        <span class="count-badge" :class="section.key">{{ section.count }}</span>
        <svg class="section-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
      </div>
    </div>

    <!-- Bulk approve bar -->
    <div v-if="expanded && section.count > 1" class="bulk-bar">
      <button
        class="btn-bulk"
        @click.stop="$emit('bulk-approve', section.key)"
        :disabled="bulkProgress?.active"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
        {{ bulkProgress?.active ? `${bulkProgress.completed}/${bulkProgress.total}` : bulkLabel }}
      </button>
    </div>

    <!-- Card list -->
    <div v-if="expanded" class="section-body">
      <div v-if="section.count === 0" class="section-empty">
        Nothing here right now.
      </div>
      <template v-for="card in section.cards" :key="card.id">
        <div v-if="expandedCardId === card.id" class="expanded-card-wrapper">
          <button class="btn-collapse" @click="expandedCardId = null">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>
            Collapse
          </button>
          <DecisionCard
            :card="card"
            @approve="handleApprove"
            @skip="handleSkip"
            @open-email="$emit('open-email', $event)"
            @feedback="$emit('feedback', $event)"
          />
        </div>
        <CompactRow
          v-else
          :card="card"
          @expand="expandedCardId = card.id"
          @quick-approve="handleQuickApprove(card)"
        />
      </template>
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

.section-icon.action {
  background: var(--color-accent-soft);
  color: var(--color-accent);
}

.section-icon.archive {
  background: var(--color-bg);
  color: var(--color-text-muted);
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

.urgent-badge {
  font-size: 0.58rem;
  font-weight: 600;
  color: var(--color-accent);
  background: var(--color-accent-soft);
  padding: 2px 8px;
  border-radius: 100px;
  letter-spacing: 0.02em;
}

.count-badge {
  font-size: 0.62rem;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 100px;
  letter-spacing: 0.02em;
}

.count-badge.action {
  color: var(--color-accent);
  background: var(--color-accent-soft);
}

.count-badge.archive {
  color: var(--color-text-muted);
  background: var(--color-bg);
}

.section-chevron {
  color: var(--color-text-muted);
  transition: transform var(--transition-fast);
  flex-shrink: 0;
}

.action-section.expanded .section-chevron {
  transform: rotate(180deg);
}

/* Bulk approve bar */
.bulk-bar {
  padding: 8px 18px;
  border-top: 1px solid var(--color-border);
  display: flex;
  align-items: center;
}

.btn-bulk {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 18px;
  border-radius: var(--radius-md);
  font-size: 0.75rem;
  font-weight: 600;
  font-family: inherit;
  border: none;
  background: var(--color-primary);
  color: #fff;
  cursor: pointer;
  transition: all var(--transition-fast);
  -webkit-tap-highlight-color: transparent;
}

.btn-bulk:hover:not(:disabled) { background: var(--color-primary-hover); }
.btn-bulk:active:not(:disabled) { transform: scale(0.98); }
.btn-bulk:disabled { opacity: 0.6; cursor: default; }

/* Card list */
.section-body {
  padding: 0 18px 8px;
  border-top: 1px solid var(--color-border);
}

.expanded-card-wrapper {
  padding: 12px 0 4px;
}

.btn-collapse {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 0.68rem;
  font-weight: 500;
  font-family: inherit;
  color: var(--color-text-muted);
  background: none;
  border: none;
  cursor: pointer;
  padding: 4px 0;
  margin-bottom: 8px;
  -webkit-tap-highlight-color: transparent;
}

.btn-collapse:hover { color: var(--color-text-secondary); }

.section-empty {
  padding: 20px 0;
  text-align: center;
  font-size: 0.75rem;
  color: var(--color-text-muted);
}

@media (max-width: 640px) {
  .section-header {
    padding: 12px 14px;
  }

  .section-sublabel {
    font-size: 0.65rem;
  }

  .section-header-right {
    gap: 6px;
    flex-shrink: 0;
  }

  .btn-bulk {
    padding: 10px 18px;
    width: 100%;
    justify-content: center;
  }

  .btn-collapse {
    padding: 10px 0;
  }

  .section-body {
    padding: 0 14px 8px;
  }

  .bulk-bar {
    padding: 8px 14px;
  }
}
</style>
