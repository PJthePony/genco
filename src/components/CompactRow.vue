<script setup>
defineProps({
  card: Object,
})

defineEmits(['expand', 'quick-approve'])

function truncate(text, max) {
  if (!text || text.length <= max) return text
  return text.slice(0, max).trimEnd() + '...'
}
</script>

<template>
  <div class="compact-row" :class="{ cleared: card.cleared, urgent: card.isUrgent }">
    <div class="compact-avatar" :class="card.avatarClass">{{ card.initials }}</div>
    <div class="compact-content" @click="$emit('expand')">
      <div class="compact-top">
        <span class="compact-sender">{{ card.sender }}</span>
        <span class="compact-time">{{ card.time }}</span>
      </div>
      <div class="compact-subject">
        <span v-if="card.type === 'message'" class="compact-type-badge">iMessage</span>
        {{ truncate(card.subject || card.messageText, 60) }}
      </div>
      <div class="compact-summary">{{ truncate(card.summary, 80) }}</div>
    </div>
    <div class="compact-right">
      <span class="compact-tag" :class="'tag-' + card.actionKey">{{ card.subAction || card.action }}</span>
      <button class="compact-approve" :class="{ dismiss: card.type === 'message' }" @click.stop="$emit('quick-approve')" :aria-label="card.type === 'message' ? 'Dismiss' : 'Approve'">
        <!-- iMessages: X icon (dismiss) — emails: checkmark (approve) -->
        <svg v-if="card.type === 'message'" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
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

.compact-row.urgent {
  border-left: 2px solid var(--color-accent);
  padding-left: 10px;
  margin-left: -12px;
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

.tag-reply { background: var(--color-blue-soft); color: var(--color-blue); }
.tag-add_task { background: var(--color-purple-soft); color: var(--color-purple); }
.tag-archive { background: var(--color-bg); color: var(--color-text-muted); }
.tag-unsubscribe { background: var(--color-accent-soft); color: var(--color-accent); }
.tag-act { background: var(--color-success-soft); color: var(--color-success); }
.tag-skip { background: var(--color-bg); color: var(--color-text-muted); }

.compact-type-badge {
  font-size: 0.5rem;
  font-weight: 600;
  padding: 1px 4px;
  border-radius: 100px;
  color: #34C759;
  background: rgba(52, 199, 89, 0.1);
  vertical-align: 1px;
  margin-right: 3px;
}

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

.compact-approve.dismiss:hover,
.compact-approve.dismiss:active {
  color: var(--color-text-muted);
  border-color: var(--color-border-light);
  background: var(--color-bg);
}

@media (max-width: 768px) {
  .compact-row {
    gap: 8px;
    padding: 10px 0;
  }

  .compact-row.urgent {
    margin-left: -10px;
    padding-left: 8px;
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
    width: 44px;
    height: 44px;
  }
}
</style>
