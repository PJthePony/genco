<script setup>
import { ref, watch } from 'vue'
import { timeAgo } from '../lib/formatters.js'

const props = defineProps({
  items: Array,
})

defineEmits(['manage-sources', 'promote', 'open-email'])

const expanded = ref(false)

function toggle() { expanded.value = !expanded.value }

// Auto-collapse when section becomes empty
watch(() => props.items.length, (len) => {
  if (len === 0) expanded.value = false
})
</script>

<template>
  <div class="briefing-digest" :class="{ expanded }">
    <div class="briefing-digest-header" @click="toggle">
      <div class="briefing-digest-left">
        <div class="briefing-digest-icon">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z"/><path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z"/></svg>
        </div>
        <div>
          <div class="briefing-digest-title">Daily Briefing</div>
          <div class="briefing-digest-subtitle">{{ items.length > 0 ? `${items.length} emails summarized & auto-archived` : 'No emails yet today' }}</div>
        </div>
      </div>
      <div class="briefing-digest-right">
        <span class="briefing-digest-badge">{{ items.length }}</span>
        <svg class="briefing-digest-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
      </div>
    </div>
    <div class="briefing-digest-body">
      <div v-if="items.length === 0" class="briefing-digest-empty">
        Nothing here right now.
      </div>
      <template v-else>
        <div class="briefing-digest-items">
          <div class="briefing-item" v-for="(item, i) in items" :key="item.id || i">
            <div class="briefing-item-content" @click="$emit('open-email', item.id)">
              <div class="briefing-item-header">
                <span class="briefing-item-source">{{ item.source }}</span>
                <span class="briefing-item-tag" :class="item.tagClass">{{ item.tag }}</span>
                <span class="briefing-item-time">{{ timeAgo(item.receivedAt) }}</span>
              </div>
              <div class="briefing-item-summary">{{ item.summary }}</div>
            </div>
            <button class="briefing-item-promote" @click.stop="$emit('promote', item.id)" title="Move to action queue" aria-label="Move to action queue">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></svg>
            </button>
          </div>
        </div>
        <div class="briefing-digest-footer">
          <span class="briefing-footer-note">Originals auto-archived</span>
          <button class="briefing-footer-action" @click.stop="$emit('manage-sources')">Manage sources</button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.briefing-digest {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  margin-bottom: 10px;
  box-shadow: var(--shadow-sm);
  overflow: hidden;
}

.briefing-digest-header {
  padding: 14px 18px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: background var(--transition-fast);
}

.briefing-digest-header:hover { background: var(--color-bg); }

.briefing-digest-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.briefing-digest-icon {
  width: 30px;
  height: 30px;
  border-radius: var(--radius-md);
  background: var(--color-blue-soft);
  color: var(--color-blue);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.briefing-digest-title {
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--color-text);
  letter-spacing: -0.01em;
}

.briefing-digest-subtitle {
  font-size: 0.7rem;
  color: var(--color-text-muted);
  margin-top: 1px;
}

.briefing-digest-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.briefing-digest-badge {
  font-size: 0.62rem;
  font-weight: 600;
  color: var(--color-blue);
  background: var(--color-blue-soft);
  padding: 2px 8px;
  border-radius: 100px;
  letter-spacing: 0.02em;
}

.briefing-digest-chevron {
  color: var(--color-text-muted);
  transition: transform var(--transition-fast);
  flex-shrink: 0;
}

.briefing-digest.expanded .briefing-digest-chevron {
  transform: rotate(180deg);
}

.briefing-digest-body {
  max-height: 0;
  overflow: hidden;
  transition: max-height 0.35s cubic-bezier(0.16, 1, 0.3, 1);
}

.briefing-digest.expanded .briefing-digest-body {
  max-height: 80vh;
  overflow-y: auto;
}

.briefing-digest-items {
  padding: 0 18px 14px;
  border-top: 1px solid var(--color-border);
}

.briefing-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 14px 0;
  border-bottom: 1px solid var(--color-border);
}

.briefing-item:last-child { border-bottom: none; }

.briefing-item-content {
  flex: 1;
  min-width: 0;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.briefing-item-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 2px;
}

.briefing-item-source {
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--color-text-secondary);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.briefing-item-tag {
  font-size: 0.58rem;
  font-weight: 500;
  padding: 1px 6px;
  border-radius: 100px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  flex-shrink: 0;
}

.tag-sale { background: var(--color-accent-soft); color: var(--color-accent); }
.tag-news { background: var(--color-blue-soft); color: var(--color-blue); }
.tag-update { background: var(--color-purple-soft); color: var(--color-purple); }

.briefing-item-time {
  font-size: 0.62rem;
  color: var(--color-text-muted);
  white-space: nowrap;
  flex-shrink: 0;
}

.briefing-item-summary {
  font-size: 0.78rem;
  color: var(--color-text-secondary);
  line-height: 1.55;
}

.briefing-item-promote {
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
  flex-shrink: 0;
}

.briefing-item-promote:hover,
.briefing-item-promote:active {
  color: var(--color-accent);
  border-color: var(--color-accent-border);
  background: var(--color-accent-soft);
}

.briefing-digest-footer {
  padding: 10px 18px;
  border-top: 1px solid var(--color-border);
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.briefing-footer-note {
  font-size: 0.68rem;
  color: var(--color-text-muted);
  font-style: italic;
}

.briefing-footer-action {
  font-size: 0.72rem;
  font-weight: 500;
  color: var(--color-text-muted);
  background: none;
  border: none;
  cursor: pointer;
  font-family: inherit;
  padding: 4px 8px;
  border-radius: var(--radius-sm);
  transition: all var(--transition-fast);
  -webkit-tap-highlight-color: transparent;
}

.briefing-footer-action:hover { color: var(--color-text-secondary); background: var(--color-bg); }

.briefing-digest-empty {
  padding: 20px 18px;
  text-align: center;
  font-size: 0.75rem;
  color: var(--color-text-muted);
  border-top: 1px solid var(--color-border);
}

@media (max-width: 768px) {
  .briefing-digest-header {
    padding: 12px 14px;
  }

  .briefing-digest-items {
    padding: 0 14px 12px;
  }

  .briefing-item-header {
    gap: 6px;
  }

  .briefing-item-source {
    max-width: 50%;
    flex-shrink: 1;
  }

  .briefing-item-summary {
    font-size: 0.75rem;
  }

  .briefing-digest-footer {
    padding: 10px 14px;
    flex-wrap: wrap;
    gap: 8px;
  }

  .briefing-footer-action {
    padding: 10px 12px;
    min-height: 44px;
  }

  .briefing-digest-empty {
    padding: 16px 14px;
  }
}
</style>
