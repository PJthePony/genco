<script setup>
import { ref } from 'vue'
import { useAuth } from '../composables/useAuth'

const { signIn } = useAuth()

const email = ref('')
const error = ref('')
const linkSent = ref(false)
const submitting = ref(false)

const handleSubmit = async () => {
  error.value = ''
  submitting.value = true

  try {
    await signIn(email.value.trim())
    linkSent.value = true
  } catch (err) {
    error.value = err.message || 'Failed to send magic link. Please try again.'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="login-container">
    <div class="login-card">
      <div class="login-logo">
        <img src="/logo.svg" alt="pjt" width="56" height="54" />
      </div>
      <h1 class="login-title">Genco</h1>
      <p class="login-subtitle">Your morning email briefing</p>

      <div v-if="linkSent" class="link-sent">
        <div class="link-sent-icon">✉</div>
        <h2>Check your email</h2>
        <p>We sent a magic link to <strong>{{ email }}</strong></p>
        <p class="link-sent-hint">Click the link in the email to sign in. You can close this tab.</p>
        <button class="login-btn secondary" @click="linkSent = false; email = ''">
          Use a different email
        </button>
      </div>

      <form v-else @submit.prevent="handleSubmit" class="login-form">
        <div class="form-group">
          <label for="email">Email address</label>
          <input
            id="email"
            v-model="email"
            type="email"
            placeholder="you@example.com"
            required
            autofocus
            :disabled="submitting"
          />
        </div>

        <div v-if="error" class="login-error">{{ error }}</div>

        <button
          type="submit"
          class="login-btn primary"
          :disabled="submitting || !email.trim()"
        >
          {{ submitting ? 'Sending...' : 'Send Magic Link' }}
        </button>

        <p class="login-hint">
          No password needed. We'll email you a link to sign in.
        </p>
      </form>
    </div>
    <div class="login-legal">
      <a href="https://tanzillo.ai/privacy.html" target="_blank">Privacy</a>
      <a href="https://tanzillo.ai/terms.html" target="_blank">Terms</a>
    </div>
  </div>
</template>

<style scoped>
.login-container {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background-color: var(--color-bg);
}

.login-card {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-md);
  padding: 48px 40px;
  width: 100%;
  max-width: 420px;
  text-align: center;
}

.login-logo {
  display: flex;
  justify-content: center;
  margin-bottom: 12px;
}

.login-title {
  font-size: 1.15rem;
  font-weight: 600;
  letter-spacing: -0.02em;
  margin-bottom: 4px;
}

.login-subtitle {
  color: var(--color-text-muted);
  font-size: 14px;
  margin-bottom: 36px;
}

.login-form {
  text-align: left;
}

.form-group {
  margin-bottom: 20px;
}

.form-group label {
  display: block;
  font-size: 13px;
  font-weight: 700;
  color: var(--color-text-secondary);
  margin-bottom: 6px;
}

.form-group input {
  width: 100%;
  padding: 10px 12px;
  font-family: inherit;
  font-size: 14px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-bg);
  color: var(--color-text);
  transition: border-color var(--transition);
}

.form-group input:focus {
  outline: none;
  border-color: var(--color-primary);
  box-shadow: 0 0 0 3px rgba(71, 85, 105, 0.1);
}

.form-group input:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.login-btn {
  width: 100%;
  padding: 10px 16px;
  font-family: inherit;
  font-size: 14px;
  font-weight: 700;
  border: none;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all var(--transition);
}

.login-btn.primary {
  background: var(--color-primary);
  color: white;
}

.login-btn.primary:hover:not(:disabled) {
  background: var(--color-primary-hover);
}

.login-btn.primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.login-btn.secondary {
  background: var(--color-bg);
  color: var(--color-text-secondary);
  border: 1px solid var(--color-border);
  margin-top: 16px;
}

.login-btn.secondary:hover {
  background: var(--color-border);
}

.login-error {
  background: #f5e8e8;
  color: var(--color-danger);
  padding: 10px 12px;
  border-radius: var(--radius-md);
  font-size: 13px;
  margin-bottom: 16px;
}

.login-hint {
  text-align: center;
  color: var(--color-text-muted);
  font-size: 12px;
  margin-top: 16px;
}

.link-sent {
  padding: 12px 0;
}

.link-sent-icon {
  font-size: 48px;
  margin-bottom: 16px;
}

.link-sent h2 {
  font-size: 20px;
  font-weight: 700;
  color: var(--color-text);
  margin-bottom: 8px;
}

.link-sent p {
  color: var(--color-text-secondary);
  font-size: 14px;
  margin-bottom: 4px;
}

.link-sent strong {
  color: var(--color-text);
}

.link-sent-hint {
  color: var(--color-text-muted);
  font-size: 12px;
  margin-top: 12px;
  margin-bottom: 8px;
}

.login-legal {
  display: flex;
  justify-content: center;
  gap: 16px;
  margin-top: 24px;
}

.login-legal a {
  font-size: 11px;
  color: var(--color-text-muted);
  text-decoration: none;
  transition: color 0.2s;
}

.login-legal a:hover {
  color: var(--color-primary);
}
</style>
