<script setup>
const FAMILY_URL = 'https://family.tanzillo.ai'

function goToFamily() {
  window.location.href = `${FAMILY_URL}/?return_app=genco`
}
</script>

<template>
  <main class="page">
    <header class="bar">
      <a class="brand" :href="FAMILY_URL">
        <img class="icon" src="https://family.tanzillo.ai/apple-touch-icon.png" alt="" />
        <span class="word">Genco</span>
      </a>
      <button class="btn ghost" @click="goToFamily">Sign in to The Family</button>
    </header>

    <section class="hero">
      <div class="eyebrow">tanzillo.ai · Communications</div>
      <h1 class="display-italic title">Genco handles the inbox.</h1>
      <p class="lead">An hourly scan of your email turns into a morning decision queue. Urgent things text you. Everything else waits in a stack of cards you'll clear in ten minutes.</p>
      <button class="btn primary" @click="goToFamily">Sign in to The Family</button>
    </section>

    <section class="features">
      <article class="feature">
        <h3>A queue, not a chat</h3>
        <p>Each email is a card with sender, summary, and a recommended action. Approve, edit, or decline in one click.</p>
      </article>
      <article class="feature">
        <h3>Five clear actions</h3>
        <p>Add to Tessio. Reply. Compose new. Take direct action (RSVP, unsubscribe). Archive. Nothing more to think about.</p>
      </article>
      <article class="feature">
        <h3>It learns from your no</h3>
        <p>Every time you decline or edit a draft, Genco gets a little better at writing for you next time.</p>
      </article>
    </section>

    <footer class="footer">
      <span>The Family · tanzillo.ai</span>
      <span class="sep">·</span>
      <a href="https://tanzillo.ai/terms.html">Terms</a>
      <span class="sep">·</span>
      <a href="https://tanzillo.ai/privacy.html">Privacy</a>
    </footer>
  </main>
</template>

<style scoped>
.page { min-height: 100dvh; background: var(--bg); display: flex; flex-direction: column; }
.bar { display: flex; align-items: center; justify-content: space-between; padding: var(--space-4) var(--space-5); border-bottom: 1px solid var(--border); position: sticky; top: 0; z-index: 10; background: var(--bg); backdrop-filter: saturate(140%) blur(8px); }
.brand { display: flex; align-items: center; gap: var(--space-3); text-decoration: none; color: var(--text); }
.icon { width: 24px; height: 24px; border-radius: var(--radius-sm); display: block; }
.word { font-family: var(--font-serif); font-weight: 600; font-size: var(--step-1); letter-spacing: -0.01em; }

.hero { max-width: 720px; margin: 0 auto; padding: var(--space-9) var(--space-5) var(--space-7); text-align: center; }
.title { font-size: var(--step-5); color: var(--accent); margin: var(--space-3) 0 var(--space-5); }
.lead { margin: 0 auto var(--space-7); max-width: 52ch; text-align: center; }

.features { max-width: 920px; margin: 0 auto; padding: 0 var(--space-5) var(--space-9); display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: var(--space-6); }
.feature { background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: var(--space-6); }
.feature h3 { font-family: var(--font-serif); font-size: var(--step-2); font-weight: 600; font-variation-settings: 'opsz' 36; letter-spacing: -0.014em; color: var(--text); margin: 0 0 var(--space-3); }
.feature p { font-size: var(--step--1); color: var(--text-muted); line-height: 1.6; margin: 0; }

.btn { display: inline-flex; align-items: center; justify-content: center; padding: var(--space-3) var(--space-5); font-family: var(--font-sans); font-size: var(--step-0); font-weight: 600; border-radius: var(--radius-md); cursor: pointer; transition: background var(--dur-2) var(--ease-out-expo), border-color var(--dur-2) var(--ease-out-expo), transform var(--dur-2) var(--ease-out-expo); border: 1px solid transparent; }
.btn.primary { color: white; background: var(--accent); padding: var(--space-4) var(--space-6); }
.btn.primary:hover { background: var(--accent-hover); transform: translateY(-1px); }
.btn.ghost { color: var(--text); background: transparent; border-color: var(--border-strong); font-size: var(--step--1); padding: var(--space-2) var(--space-4); }
.btn.ghost:hover { background: var(--bg-elevated); }

.footer { margin-top: auto; padding: var(--space-5) var(--space-5) var(--space-6); display: flex; justify-content: center; align-items: center; gap: var(--space-3); font-size: var(--step--1); color: var(--text-muted); border-top: 1px solid var(--border); }
.footer a { color: var(--text-muted); text-decoration: none; }
.footer a:hover { color: var(--accent); }
.sep { opacity: 0.5; }

@media (max-width: 640px) { .hero { padding-top: var(--space-7); } }
</style>
