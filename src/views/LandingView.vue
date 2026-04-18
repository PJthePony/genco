<script setup>
import { useRouter } from 'vue-router'

const router = useRouter()

const goToLogin = () => {
  router.push({ name: 'Login' })
}
</script>

<template>
  <div class="landing">
    <!-- Ambient particles — dust in the stage light -->
    <div class="particles" aria-hidden="true">
      <div class="particle" v-for="n in 14" :key="n"></div>
    </div>

    <!-- Nav -->
    <nav class="landing-nav">
      <a class="nav-brand" href="https://tanzillo.ai">tanzillo<span class="dot-accent">.</span>ai</a>
      <div class="nav-status">
        <span class="status-dot"></span>
        <span>Nobody gets ignored on my watch</span>
      </div>
    </nav>

    <!-- Hero -->
    <section class="hero">
      <div class="hero-content">
        <div class="hero-icon" aria-hidden="true">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
        </div>
        <p class="hero-eyebrow">Genco · Inbox</p>
        <h1 class="hero-headline">
          My inbox gets handled <em>every hour.</em>
        </h1>
        <p class="hero-description">
          Reads everything. Drafts replies in my voice. Flags anything that needs a human decision.
        </p>
        <button class="sign-in-btn" @click="goToLogin">Open the door</button>
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
  font-family: var(--font-sans);
  background: var(--navy-600);
  color: var(--sage-200);
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  position: relative;
  overflow: hidden;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  hanging-punctuation: first last;
}

/* Pinstripe overlay — technical drawing / stage scrim */
.landing::before {
  content: '';
  position: absolute;
  inset: 0;
  background: repeating-linear-gradient(
    90deg,
    transparent,
    transparent 39px,
    rgba(240, 245, 243, 0.018) 39px,
    rgba(240, 245, 243, 0.018) 40px
  );
  pointer-events: none;
  z-index: 0;
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
  background: rgba(212, 36, 111, 0.08);
  border-radius: 50%;
  animation: particleFloat linear infinite;
}

.particle:nth-child(1)  { left: 5%;  top: 10%; animation-duration: 28s; animation-delay: 0s; }
.particle:nth-child(2)  { left: 15%; top: 80%; animation-duration: 22s; animation-delay: -4s;  width: 3px; height: 3px; background: rgba(13, 92, 82, 0.06); }
.particle:nth-child(3)  { left: 25%; top: 30%; animation-duration: 32s; animation-delay: -8s;  width: 1px; height: 1px; }
.particle:nth-child(4)  { left: 35%; top: 60%; animation-duration: 26s; animation-delay: -2s;  background: rgba(240, 245, 243, 0.05); }
.particle:nth-child(5)  { left: 45%; top: 15%; animation-duration: 30s; animation-delay: -12s; width: 3px; height: 3px; background: rgba(13, 92, 82, 0.05); }
.particle:nth-child(6)  { left: 55%; top: 70%; animation-duration: 24s; animation-delay: -6s;  width: 1px; height: 1px; background: rgba(240, 245, 243, 0.06); }
.particle:nth-child(7)  { left: 65%; top: 40%; animation-duration: 34s; animation-delay: -10s; }
.particle:nth-child(8)  { left: 75%; top: 85%; animation-duration: 20s; animation-delay: -3s;  background: rgba(212, 36, 111, 0.06); }
.particle:nth-child(9)  { left: 85%; top: 25%; animation-duration: 28s; animation-delay: -7s;  width: 1px; height: 1px; }
.particle:nth-child(10) { left: 92%; top: 55%; animation-duration: 36s; animation-delay: -14s; width: 3px; height: 3px; background: rgba(240, 245, 243, 0.04); }
.particle:nth-child(11) { left: 10%; top: 45%; animation-duration: 25s; animation-delay: -5s;  background: rgba(212, 36, 111, 0.06); }
.particle:nth-child(12) { left: 40%; top: 90%; animation-duration: 30s; animation-delay: -9s;  width: 1px; height: 1px; }
.particle:nth-child(13) { left: 70%; top: 5%;  animation-duration: 27s; animation-delay: -11s; background: rgba(240, 245, 243, 0.05); }
.particle:nth-child(14) { left: 50%; top: 50%; animation-duration: 33s; animation-delay: -1s;  width: 1px; height: 1px; background: rgba(212, 36, 111, 0.10); }

@keyframes particleFloat {
  0%   { transform: translate(0, 0) scale(1); opacity: 0; }
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
  padding: 22px 40px;
  display: flex;
  align-items: center;
  gap: 14px;
  background: rgba(38, 60, 78, 0.4);
  backdrop-filter: blur(20px) saturate(1.4);
  -webkit-backdrop-filter: blur(20px) saturate(1.4);
  pointer-events: none;
}

.landing-nav > * { pointer-events: auto; }

.nav-brand {
  font-family: var(--font-serif);
  font-size: 1.15rem;
  font-weight: 700;
  font-variation-settings: 'opsz' 24, 'WONK' 1;
  color: var(--sage-200);
  letter-spacing: -0.02em;
  text-decoration: none;
}
.nav-brand .dot-accent { color: var(--fuchsia-400); }

.nav-status {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-left: auto;
  font-family: var(--font-sans);
  font-size: 0.74rem;
  color: var(--sage-200);
  letter-spacing: 0.02em;
}

.status-dot {
  width: 6px;
  height: 6px;
  background: var(--success-600);
  border-radius: 50%;
  box-shadow: 0 0 0 3px rgba(43, 138, 110, 0.25);
  animation: pulse 3s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
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
  max-width: 560px;
  opacity: 0;
  transform: translateY(24px);
  animation: fadeSettle 1.1s var(--ease-out-expo) 0.25s forwards;
}

.hero-icon {
  width: 52px;
  height: 52px;
  border-radius: 12px;
  background: rgba(212, 36, 111, 0.12);
  border: 1px solid rgba(212, 36, 111, 0.25);
  color: var(--fuchsia-400);
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto 32px;
}

.hero-eyebrow {
  font-family: var(--font-sans);
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--sage-600);
  margin-bottom: 20px;
  font-feature-settings: "c2sc", "smcp";
}

.hero-headline {
  font-family: var(--font-serif);
  font-size: clamp(2.75rem, 5.5vw, 4.5rem);
  font-weight: 700;
  font-variation-settings: 'opsz' 144, 'WONK' 1;
  line-height: 1.05;
  letter-spacing: -0.035em;
  color: var(--sage-100);
  margin-bottom: 24px;
  text-wrap: balance;
  max-width: 16ch;
  margin-inline: auto;
}
.hero-headline em {
  color: var(--fuchsia-400);
  font-style: italic;
  font-weight: 600;
}

.hero-description {
  font-family: var(--font-sans);
  font-size: 1.08rem;
  line-height: 1.65;
  color: var(--navy-100);
  font-weight: 400;
  margin: 0 auto 40px;
  max-width: 44ch;
}

.sign-in-btn {
  display: inline-block;
  padding: 12px 28px;
  background: var(--fuchsia-600);
  color: #fff;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  font-family: var(--font-sans);
  font-size: 0.92rem;
  font-weight: 600;
  letter-spacing: -0.005em;
  box-shadow: 0 12px 22px -14px rgba(212, 36, 111, 0.55),
              0 1px 0 rgba(255, 255, 255, 0.15) inset;
  transition: background var(--dur-2) var(--ease-out-expo),
              transform var(--dur-2) var(--ease-out-expo),
              box-shadow var(--dur-2) var(--ease-out-expo);
}

.sign-in-btn:hover {
  background: var(--fuchsia-800);
  transform: translateY(-1px);
  box-shadow: 0 18px 28px -14px rgba(212, 36, 111, 0.65),
              0 1px 0 rgba(255, 255, 255, 0.15) inset;
}

.sign-in-btn:active {
  transform: translateY(0);
  box-shadow: 0 6px 14px -10px rgba(212, 36, 111, 0.5),
              0 1px 0 rgba(255, 255, 255, 0.15) inset;
}

@keyframes fadeSettle {
  to { opacity: 1; transform: translateY(0); }
}

/* ── Footer ── */
.landing-footer {
  position: relative;
  z-index: 1;
  padding: 28px 40px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-top: 1px solid rgba(240, 245, 243, 0.08);
}

.footer-copy {
  font-family: var(--font-sans);
  font-size: 0.72rem;
  color: var(--navy-100);
  font-weight: 400;
}

.footer-links {
  display: flex;
  gap: 16px;
}

.footer-links a {
  font-family: var(--font-sans);
  font-size: 0.72rem;
  color: var(--navy-100);
  font-weight: 400;
  text-decoration: none;
  transition: color var(--dur-2) var(--ease-out-expo);
}

.footer-links a:hover { color: var(--fuchsia-400); }

/* ── Mobile ── */
@media (max-width: 640px) {
  .landing-nav { padding: 16px 20px; }
  .landing-footer { padding: 20px 20px; }
  .hero-description { font-size: 1rem; }
  .nav-status { font-size: 0.7rem; }
}
</style>
