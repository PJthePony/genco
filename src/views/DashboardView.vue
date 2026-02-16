<script setup>
import { ref, computed } from 'vue'
import { useAuth } from '../composables/useAuth'
import AppHeader from '../components/AppHeader.vue'
import DecisionCard from '../components/DecisionCard.vue'
import DailyDigest from '../components/DailyDigest.vue'
import EmailModal from '../components/EmailModal.vue'
import SettingsModal from '../components/SettingsModal.vue'
import ToastNotification from '../components/ToastNotification.vue'

const { signOut } = useAuth()

// ── Toast ──
const toastMessage = ref('')
const toastVisible = ref(false)
let toastTimer = null

function showToast(message) {
  toastMessage.value = message
  toastVisible.value = true
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { toastVisible.value = false }, 1600)
}

// ── Settings ──
const settingsOpen = ref(false)

// ── Briefing Sources ──
const briefingSources = ref([
  { name: 'Patagonia', tag: 'Sale', tagClass: 'tag-sale' },
  { name: 'Huckberry', tag: 'Sale', tagClass: 'tag-sale' },
  { name: 'Philly Inquirer', tag: 'News', tagClass: 'tag-news' },
  { name: 'Morning Brew', tag: 'Update', tagClass: 'tag-update' },
])

function removeBriefingSource(index) {
  const name = briefingSources.value[index].name
  briefingSources.value.splice(index, 1)
  showToast(`${name} removed from briefing`)
}

// ── Email Modal ──
const emailModalOpen = ref(false)
const activeEmail = ref(null)

const emails = {
  'email-1': {
    subject: 'Re: Q3 Partnership Proposal',
    from: 'Sarah Chen <sarah@acmecorp.com>',
    to: 'pjtanzillo@gmail.com',
    date: 'Feb 16, 2025 at 7:14 AM',
    body: '<p>Hi PJ,</p><p>Thanks for the great conversation last week. I\'ve run the numbers by our team and everyone\'s excited about the partnership opportunity.</p><p>Would you have time next week to hop on a call and discuss the terms in more detail? I\'m flexible on timing but ideally before Friday so we can get the ball rolling for Q3.</p><p>Let me know what works!</p><p class="sig">Sarah Chen<br>VP Partnerships, Acme Corp</p>'
  },
  'email-2': {
    subject: 'You appeared in 12 searches this week',
    from: 'LinkedIn <notifications@linkedin.com>',
    to: 'pjtanzillo@gmail.com',
    date: 'Feb 16, 2025 at 4:00 AM',
    body: '<p>Your profile was found in 12 searches this week. See who\'s looking for you.</p><p>Top searchers work at companies in Technology and Finance.</p><p class="sig">LinkedIn Notifications</p>'
  },
  'email-3': {
    subject: 'Brand assets for the new site',
    from: 'Mike Reynolds <mike@reynoldsdesign.co>',
    to: 'pjtanzillo@gmail.com',
    date: 'Feb 15, 2025 at 3:22 PM',
    body: '<p>Hey PJ,</p><p>Final assets are attached. Here\'s what\'s included:</p><p>- Primary logo (SVG, PNG @2x)<br>- Brand guidelines PDF<br>- Color palette with hex codes<br>- Typography specimens</p><p>The one thing I\'d love your input on is the color palette. I went with the warmer direction we discussed but want to make sure the orange accent feels right before we lock it in.</p><p>No rush, but if you could take a look by end of week that\'d be great.</p><p class="sig">Mike Reynolds<br>Reynolds Design Co.</p>'
  },
  'email-4': {
    subject: "This week's dead startups",
    from: 'SaaS Graveyard <digest@saasgraveyard.com>',
    to: 'pjtanzillo@gmail.com',
    date: 'Feb 15, 2025 at 10:00 AM',
    body: '<p>This week in the graveyard: 3 more B2B SaaS companies shut their doors.</p><p>Read the full post-mortems and lessons learned from founders who shared what went wrong.</p><p class="sig">SaaS Graveyard Weekly Digest<br>Unsubscribe</p>'
  },
  'email-5': {
    subject: 'Following up: intro to the Meridian team',
    from: 'James Mitchell <james@vertexcap.com>',
    to: 'pjtanzillo@gmail.com, founders@meridian.io',
    date: 'Feb 13, 2025 at 11:45 AM',
    body: '<p>Hey PJ & Meridian team,</p><p>Just bumping this up in case it got buried. I think there\'s a really natural fit here and would love to see you two connect.</p><p>PJ - the Meridian folks are building something in the productivity space that I think overlaps nicely with what you\'re doing. Worth a 30-min chat at minimum.</p><p>Happy to hop on the first call too if that helps.</p><p class="sig">James Mitchell<br>Partner, Vertex Capital</p>'
  },
  'email-6': {
    subject: '[tessio] PR #47 merged: Fix drag-drop reorder',
    from: 'GitHub <notifications@github.com>',
    to: 'pjtanzillo@gmail.com',
    date: 'Feb 16, 2025 at 3:12 AM',
    body: '<p>PJthePony merged pull request #47 into main.</p><p><strong>Fix drag-drop reorder</strong></p><p>Fixed an issue where dragging tasks between columns would sometimes lose the task order. Updated the vuedraggable handler to preserve index on drop.</p><p>All checks passed. 2 files changed, 14 insertions, 3 deletions.</p>'
  }
}

function openEmail(emailId) {
  activeEmail.value = emails[emailId]
  emailModalOpen.value = true
}

function closeEmail() {
  emailModalOpen.value = false
}

// ── Decision Cards ──
const cards = ref([
  { id: 'card-1', emailId: 'email-1', sender: 'Sarah Chen', org: 'Acme Corp', initials: 'SC', avatarClass: 'av-orange', time: '2 hours ago', priority: 'p-high', subject: 'Re: Q3 Partnership Proposal', summary: 'Asking for your availability next week to discuss terms. Needs a response by Friday.', action: 'Reply', actionMsg: 'Reply draft created', cleared: false },
  { id: 'card-2', emailId: 'email-2', sender: 'LinkedIn', org: 'Notification', initials: 'LI', avatarClass: 'av-blue', time: '5 hours ago', priority: 'p-low', subject: 'You appeared in 12 searches this week', summary: 'Weekly search appearance digest. No action needed.', action: 'Archive', actionMsg: 'Archived', cleared: false, hasBriefing: true },
  { id: 'card-3', emailId: 'email-3', sender: 'Mike Reynolds', org: 'Reynolds Design', initials: 'MR', avatarClass: 'av-purple', time: 'Yesterday', priority: 'p-med', subject: 'Brand assets for the new site', summary: 'Sent final logo files and brand guidelines. Wants your feedback on the color palette before they finalize.', action: '+ Task', actionMsg: 'Task added to Tessio', cleared: false },
  { id: 'card-4', emailId: 'email-4', sender: 'SaaS Graveyard', org: 'Newsletter', initials: 'SG', avatarClass: 'av-red', time: 'Yesterday', priority: 'p-low', subject: "This week's dead startups", summary: "Weekly newsletter. You haven't opened the last 8 emails from this sender.", action: 'Unsubscribe', actionMsg: 'Unsubscribed & archived', cleared: false, hasBriefing: true },
  { id: 'card-5', emailId: 'email-5', sender: 'James Mitchell', org: 'Vertex Capital', initials: 'JM', avatarClass: 'av-green', time: '3 days ago', priority: 'p-high', subject: 'Following up: intro to the Meridian team', summary: "Introduced you to Meridian founders 5 days ago. Neither side responded. James is probably wondering if you saw it.", action: 'Reply', actionMsg: 'Reply draft created', cleared: false },
  { id: 'card-6', emailId: 'email-6', sender: 'GitHub', org: 'Notification', initials: 'GH', avatarClass: 'av-blue', time: '6 hours ago', priority: 'p-low', subject: '[tessio] PR #47 merged: Fix drag-drop reorder', summary: 'Your pull request was merged into main. CI passed. No action needed.', action: 'Archive', actionMsg: 'Archived', cleared: false, hasBriefing: true },
])

const remaining = computed(() => cards.value.filter(c => !c.cleared).length)
const allCleared = computed(() => remaining.value === 0)

function approveCard(cardId, message) {
  const card = cards.value.find(c => c.id === cardId)
  if (card) card.cleared = true
  showToast(message)
}

function skipCard(cardId) {
  const card = cards.value.find(c => c.id === cardId)
  if (card) card.cleared = true
  showToast('Skipped')
}

// ── Daily Digest ──
const digestItems = ref([
  { source: 'Patagonia', tag: 'Sale', tagClass: 'tag-sale', summary: 'End-of-season sale — 40% off winter gear. Nano Puff and Better Sweater included. Free shipping over $99. Ends Thursday.' },
  { source: 'Philly Inquirer', tag: 'News', tagClass: 'tag-news', summary: 'SEPTA board approved new express line between Center City and University City. Construction starts fall 2025. Also: Eagles offseason roster moves.' },
  { source: 'Huckberry', tag: 'Sale', tagClass: 'tag-sale', summary: 'New arrivals: spring jackets and camp collar shirts. Your size is in stock for the Flint and Tinder items you browsed last week.' },
  { source: 'Morning Brew', tag: 'Update', tagClass: 'tag-update', summary: 'Fed holds rates steady. Nvidia earnings beat expectations by 12%. Apple rumored to announce AI partnership next month.' },
])

// ── Date ──
const today = new Date()
const dateStr = today.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })

function handleLogout() {
  signOut()
}
</script>

<template>
  <div class="app-container">
    <AppHeader @open-settings="settingsOpen = true" @logout="handleLogout" />

    <div class="app-body">
      <div class="briefing-header">
        <div class="briefing-date">{{ dateStr }}</div>
        <h1 class="briefing-title">Morning Briefing</h1>
        <div class="briefing-stats">
          <div class="briefing-stat"><strong>{{ remaining }}</strong> to review</div>
          <div class="briefing-stat urgent"><strong>1</strong> urgent</div>
        </div>
      </div>

      <DailyDigest
        :items="digestItems"
        @manage-sources="settingsOpen = true"
      />

      <div id="card-list">
        <DecisionCard
          v-for="card in cards"
          :key="card.id"
          :card="card"
          @approve="approveCard"
          @skip="skipCard"
          @open-email="openEmail"
        />
      </div>

      <div v-if="allCleared" class="empty-state visible">
        <h2>All clear, Don.</h2>
        <p>You've handled everything. Check Gmail drafts when you're ready.</p>
      </div>
    </div>

    <EmailModal
      :open="emailModalOpen"
      :email="activeEmail"
      @close="closeEmail"
    />

    <SettingsModal
      :open="settingsOpen"
      :sources="briefingSources"
      @close="settingsOpen = false"
      @remove-source="removeBriefingSource"
    />

    <ToastNotification :message="toastMessage" :visible="toastVisible" />
  </div>
</template>

<style scoped>
.app-container {
  min-height: 100vh;
}

.app-body {
  max-width: 540px;
  margin: 0 auto;
  padding: 20px 16px 100px;
}

.briefing-header {
  margin-bottom: 20px;
}

.briefing-date {
  font-size: 0.7rem;
  font-weight: 500;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin-bottom: 4px;
}

.briefing-title {
  font-size: 1.15rem;
  font-weight: 600;
  letter-spacing: -0.02em;
  margin-bottom: 2px;
}

.briefing-stats {
  display: flex;
  gap: 16px;
  margin-top: 12px;
}

.briefing-stat {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.78rem;
  color: var(--color-text-secondary);
}

.briefing-stat strong {
  font-weight: 600;
  color: var(--color-text);
}

.briefing-stat.urgent strong {
  color: var(--color-accent);
}

.empty-state {
  text-align: center;
  padding: 60px 20px;
  animation: fadeIn 0.4s ease;
}

.empty-state h2 {
  font-size: 1.15rem;
  font-weight: 600;
  letter-spacing: -0.02em;
  margin-bottom: 6px;
}

.empty-state p {
  font-size: 0.82rem;
  color: var(--color-text-secondary);
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(3px); }
  to { opacity: 1; transform: translateY(0); }
}

@media (min-width: 641px) {
  .app-body {
    padding: 28px 20px 100px;
  }
}
</style>
