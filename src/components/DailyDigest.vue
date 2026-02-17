<script setup>
import { ref } from 'vue'

defineProps({
  items: Array,
})

defineEmits(['manage-sources', 'promote'])

const expanded = ref(false)

function toggle() { expanded.value = !expanded.value }
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
          <div class="briefing-digest-subtitle">{{ items.length }} emails summarized &amp; auto-archived</div>
        </div>
      </div>
      <div class="briefing-digest-right">
        <span class="briefing-digest-badge">{{ items.length }} items</span>
        <svg class="briefing-digest-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
      </div>
    </div>
    <div class="briefing-digest-body">
      <div class="briefing-digest-items">
        <div class="briefing-item" v-for="(item, i) in items" :key="item.id || i">
          <div class="briefing-item-header">
            <span class="briefing-item-source">{{ item.source }}</span>
            <span class="briefing-item-tag" :class="item.tagClass">{{ item.tag }}</span>
            <button class="briefing-item-action" @click.stop="$emit('promote', item.id)">Action</button>
          </div>
          <div class="briefing-item-summary">{{ item.summary }}</div>
        </div>
      </div>
      <div class="briefing-digest-footer">
        <span class="briefing-footer-note">Originals auto-archived</span>
        <button class="briefing-footer-action" @click.stop="$emit('manage-sources')">Manage sources</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.briefing-digest {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  margin-bottom: 24px;
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
  max-height: 60vh;
  overflow-y: auto;
}

.briefing-digest-items {
  padding: 0 18px 14px;
  border-top: 1px solid var(--color-border);
}

.briefing-item {
  padding: 12px 0;
  border-bottom: 1px solid var(--color-border);
}

.briefing-item:last-child { border-bottom: none; }

.briefing-item-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.briefing-item-source {
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--color-text-secondary);
}

.briefing-item-tag {
  font-size: 0.58rem;
  font-weight: 500;
  padding: 1px 6px;
  border-radius: 100px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.tag-sale { background: var(--color-accent-soft); color: var(--color-accent); }
.tag-news { background: var(--color-blue-soft); color: var(--color-blue); }
.tag-update { background: var(--color-purple-soft); color: var(--color-purple); }

.briefing-item-action {
  margin-left: auto;
  font-size: 0.65rem;
  font-weight: 500;
  font-family: inherit;
  color: var(--color-text-muted);
  background: none;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  padding: 2px 8px;
  cursor: pointer;
  transition: all var(--transition-fast);
  -webkit-tap-highlight-color: transparent;
}

.briefing-item-action:hover {
  color: var(--color-accent);
  border-color: var(--color-accent-border);
  background: var(--color-accent-soft);
}

.briefing-item-summary {
  font-size: 0.78rem;
  color: var(--color-text-secondary);
  line-height: 1.55;
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
</style>
