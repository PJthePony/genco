<script setup>
defineProps({
  message: String,
  visible: Boolean,
})
</script>

<template>
  <div class="toast" :class="{ visible }">{{ message }}</div>
</template>

<style scoped>
.toast {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%) translateY(20px);
  padding: 10px 20px;
  border-radius: var(--radius-lg);
  background: var(--color-text);
  color: var(--color-bg);
  font-size: 0.78rem;
  font-weight: 500;
  opacity: 0;
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  pointer-events: none;
  z-index: 200;
  box-shadow: var(--shadow-md);
}

.toast.visible {
  opacity: 1;
  transform: translateX(-50%) translateY(0);
}
</style>
