<script setup>
import { useRouter } from 'vue-router'

const router = useRouter()

const goToLogin = () => {
  router.push({ name: 'Login' })
}
</script>

<template>
  <div class="landing">
    <!-- Ambient particles -->
    <div class="particles">
      <div class="particle" v-for="n in 15" :key="n"></div>
    </div>

    <!-- Nav -->
    <nav class="landing-nav">
      <div class="nav-logo">
        <img src="/logo.svg" alt="pjt" width="28" height="27" />
      </div>
      <span class="nav-brand">tanzillo.ai</span>
    </nav>

    <!-- Hero -->
    <section class="hero">
      <div class="hero-content">
        <div class="hero-icon">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#f97316" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
        </div>
        <h1 class="hero-headline">Genco</h1>
        <p class="hero-description">Your morning email briefing.</p>
        <button class="sign-in-btn" @click="goToLogin">Sign In</button>
      </div>
    </section>

    <!-- Footer -->
    <footer class="landing-footer">
      <span class="footer-copy">&copy; 2026 tanzillo.ai</span>
      <div class="footer-links">
        <a href="https://tanzillo.ai/privacy.html" target="_blank">Privacy</a>
        <a href="https://tanzillo.ai/terms.html" target="_blank">Terms</a>
      </div>
    </footer>
  </div>
</template>

<style scoped>
.landing {
  --bg: #0a0e1a;
  --text: #f1f5f9;
  --text-muted: #94a3b8;
  --accent: #f97316;
  --surface: rgba(255, 255, 255, 0.04);
  --border: rgba(255, 255, 255, 0.06);

  font-family: 'IBM Plex Sans', -apple-system, BlinkMacSystemFont, sans-serif;
  background: var(--bg);
  color: var(--text);
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  position: relative;
  overflow: hidden;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

/* ── Particles ── */
.particles {
  position: fixed;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  overflow: hidden;
}

.particle {
  position: absolute;
  width: 2px;
  height: 2px;
  background: rgba(249, 115, 22, 0.15);
  border-radius: 50%;
  animation: particleFloat linear infinite;
}

.particle:nth-child(1)  { left: 5%;  top: 10%; animation-duration: 28s; animation-delay: 0s; }
.particle:nth-child(2)  { left: 15%; top: 80%; animation-duration: 22s; animation-delay: -4s;  width: 3px; height: 3px; background: rgba(241,245,249,0.06); }
.particle:nth-child(3)  { left: 25%; top: 30%; animation-duration: 32s; animation-delay: -8s;  width: 1px; height: 1px; }
.particle:nth-child(4)  { left: 35%; top: 60%; animation-duration: 26s; animation-delay: -2s;  background: rgba(241,245,249,0.05); }
.particle:nth-child(5)  { left: 45%; top: 15%; animation-duration: 30s; animation-delay: -12s; width: 3px; height: 3px; }
.particle:nth-child(6)  { left: 55%; top: 70%; animation-duration: 24s; animation-delay: -6s;  width: 1px; height: 1px; background: rgba(241,245,249,0.07); }
.particle:nth-child(7)  { left: 65%; top: 40%; animation-duration: 34s; animation-delay: -10s; }
.particle:nth-child(8)  { left: 75%; top: 85%; animation-duration: 20s; animation-delay: -3s;  background: rgba(249,115,22,0.1); }
.particle:nth-child(9)  { left: 85%; top: 25%; animation-duration: 28s; animation-delay: -7s;  width: 1px; height: 1px; }
.particle:nth-child(10) { left: 92%; top: 55%; animation-duration: 36s; animation-delay: -14s; width: 3px; height: 3px; background: rgba(241,245,249,0.04); }
.particle:nth-child(11) { left: 10%; top: 45%; animation-duration: 25s; animation-delay: -5s;  background: rgba(249,115,22,0.08); }
.particle:nth-child(12) { left: 40%; top: 90%; animation-duration: 30s; animation-delay: -9s;  width: 1px; height: 1px; }
.particle:nth-child(13) { left: 70%; top: 5%;  animation-duration: 27s; animation-delay: -11s; background: rgba(241,245,249,0.05); }
.particle:nth-child(14) { left: 50%; top: 50%; animation-duration: 33s; animation-delay: -1s;  width: 1px; height: 1px; background: rgba(249,115,22,0.12); }
.particle:nth-child(15) { left: 20%; top: 65%; animation-duration: 29s; animation-delay: -13s; }

@keyframes particleFloat {
  0%   { transform: translate(0, 0) scale(1);       opacity: 0; }
  10%  { opacity: 1; }
  50%  { transform: translate(60px, -120px) scale(1.5); opacity: 0.6; }
  90%  { opacity: 1; }
  100% { transform: translate(-30px, -240px) scale(1); opacity: 0; }
}

/* ── Nav ── */
.landing-nav {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 100;
  padding: 24px 40px;
  display: flex;
  align-items: center;
  gap: 14px;
  background: linear-gradient(to bottom, rgba(10,14,26,0.95) 0%, rgba(10,14,26,0) 100%);
  pointer-events: none;
}

.landing-nav > * { pointer-events: auto; }

.nav-logo img {
  display: block;
}

.nav-brand {
  font-size: 0.95rem;
  font-weight: 500;
  color: var(--text);
  letter-spacing: -0.01em;
}

/* ── Hero ── */
.hero {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  z-index: 1;
  padding: 24px;
}

.hero-content {
  text-align: center;
  max-width: 480px;
  opacity: 0;
  transform: translateY(30px);
  animation: fadeSlideUp 1s cubic-bezier(0.16, 1, 0.3, 1) 0.3s forwards;
}

.hero-icon {
  width: 56px;
  height: 56px;
  border-radius: 16px;
  background: rgba(249, 115, 22, 0.08);
  border: 1px solid rgba(249, 115, 22, 0.15);
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto 24px;
}

.hero-headline {
  font-size: clamp(2.5rem, 5vw, 4rem);
  font-weight: 700;
  line-height: 1.1;
  letter-spacing: -0.04em;
  color: var(--text);
  margin-bottom: 16px;
}

.hero-description {
  font-size: 1.15rem;
  line-height: 1.7;
  color: var(--text-muted);
  font-weight: 300;
  margin-bottom: 40px;
}

.sign-in-btn {
  display: inline-block;
  padding: 12px 36px;
  background: var(--accent);
  color: white;
  border: none;
  border-radius: 8px;
  font-family: inherit;
  font-size: 0.95rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 150ms ease, transform 150ms ease;
  letter-spacing: -0.01em;
}

.sign-in-btn:hover {
  background: #ea6c0e;
  transform: translateY(-1px);
}

.sign-in-btn:active {
  transform: translateY(0);
}

@keyframes fadeSlideUp {
  to { opacity: 1; transform: translateY(0); }
}

/* ── Footer ── */
.landing-footer {
  position: relative;
  z-index: 1;
  padding: 32px 40px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-top: 1px solid var(--border);
}

.footer-copy {
  font-size: 0.75rem;
  color: var(--text-muted);
  font-weight: 300;
}

.footer-links {
  display: flex;
  gap: 16px;
}

.footer-links a {
  font-size: 0.75rem;
  color: var(--text-muted);
  font-weight: 300;
  text-decoration: none;
  transition: color 0.2s;
}

.footer-links a:hover {
  color: var(--accent);
}

/* ── Mobile ── */
@media (max-width: 640px) {
  .landing-nav {
    padding: 18px 20px;
  }

  .landing-footer {
    padding: 24px 20px;
  }

  .hero-description {
    font-size: 1rem;
  }
}
</style>
