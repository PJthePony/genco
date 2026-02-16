<script setup>
defineProps({
  open: Boolean,
  email: Object,
})

defineEmits(['close'])
</script>

<template>
  <div class="modal-overlay" :class="{ visible: open }" @click="$emit('close')">
    <div class="modal" v-if="email" @click.stop>
      <div class="modal-handle"></div>
      <div class="modal-header">
        <h2 class="modal-subject">{{ email.subject }}</h2>
        <button class="modal-close" @click="$emit('close')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="modal-meta">
        <div class="modal-meta-row"><span class="modal-meta-label">From</span><span class="modal-meta-value">{{ email.from }}</span></div>
        <div class="modal-meta-row"><span class="modal-meta-label">To</span><span class="modal-meta-value">{{ email.to }}</span></div>
        <div class="modal-meta-row"><span class="modal-meta-label">Date</span><span class="modal-meta-value">{{ email.date }}</span></div>
      </div>
      <div class="modal-body" v-html="email.body"></div>
    </div>
  </div>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.4);
  backdrop-filter: blur(4px);
  z-index: 300;
  display: none;
  align-items: flex-end;
  justify-content: center;
}

.modal-overlay.visible { display: flex; }

.modal {
  background: var(--color-surface);
  border-radius: 16px 16px 0 0;
  width: 100%;
  max-width: 600px;
  max-height: 85vh;
  overflow-y: auto;
  animation: modalUp 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  box-shadow: var(--shadow-lg);
}

@keyframes modalUp {
  from { transform: translateY(100%); }
  to { transform: translateY(0); }
}

.modal-handle {
  width: 36px;
  height: 4px;
  background: var(--color-border);
  border-radius: 2px;
  margin: 10px auto 0;
}

.modal-header {
  padding: 16px 20px 0;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.modal-subject {
  font-size: 1rem;
  font-weight: 600;
  letter-spacing: -0.02em;
  flex: 1;
  line-height: 1.3;
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

.modal-meta {
  padding: 12px 20px;
  border-bottom: 1px solid var(--color-border);
}

.modal-meta-row {
  display: flex;
  gap: 8px;
  font-size: 0.75rem;
  line-height: 1.6;
}

.modal-meta-label {
  color: var(--color-text-muted);
  min-width: 36px;
  font-weight: 500;
}

.modal-meta-value {
  color: var(--color-text-secondary);
}

.modal-body {
  padding: 20px;
  font-size: 0.82rem;
  color: var(--color-text-secondary);
  line-height: 1.7;
}

.modal-body :deep(p) { margin-bottom: 14px; }
.modal-body :deep(p:last-child) { margin-bottom: 0; }

.modal-body :deep(.sig) {
  color: var(--color-text-muted);
  border-top: 1px solid var(--color-border);
  padding-top: 14px;
  margin-top: 14px;
  font-size: 0.78rem;
}

@media (min-width: 641px) {
  .modal {
    border-radius: 14px;
    max-height: 70vh;
    margin-bottom: 40px;
  }

  .modal-overlay {
    align-items: center;
  }

  .modal-handle { display: none; }
}
</style>
