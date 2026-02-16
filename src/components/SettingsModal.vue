<script setup>
defineProps({
  open: Boolean,
  sources: Array,
})

defineEmits(['close', 'remove-source'])
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
          <div class="settings-row"><span>Gmail</span> <span class="settings-value">pjtanzillo@gmail.com</span></div>
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
          <div class="settings-row add-row"><span class="add-label">+ Add sender</span></div>
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
}

.add-label {
  font-size: 0.72rem;
  color: var(--color-text-muted) !important;
}
</style>
