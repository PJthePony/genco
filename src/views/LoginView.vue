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
    error.value = err.message || 'Something got lost on the way to the docks. Try again.'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="login-container">
    <div class="login-card">
      <div class="login-icon" aria-hidden="true">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
      </div>
      <p class="login-eyebrow">Genco · Inbox</p>
      <h1 class="login-title">Send word.</h1>
      <p class="login-subtitle">No password. We'll mail you a link.</p>

      <div v-if="linkSent" class="link-sent">
        <h2>Check your email.</h2>
        <p>We sent a magic link to <strong>{{ email }}</strong>.</p>
        <p class="link-sent-hint">Click the link to sign in. You can close this tab.</p>
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
          {{ submitting ? 'Sending…' : 'Send magic link' }}
        </button>

        <p class="login-hint">
          The door's always open.
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
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: var(--bg);
  font-family: var(--font-sans);
  position: relative;
}

/* Grain overlay — subtle paper noise */
.login-container::before {
  content: '';
  position: fixed;
  inset: 0;
  background-image: radial-gradient(rgba(20, 34, 53, 0.025) 1px, transparent 1px);
  background-size: 3px 3px;
  pointer-events: none;
  z-index: 0;
}

.login-card {
  position: relative;
  z-index: 1;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-hang-md);
  padding: 48px 40px;
  width: 100%;
  max-width: 440px;
  text-align: center;
}

.login-icon {
  width: 44px;
  height: 44px;
  border-radius: var(--radius-lg);
  background: rgba(212, 36, 111, 0.08);
  border: 1px solid rgba(212, 36, 111, 0.18);
  color: var(--accent);
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto 20px;
}

.login-eyebrow {
  font-family: var(--font-sans);
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--text-muted);
  margin-bottom: 14px;
  font-feature-settings: "c2sc", "smcp";
}

.login-title {
  font-family: var(--font-serif);
  font-size: clamp(2rem, 3.5vw, 2.75rem);
  font-weight: 700;
  line-height: 1.05;
  letter-spacing: -0.035em;
  font-variation-settings: 'opsz' 96, 'WONK' 1;
  color: var(--text);
  margin-bottom: 10px;
}

.login-subtitle {
  font-family: var(--font-sans);
  color: var(--text-muted);
  font-size: 0.92rem;
  margin-bottom: 32px;
}

.login-form { text-align: left; }

.form-group { margin-bottom: 18px; }

.form-group label {
  display: block;
  font-family: var(--font-sans);
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  font-feature-settings: "c2sc", "smcp";
  color: var(--text-muted);
  margin-bottom: 8px;
}

.form-group input {
  width: 100%;
  padding: 11px 14px;
  font-family: var(--font-sans);
  font-size: 0.94rem;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  background: var(--bg-card);
  color: var(--text);
  transition: border-color var(--dur-2) var(--ease-out-expo),
              box-shadow var(--dur-2) var(--ease-out-expo);
}

.form-group input:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 3px rgba(212, 36, 111, 0.12);
}

.form-group input:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.login-btn {
  width: 100%;
  padding: 11px 16px;
  font-family: var(--font-sans);
  font-size: 0.92rem;
  font-weight: 600;
  letter-spacing: -0.005em;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: background var(--dur-2) var(--ease-out-expo),
              transform var(--dur-2) var(--ease-out-expo),
              box-shadow var(--dur-2) var(--ease-out-expo);
}

.login-btn.primary {
  background: var(--fuchsia-600);
  color: #fff;
  box-shadow: 0 12px 22px -14px rgba(212, 36, 111, 0.55),
              0 1px 0 rgba(255, 255, 255, 0.15) inset;
}
.login-btn.primary:hover:not(:disabled) {
  background: var(--fuchsia-800);
  transform: translateY(-1px);
  box-shadow: 0 18px 28px -14px rgba(212, 36, 111, 0.65),
              0 1px 0 rgba(255, 255, 255, 0.15) inset;
}
.login-btn.primary:active:not(:disabled) {
  transform: translateY(0);
}
.login-btn.primary:disabled {
  opacity: 0.45;
  cursor: not-allowed;
  box-shadow: none;
}

.login-btn.secondary {
  background: transparent;
  color: var(--text-muted);
  border: 1px solid var(--border-strong);
  margin-top: 16px;
  font-weight: 500;
}
.login-btn.secondary:hover {
  color: var(--text);
  border-color: var(--navy-200);
  background: rgba(20, 34, 53, 0.03);
}

.login-error {
  background: var(--danger-100);
  color: var(--danger-600);
  padding: 10px 14px;
  border-radius: var(--radius-sm);
  font-size: 0.85rem;
  margin-bottom: 16px;
  border: 1px solid rgba(168, 58, 74, 0.2);
}

.login-hint {
  text-align: center;
  font-family: var(--font-serif);
  font-style: italic;
  color: var(--text-muted);
  font-size: 0.88rem;
  margin-top: 18px;
  font-variation-settings: 'opsz' 14;
}

.link-sent { padding: 4px 0; text-align: left; }

.link-sent h2 {
  font-family: var(--font-serif);
  font-size: 1.35rem;
  font-weight: 600;
  letter-spacing: -0.02em;
  color: var(--text);
  margin-bottom: 8px;
}

.link-sent p {
  color: var(--text-muted);
  font-size: 0.92rem;
  margin-bottom: 4px;
  line-height: 1.55;
}

.link-sent strong { color: var(--text); font-weight: 600; }

.link-sent-hint {
  color: var(--text-subtle) !important;
  font-size: 0.82rem !important;
  margin-top: 12px !important;
  margin-bottom: 4px !important;
}

.login-legal {
  position: relative;
  z-index: 1;
  display: flex;
  justify-content: center;
  gap: 16px;
  margin-top: 24px;
}

.login-legal a {
  font-family: var(--font-sans);
  font-size: 0.7rem;
  color: var(--text-muted);
  text-decoration: none;
  transition: color var(--dur-2) var(--ease-out-expo);
}

.login-legal a:hover { color: var(--accent); }

@media (max-width: 640px) {
  .login-card { padding: 36px 24px; }
  .login-btn { min-height: 44px; }
  .form-group input { min-height: 44px; }
}
</style>
