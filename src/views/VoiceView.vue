<script setup>
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import AppHeader from '../components/AppHeader.vue'
import { useVoice } from '../composables/useVoice'
import { useAuth } from '../composables/useAuth'

const router = useRouter()
const { signOut } = useAuth()
const {
  profiles,
  analyzedAt,
  sampleCount,
  loading,
  analyzing,
  fetchProfiles,
  runAnalysis,
  resetSamples,
  updateProfile,
  deleteProfile,
  previewDrafts,
} = useVoice()

const error = ref('')
const lastRun = ref(null)  // { added, totalSamples, buckets }
const expandedId = ref(null)
const editing = ref({})  // id → patch
const previewOpenFor = ref(null)
const previewState = ref({})  // id → { recipientName, recipientEmail, scenario, withVoice, withoutVoice, loading, error }

onMounted(fetchProfiles)

async function handleAnalyze() {
  error.value = ''
  try {
    const res = await runAnalysis(50)
    lastRun.value = {
      added: res?.added ?? 0,
      totalSamples: res?.totalSamples ?? sampleCount.value,
      buckets: res?.buckets ?? profiles.value.length,
      message: res?.message || null,
    }
  } catch (err) {
    error.value = err?.message || 'Analysis failed'
  }
}

async function handleReset() {
  if (!confirm('Clear the sample corpus and all voice buckets? You\'ll start from scratch.')) return
  try {
    await resetSamples()
    lastRun.value = null
  } catch (err) {
    error.value = err?.message || 'Reset failed'
  }
}

function startEdit(profile) {
  editing.value[profile.id] = {
    label: profile.label,
    description: profile.description,
    formalityScore: Number(profile.formalityScore || 50),
    greetingHabits: profile.greetingHabits || '',
    signOffHabits: profile.signOffHabits || '',
    sentenceStyle: profile.sentenceStyle || '',
    samplePhrases: [...(profile.samplePhrases || [])],
  }
}

function cancelEdit(id) {
  delete editing.value[id]
}

async function saveEdit(id) {
  const patch = editing.value[id]
  if (!patch) return
  try {
    await updateProfile(id, patch)
    delete editing.value[id]
  } catch (err) {
    error.value = err?.message || 'Save failed'
  }
}

function addPhrase(id) {
  if (!editing.value[id]) return
  editing.value[id].samplePhrases.push('')
}

function removePhrase(id, idx) {
  editing.value[id].samplePhrases.splice(idx, 1)
}

async function handleDelete(id) {
  if (!confirm('Delete this voice bucket? Drafts to matching contacts will fall back to a different bucket.')) return
  try {
    await deleteProfile(id)
  } catch (err) {
    error.value = err?.message || 'Delete failed'
  }
}

function openPreview(profile) {
  previewOpenFor.value = profile.id
  if (!previewState.value[profile.id]) {
    const sampleRecipient = (profile.sampleRecipients || [])[0] || { name: '', email: '' }
    previewState.value[profile.id] = {
      recipientName: sampleRecipient.name || '',
      recipientEmail: sampleRecipient.email || '',
      scenario: 'Following up to see if they had a chance to look at the proposal we discussed last week.',
      withVoice: '',
      withoutVoice: '',
      loading: false,
      error: '',
    }
  }
}

function closePreview() {
  previewOpenFor.value = null
}

async function runPreview(profile) {
  const state = previewState.value[profile.id]
  if (!state) return
  if (!state.recipientName.trim() || !state.scenario.trim()) {
    state.error = 'Recipient name and scenario are required.'
    return
  }
  state.loading = true
  state.error = ''
  try {
    const data = await previewDrafts({
      bucketId: profile.id,
      recipientName: state.recipientName.trim(),
      recipientEmail: state.recipientEmail.trim() || 'preview@example.com',
      scenario: state.scenario.trim(),
    })
    state.withVoice = data.withVoice
    state.withoutVoice = data.withoutVoice
  } catch (err) {
    state.error = err?.message || 'Preview failed'
  } finally {
    state.loading = false
  }
}

function formatDate(d) {
  if (!d) return ''
  return new Date(d).toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })
}

async function handleLogout() {
  await signOut()
  router.push('/')
}
</script>

<template>
  <div class="voice-view">
    <AppHeader @open-settings="router.push('/dashboard')" @logout="handleLogout" />

    <main class="voice-main">
      <header class="page-header">
        <div>
          <h1>Voice profiles</h1>
          <p class="page-sub">
            Inferred from your sent emails. Drafts to a contact match the closest bucket — or use prior emails to that contact directly when available.
          </p>
        </div>
        <div class="page-actions">
          <button class="btn-primary" :disabled="analyzing" @click="handleAnalyze">
            {{ analyzing ? 'Analyzing 50…' : (sampleCount > 0 ? 'Analyze 50 more' : 'Analyze 50 emails') }}
          </button>
          <button v-if="sampleCount > 0" class="btn-link-danger" :disabled="analyzing" @click="handleReset">
            Reset corpus
          </button>
        </div>
      </header>

      <p class="meta-line">
        <template v-if="sampleCount > 0">
          Corpus: <strong>{{ sampleCount }} sent emails</strong> analyzed.
        </template>
        <template v-if="analyzedAt">
          · Last run: {{ formatDate(analyzedAt) }}
        </template>
      </p>
      <p v-if="lastRun" class="run-line">
        <template v-if="lastRun.added > 0">
          Added {{ lastRun.added }} new sample{{ lastRun.added === 1 ? '' : 's' }}.
        </template>
        <template v-else>
          No new samples found — you're up to date with your sent folder.
        </template>
        <template v-if="lastRun.message"> {{ lastRun.message }}</template>
      </p>
      <p v-if="error" class="error-line">{{ error }}</p>

      <div v-if="loading" class="loading">Loading…</div>

      <div v-else-if="profiles.length === 0" class="empty">
        <p>No voice profiles yet. Click <strong>Analyze 50 emails</strong> to pull a first batch from your sent folder. You can keep adding 50 at a time until the clustering captures your distinct voices.</p>
      </div>

      <div v-else class="bucket-list">
        <article v-for="p in profiles" :key="p.id" class="bucket" :class="{ expanded: expandedId === p.id }">
          <header class="bucket-header" @click="expandedId = expandedId === p.id ? null : p.id">
            <div class="bucket-header-main">
              <h2>{{ p.label }}</h2>
              <p class="bucket-desc">{{ p.description }}</p>
            </div>
            <div class="bucket-header-meta">
              <span class="formality" :title="`Formality ${p.formalityScore}/100`">
                {{ p.formalityScore }}/100
              </span>
              <svg class="chev" :class="{ flip: expandedId === p.id }" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
            </div>
          </header>

          <div v-if="expandedId === p.id" class="bucket-body">
            <!-- Edit mode -->
            <div v-if="editing[p.id]" class="edit-form">
              <label>
                <span>Label</span>
                <input v-model="editing[p.id].label" />
              </label>
              <label>
                <span>Description</span>
                <textarea v-model="editing[p.id].description" rows="2"></textarea>
              </label>
              <label>
                <span>Formality (0-100)</span>
                <input type="number" min="0" max="100" v-model.number="editing[p.id].formalityScore" />
              </label>
              <label>
                <span>Greeting habits</span>
                <input v-model="editing[p.id].greetingHabits" />
              </label>
              <label>
                <span>Sign-off habits</span>
                <input v-model="editing[p.id].signOffHabits" />
              </label>
              <label>
                <span>Sentence style</span>
                <input v-model="editing[p.id].sentenceStyle" />
              </label>
              <div class="phrases-block">
                <span class="phrases-label">Sample phrases</span>
                <div v-for="(phrase, idx) in editing[p.id].samplePhrases" :key="idx" class="phrase-row">
                  <input v-model="editing[p.id].samplePhrases[idx]" />
                  <button class="btn-link-danger" @click="removePhrase(p.id, idx)">×</button>
                </div>
                <button class="btn-link" @click="addPhrase(p.id)">+ Add phrase</button>
              </div>
              <div class="edit-actions">
                <button class="btn-primary" @click="saveEdit(p.id)">Save</button>
                <button class="btn-link" @click="cancelEdit(p.id)">Cancel</button>
              </div>
            </div>

            <!-- Read mode -->
            <div v-else class="read-view">
              <dl class="bucket-detail">
                <template v-if="p.greetingHabits"><dt>Greeting</dt><dd>{{ p.greetingHabits }}</dd></template>
                <template v-if="p.signOffHabits"><dt>Sign-off</dt><dd>{{ p.signOffHabits }}</dd></template>
                <template v-if="p.sentenceStyle"><dt>Sentences</dt><dd>{{ p.sentenceStyle }}</dd></template>
              </dl>

              <div v-if="(p.samplePhrases || []).length" class="phrases">
                <span class="phrases-label">Sample phrases</span>
                <ul>
                  <li v-for="(phrase, idx) in p.samplePhrases" :key="idx">"{{ phrase }}"</li>
                </ul>
              </div>

              <div v-if="(p.sampleRecipients || []).length" class="recipients">
                <span class="phrases-label">Sample recipients</span>
                <ul>
                  <li v-for="(r, idx) in p.sampleRecipients" :key="idx">
                    {{ r.name || r.email }} <span class="recipient-email">&lt;{{ r.email }}&gt;</span>
                  </li>
                </ul>
              </div>

              <div v-if="p.matchSignals && (p.matchSignals.notes || (p.matchSignals.domainHints || []).length || (p.matchSignals.relationshipHints || []).length)" class="signals">
                <span class="phrases-label">Match signals</span>
                <p v-if="p.matchSignals.notes">{{ p.matchSignals.notes }}</p>
                <p v-if="(p.matchSignals.domainHints || []).length">
                  Domains: <span class="signal-pills">
                    <span v-for="d in p.matchSignals.domainHints" :key="d" class="pill">{{ d }}</span>
                  </span>
                </p>
                <p v-if="(p.matchSignals.relationshipHints || []).length">
                  Relationship: <span class="signal-pills">
                    <span v-for="r in p.matchSignals.relationshipHints" :key="r" class="pill">{{ r }}</span>
                  </span>
                </p>
              </div>

              <div class="bucket-actions">
                <button class="btn-link" @click="startEdit(p)">Edit</button>
                <button class="btn-link" @click="openPreview(p)">{{ previewOpenFor === p.id ? 'Close preview' : 'Preview side-by-side' }}</button>
                <button class="btn-link-danger" @click="handleDelete(p.id)">Delete</button>
              </div>
            </div>

            <!-- Preview panel -->
            <section v-if="previewOpenFor === p.id && previewState[p.id]" class="preview-panel">
              <h3>Side-by-side preview</h3>
              <p class="preview-help">
                Compare what a draft looks like with this voice vs. the generic baseline. Tweak the recipient and scenario to test edge cases.
              </p>
              <div class="preview-form">
                <label>
                  <span>Recipient name</span>
                  <input v-model="previewState[p.id].recipientName" />
                </label>
                <label>
                  <span>Recipient email (optional)</span>
                  <input v-model="previewState[p.id].recipientEmail" />
                </label>
                <label class="full">
                  <span>Scenario / what the email is about</span>
                  <textarea v-model="previewState[p.id].scenario" rows="2"></textarea>
                </label>
                <button class="btn-primary" :disabled="previewState[p.id].loading" @click="runPreview(p)">
                  {{ previewState[p.id].loading ? 'Drafting…' : 'Generate both' }}
                </button>
              </div>

              <p v-if="previewState[p.id].error" class="error-line">{{ previewState[p.id].error }}</p>

              <div v-if="previewState[p.id].withVoice || previewState[p.id].withoutVoice" class="preview-grid">
                <div class="preview-col">
                  <h4>With voice <span class="dim">— {{ p.label }}</span></h4>
                  <pre class="preview-body">{{ previewState[p.id].withVoice }}</pre>
                </div>
                <div class="preview-col">
                  <h4>Generic baseline <span class="dim">— no voice</span></h4>
                  <pre class="preview-body">{{ previewState[p.id].withoutVoice }}</pre>
                </div>
              </div>
            </section>
          </div>
        </article>
      </div>
    </main>
  </div>
</template>

<style scoped>
.voice-view { min-height: 100vh; background: var(--color-bg); }

.voice-main {
  max-width: 920px;
  margin: 0 auto;
  padding: 32px 24px 80px;
}

.page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
  margin-bottom: 8px;
}

.page-header h1 {
  font-family: var(--font-serif);
  font-size: 1.6rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--text);
  margin: 0 0 6px;
  font-variation-settings: 'opsz' 36, 'WONK' 1;
}

.page-sub {
  font-size: 0.85rem;
  color: var(--text-muted);
  margin: 0;
  max-width: 560px;
  line-height: 1.5;
}

.meta-line {
  font-size: 0.75rem;
  color: var(--text-muted);
  margin: 8px 0 4px;
}

.meta-line strong { color: var(--text); font-weight: 600; }

.run-line {
  font-size: 0.72rem;
  color: var(--color-accent);
  margin: 0 0 20px;
}

.page-actions {
  display: flex;
  align-items: center;
  gap: 16px;
}

.error-line {
  color: var(--color-danger, #a83a4a);
  font-size: 0.8rem;
  margin: 8px 0;
}

.empty, .loading {
  padding: 40px 0;
  text-align: center;
  color: var(--text-muted);
  font-size: 0.85rem;
}

.bucket-list { display: flex; flex-direction: column; gap: 12px; }

.bucket {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  overflow: hidden;
  transition: border-color var(--transition-fast);
}

.bucket:hover { border-color: var(--color-text-muted); }

.bucket-header {
  padding: 16px 20px;
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  cursor: pointer;
}

.bucket-header-main h2 {
  font-family: var(--font-serif);
  font-size: 1.05rem;
  font-weight: 600;
  margin: 0 0 4px;
  color: var(--text);
}

.bucket-desc {
  font-size: 0.78rem;
  color: var(--text-muted);
  margin: 0;
  line-height: 1.45;
}

.bucket-header-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
}

.formality {
  font-size: 0.7rem;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

.chev {
  color: var(--text-muted);
  transition: transform var(--transition-fast);
}

.chev.flip { transform: rotate(180deg); }

.bucket-body {
  padding: 0 20px 20px;
  border-top: 1px solid var(--color-border);
}

.bucket-detail {
  display: grid;
  grid-template-columns: 110px 1fr;
  gap: 6px 16px;
  margin: 16px 0 0;
  font-size: 0.78rem;
}

.bucket-detail dt { color: var(--text-muted); font-weight: 500; }
.bucket-detail dd { margin: 0; color: var(--text); }

.phrases, .recipients, .signals { margin-top: 16px; font-size: 0.78rem; }

.phrases-label {
  display: block;
  font-size: 0.68rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-muted);
  margin-bottom: 6px;
}

.phrases ul, .recipients ul {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.phrases li {
  color: var(--text);
  font-style: italic;
}

.recipient-email { color: var(--text-muted); font-size: 0.7rem; }

.signal-pills { display: inline-flex; gap: 4px; flex-wrap: wrap; }

.pill {
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  padding: 1px 8px;
  border-radius: var(--radius-pill);
  font-size: 0.7rem;
  color: var(--text-secondary);
}

.bucket-actions {
  display: flex;
  gap: 16px;
  margin-top: 18px;
  padding-top: 14px;
  border-top: 1px dashed var(--color-border);
}

.btn-primary {
  padding: 8px 18px;
  border-radius: var(--radius-md);
  font-size: 0.78rem;
  font-weight: 600;
  font-family: inherit;
  background: var(--color-primary, var(--accent));
  color: #fff;
  border: none;
  cursor: pointer;
}

.btn-primary:disabled { opacity: 0.5; cursor: default; }

.btn-link {
  background: none;
  border: none;
  font-family: inherit;
  font-size: 0.78rem;
  color: var(--accent);
  cursor: pointer;
  padding: 0;
}

.btn-link:hover { text-decoration: underline; }

.btn-link-danger {
  background: none;
  border: none;
  font-family: inherit;
  font-size: 0.78rem;
  color: var(--color-danger, #a83a4a);
  cursor: pointer;
  padding: 0;
}

.btn-link-danger:hover { text-decoration: underline; }

.edit-form {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 16px;
}

.edit-form label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 0.72rem;
  color: var(--text-muted);
}

.edit-form input, .edit-form textarea {
  padding: 8px 10px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  font-family: inherit;
  font-size: 0.8rem;
  color: var(--text);
  background: var(--color-bg);
}

.edit-form input:focus, .edit-form textarea:focus {
  outline: none;
  border-color: var(--accent);
}

.phrases-block { display: flex; flex-direction: column; gap: 6px; }

.phrase-row {
  display: flex;
  gap: 6px;
  align-items: center;
}

.phrase-row input {
  flex: 1;
  padding: 6px 10px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  font-family: inherit;
  font-size: 0.78rem;
  background: var(--color-bg);
  color: var(--text);
}

.edit-actions { display: flex; gap: 12px; align-items: center; margin-top: 8px; }

.preview-panel {
  margin-top: 24px;
  padding: 16px;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.preview-panel h3 {
  font-family: var(--font-serif);
  font-size: 1rem;
  font-weight: 600;
  margin: 0 0 4px;
}

.preview-help {
  font-size: 0.75rem;
  color: var(--text-muted);
  margin: 0 0 12px;
  line-height: 1.4;
}

.preview-form {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-bottom: 12px;
}

.preview-form label.full { grid-column: 1 / -1; }

.preview-form label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 0.72rem;
  color: var(--text-muted);
}

.preview-form input, .preview-form textarea {
  padding: 8px 10px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  font-family: inherit;
  font-size: 0.78rem;
  background: var(--color-surface);
  color: var(--text);
}

.preview-form button { grid-column: 1 / -1; justify-self: start; }

.preview-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.preview-col {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: 12px;
}

.preview-col h4 {
  font-size: 0.72rem;
  font-weight: 600;
  margin: 0 0 8px;
  color: var(--text);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.dim { color: var(--text-muted); font-weight: 400; text-transform: none; }

.preview-body {
  font-family: inherit;
  font-size: 0.8rem;
  white-space: pre-wrap;
  margin: 0;
  color: var(--text);
  line-height: 1.5;
}

@media (max-width: 768px) {
  .voice-main { padding: 24px 14px 60px; }
  .page-header { flex-direction: column; align-items: stretch; }
  .preview-form { grid-template-columns: 1fr; }
  .preview-grid { grid-template-columns: 1fr; }
}
</style>
