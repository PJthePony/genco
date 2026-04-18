<script setup>
import { ref, watch, computed } from 'vue'
import { useNetwork } from '../composables/useNetwork'
import { avatarColor, getInitials, daysAgo } from '../lib/formatters'

const props = defineProps({
  open: Boolean,
})

const emit = defineEmits(['close'])

const {
  contacts,
  suggestions,
  loading,
  seeding,
  seedProgress,
  seedHasMore,
  seedTotalScanned,
  fetchContacts,
  addContact,
  removeContact,
  seedContacts,
  batchAddContacts,
  addFact,
} = useNetwork()

// Tabs
const activeTab = ref('contacts') // 'contacts' | 'seed'

// Add contact form
const adding = ref(false)
const newEmail = ref('')
const newName = ref('')
const newCompany = ref('')
const addError = ref('')
const addLoading = ref(false)

// Contact search (searches both existing contacts and Gmail pool)
const contactSearch = ref('')

// Seed flow
const selectedSuggestions = ref(new Set())
const batchAdding = ref(false)
const seedSearch = ref('')

// Fact form
const addingFactFor = ref(null)
const newFact = ref('')
const newFactDate = ref('')

watch(() => props.open, (isOpen) => {
  if (isOpen) {
    fetchContacts()
    activeTab.value = 'contacts'
    adding.value = false
    addError.value = ''
  }
})

function startAdd() {
  adding.value = true
  newEmail.value = ''
  newName.value = ''
  newCompany.value = ''
  addError.value = ''
}

function cancelAdd() {
  adding.value = false
  addError.value = ''
}

async function submitAdd() {
  const email = newEmail.value.trim()
  const name = newName.value.trim()
  if (!email || !email.includes('@')) {
    addError.value = 'Enter a valid email'
    return
  }
  if (!name) {
    addError.value = 'Name is required'
    return
  }

  addLoading.value = true
  addError.value = ''

  try {
    await addContact({
      email,
      displayName: name,
      company: newCompany.value.trim() || null,
    })
    adding.value = false
  } catch (err) {
    addError.value = err.message || 'Failed to add contact'
  } finally {
    addLoading.value = false
  }
}

async function handleRemove(id) {
  try {
    await removeContact(id)
  } catch (err) {
    // handled in composable
  }
}

// Seed flow
async function handleSeed({ resume = false } = {}) {
  activeTab.value = 'seed'
  if (!resume) {
    selectedSuggestions.value = new Set()
  }
  await seedContacts({ resume })
  // Pre-select all new suggestions
  if (!resume) {
    suggestions.value.forEach((s, i) => selectedSuggestions.value.add(i))
  }
}

function toggleSuggestion(index) {
  if (selectedSuggestions.value.has(index)) {
    selectedSuggestions.value.delete(index)
  } else {
    selectedSuggestions.value.add(index)
  }
}

// Contacts tab: filter existing contacts by search
const filteredContacts = computed(() => {
  const q = contactSearch.value.toLowerCase().trim()
  if (!q) return contacts.value
  return contacts.value.filter(c =>
    c.displayName.toLowerCase().includes(q) ||
    c.email.toLowerCase().includes(q) ||
    (c.company && c.company.toLowerCase().includes(q)) ||
    (c.phoneNumber && c.phoneNumber.includes(q))
  )
})

// Contacts tab: show matching Gmail suggestions (not already added)
const contactSearchSuggestions = computed(() => {
  const q = contactSearch.value.toLowerCase().trim()
  if (!q || suggestions.value.length === 0) return []
  const existingEmails = new Set(contacts.value.map(c => c.email.toLowerCase()))
  return suggestions.value
    .filter(s =>
      !existingEmails.has(s.email.toLowerCase()) &&
      (s.displayName.toLowerCase().includes(q) || s.email.toLowerCase().includes(q))
    )
    .slice(0, 5) // limit to top 5 matches
})

// Discover tab: filter suggestions (show top 50 by default, all when searching)
const filteredSuggestions = computed(() => {
  const q = seedSearch.value.toLowerCase().trim()
  if (!q) return suggestions.value.slice(0, 50)
  return suggestions.value.filter(s =>
    s.displayName.toLowerCase().includes(q) ||
    s.email.toLowerCase().includes(q)
  )
})

async function approveSelected() {
  batchAdding.value = true
  const selected = [...selectedSuggestions.value].map(i => suggestions.value[i])
  try {
    await batchAddContacts(
      selected.map(s => ({
        email: s.email,
        displayName: s.displayName,
      })),
    )
    // Remove added contacts from suggestions so they don't show as duplicates
    const addedEmails = new Set(selected.map(s => s.email.toLowerCase()))
    suggestions.value = suggestions.value.filter(s => !addedEmails.has(s.email.toLowerCase()))
    selectedSuggestions.value = new Set()
    seedSearch.value = ''
    activeTab.value = 'contacts'
  } catch (err) {
    // handled in composable
  } finally {
    batchAdding.value = false
  }
}

// Add individual suggestion
const addingSingle = ref(null) // email of suggestion being added

async function addSingleSuggestion(s) {
  addingSingle.value = s.email
  try {
    await addContact({
      email: s.email,
      displayName: s.displayName,
    })
    // Remove from suggestions list
    const idx = suggestions.value.findIndex(x => x.email === s.email)
    if (idx !== -1) {
      suggestions.value.splice(idx, 1)
      // Update selected indices since array shifted
      const newSelected = new Set()
      selectedSuggestions.value.forEach(i => {
        if (i < idx) newSelected.add(i)
        else if (i > idx) newSelected.add(i - 1)
      })
      selectedSuggestions.value = newSelected
    }
  } catch (err) {
    // handled in composable
  } finally {
    addingSingle.value = null
  }
}

// Fact management
function startAddFact(contactId) {
  addingFactFor.value = contactId
  newFact.value = ''
  newFactDate.value = ''
}

async function submitFact() {
  if (!newFact.value.trim()) return
  try {
    await addFact(addingFactFor.value, newFact.value.trim(), newFactDate.value || null)
    addingFactFor.value = null
  } catch (err) {
    // handled in composable
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="modal-overlay" @click.self="$emit('close')">
      <div class="modal-content">
        <div class="modal-header">
          <h2>Your Network</h2>
          <button class="btn-close" @click="$emit('close')">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <!-- Tab navigation -->
        <div class="modal-tabs">
          <button
            class="tab"
            :class="{ active: activeTab === 'contacts' }"
            @click="activeTab = 'contacts'"
          >Contacts ({{ contacts.length }})</button>
          <button
            class="tab"
            :class="{ active: activeTab === 'seed' }"
            @click="activeTab = 'seed'"
          >Discover</button>
        </div>

        <!-- Contacts tab -->
        <div v-if="activeTab === 'contacts'" class="modal-body">
          <!-- Search bar -->
          <div class="contacts-search-bar">
            <div class="contacts-search-wrap">
              <svg class="contacts-search-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              <input
                v-model="contactSearch"
                type="text"
                :placeholder="suggestions.length ? 'Search contacts or Gmail history...' : 'Search contacts...'"
                class="contacts-search-input"
              />
            </div>
            <button class="btn-add-icon" @click="startAdd" v-if="!adding" title="Add manually">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            </button>
          </div>

          <!-- Gmail suggestion matches from search -->
          <div v-if="contactSearchSuggestions.length > 0" class="search-suggestions">
            <div class="search-suggestions-label">From Gmail</div>
            <div v-for="s in contactSearchSuggestions" :key="s.email" class="suggestion-inline">
              <div class="avatar avatar-sm" :class="avatarColor(s.email)">
                {{ getInitials(s.displayName, s.email) }}
              </div>
              <div class="suggestion-inline-info">
                <span class="suggestion-inline-name">{{ s.displayName }}</span>
                <span class="suggestion-inline-email">{{ s.email }}</span>
              </div>
              <span class="suggestion-inline-count">{{ s.messageCount }} sent</span>
              <button class="btn-add-single" @click="addSingleSuggestion(s)" :disabled="addingSingle === s.email">
                {{ addingSingle === s.email ? '...' : 'Add' }}
              </button>
            </div>
          </div>

          <!-- Prompt to scan Gmail if no suggestions loaded yet -->
          <div v-if="contactSearch && contactSearchSuggestions.length === 0 && suggestions.length === 0 && filteredContacts.length === 0" class="search-scan-hint">
            <span>Can't find them?</span>
            <button class="btn-scan-hint" @click="handleSeed" :disabled="seeding">
              {{ seeding ? 'Scanning...' : 'Scan Gmail to discover contacts' }}
            </button>
          </div>

          <!-- Add form -->
          <div v-if="adding" class="add-form">
            <input v-model="newName" type="text" placeholder="Name" class="input" />
            <input v-model="newEmail" type="email" placeholder="Email address" class="input" />
            <input v-model="newCompany" type="text" placeholder="Company (optional)" class="input" />
            <div v-if="addError" class="form-error">{{ addError }}</div>
            <div class="add-form-actions">
              <button class="btn-submit" @click="submitAdd" :disabled="addLoading">
                {{ addLoading ? 'Adding...' : 'Add' }}
              </button>
              <button class="btn-cancel" @click="cancelAdd">Cancel</button>
            </div>
          </div>

          <!-- Contact list -->
          <div v-if="contacts.length === 0 && !loading && !contactSearch" class="empty-contacts">
            <p>No contacts yet. Add people you want to stay in touch with.</p>
          </div>

          <div v-if="contactSearch && filteredContacts.length === 0 && contactSearchSuggestions.length === 0 && suggestions.length > 0" class="empty-contacts">
            <p>No matches for "{{ contactSearch }}"</p>
          </div>

          <div v-for="contact in filteredContacts" :key="contact.id" class="contact-row">
            <div class="avatar" :class="avatarColor(contact.email)">
              {{ getInitials(contact.displayName, contact.email) }}
            </div>
            <div class="contact-info">
              <div class="contact-name">
                {{ contact.displayName }}
                <span v-if="contact.company" class="contact-company">{{ contact.company }}</span>
              </div>
              <div class="contact-email">
                {{ contact.email }}
                <span v-if="contact.phoneNumber" class="contact-phone">&middot; {{ contact.phoneNumber }}</span>
              </div>
              <div v-if="contact.lastContactAt" class="contact-last">
                Last contact: {{ daysAgo(contact.lastContactAt) }}d ago
                <span v-if="contact.threadStatus" class="thread-status">&middot; {{ contact.threadStatus.replace(/_/g, ' ') }}</span>
              </div>
            </div>
            <div class="contact-actions">
              <button class="btn-fact" @click="startAddFact(contact.id)" title="Add fact">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              </button>
              <button class="btn-remove" @click="handleRemove(contact.id)" title="Remove">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>

            <!-- Inline fact form -->
            <div v-if="addingFactFor === contact.id" class="fact-form">
              <input v-model="newFact" type="text" placeholder="e.g. Birthday March 12, daughter starting college" class="input input-sm" />
              <input v-model="newFactDate" type="date" class="input input-sm input-date" />
              <div class="fact-form-actions">
                <button class="btn-submit btn-sm" @click="submitFact">Save</button>
                <button class="btn-cancel btn-sm" @click="addingFactFor = null">Cancel</button>
              </div>
            </div>
          </div>
        </div>

        <!-- Seed/Discover tab -->
        <div v-if="activeTab === 'seed'" class="modal-body">
          <div v-if="!seeding && suggestions.length === 0" class="seed-start">
            <p class="seed-start-text">Scan your sent mail to find the people you email most.</p>
            <button class="btn-seed" @click="handleSeed" :disabled="seeding">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              Seed from Gmail
            </button>
          </div>

          <div v-else-if="seeding" class="seed-loading">
            <div class="seed-progress-info">
              <span class="seed-spinner"></span>
              <span>{{ seedProgress.phase || 'Starting...' }}</span>
            </div>
            <div class="seed-progress-bar">
              <div
                class="seed-progress-fill"
                :style="{ width: `${Math.min(100, (seedProgress.fetched / seedProgress.limit) * 100)}%` }"
              ></div>
            </div>
            <div class="seed-progress-stats">
              <span>{{ seedProgress.fetched?.toLocaleString() }} / {{ seedProgress.limit?.toLocaleString() }} emails</span>
              <span v-if="seedProgress.contacts">{{ seedProgress.contacts }} contacts found</span>
            </div>
          </div>

          <div v-else>
            <div class="seed-toolbar">
              <div class="seed-search-wrap">
                <svg class="seed-search-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                <input
                  v-model="seedSearch"
                  type="text"
                  placeholder="Search results..."
                  class="seed-search-input"
                />
              </div>
              <button class="btn-submit" @click="approveSelected" :disabled="batchAdding || selectedSuggestions.size === 0">
                {{ batchAdding ? 'Adding...' : `Add ${selectedSuggestions.size} selected` }}
              </button>
            </div>
            <p class="seed-description">
              {{ seedSearch ? `${filteredSuggestions.length} matches` : `Showing top ${Math.min(50, suggestions.length)} of ${suggestions.length} contacts` }}
              <template v-if="!seedSearch"> &mdash; search for anyone</template>
            </p>

            <div v-for="s in filteredSuggestions" :key="s.email" class="suggestion-row">
              <input type="checkbox" :checked="selectedSuggestions.has(suggestions.indexOf(s))" class="suggestion-check" @click.stop="toggleSuggestion(suggestions.indexOf(s))" />
              <div class="avatar avatar-sm" :class="avatarColor(s.email)" @click="toggleSuggestion(suggestions.indexOf(s))">
                {{ getInitials(s.displayName, s.email) }}
              </div>
              <div class="suggestion-info" @click="toggleSuggestion(suggestions.indexOf(s))">
                <div class="suggestion-name">{{ s.displayName }}</div>
                <div class="suggestion-email">{{ s.email }}</div>
                <div v-if="s.senderSummary" class="suggestion-summary">{{ s.senderSummary }}</div>
              </div>
              <span class="suggestion-count">{{ s.messageCount }}</span>
              <button class="btn-add-single" @click.stop="addSingleSuggestion(s)" :disabled="addingSingle === s.email">
                {{ addingSingle === s.email ? '...' : 'Add' }}
              </button>
            </div>

            <div v-if="filteredSuggestions.length === 0 && seedSearch" class="empty-contacts">
              <p>No matches for "{{ seedSearch }}"</p>
            </div>

            <div class="seed-rescan">
              <button class="btn-seed" @click="handleSeed({ resume: true })" :disabled="seeding">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                {{ seedHasMore ? 'Scan more emails' : 'Rescan Gmail' }}
              </button>
              <span v-if="seedTotalScanned > 0" class="seed-scanned-count">{{ seedTotalScanned.toLocaleString() }} emails scanned</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(20, 34, 53, 0.4);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 20px;
}

.modal-content {
  background: var(--color-surface);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  width: 100%;
  max-width: 520px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 20px;
  border-bottom: 1px solid var(--color-border);
}

.modal-header h2 {
  font-size: 0.92rem;
  font-weight: 600;
  letter-spacing: -0.02em;
}

.btn-close {
  background: none;
  border: none;
  color: var(--color-text-muted);
  cursor: pointer;
  padding: 4px;
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.btn-close:hover { color: var(--color-text); }

.modal-tabs {
  display: flex;
  border-bottom: 1px solid var(--color-border);
  padding: 0 20px;
}

.tab {
  padding: 10px 16px;
  font-size: 0.75rem;
  font-weight: 500;
  font-family: inherit;
  border: none;
  background: none;
  color: var(--color-text-muted);
  cursor: pointer;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  transition: all var(--transition-fast);
}

.tab.active {
  color: var(--color-text);
  border-bottom-color: var(--color-accent);
}

.tab:hover:not(.active) { color: var(--color-text-secondary); }

.modal-body {
  padding: 16px 20px;
  overflow-y: auto;
  flex: 1;
}

.contacts-search-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 14px;
}

.contacts-search-wrap {
  flex: 1;
  position: relative;
}

.contacts-search-icon {
  position: absolute;
  left: 10px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--color-text-muted);
  pointer-events: none;
}

.contacts-search-input {
  width: 100%;
  padding: 8px 12px 8px 30px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  font-size: 0.75rem;
  font-family: inherit;
  color: var(--color-text);
  background: var(--color-surface);
}

.contacts-search-input:focus { outline: none; border-color: var(--color-accent-border); }

.btn-add-icon {
  width: 34px;
  height: 34px;
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  color: var(--color-text-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: all var(--transition-fast);
}

.btn-add-icon:hover { color: var(--color-accent); border-color: var(--color-accent-border); }

.search-suggestions {
  margin-bottom: 12px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--color-border);
}

.search-suggestions-label {
  font-size: 0.6rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--color-text-muted);
  margin-bottom: 6px;
}

.suggestion-inline {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 0;
}

.suggestion-inline-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.suggestion-inline-name {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--color-text);
}

.suggestion-inline-email {
  font-size: 0.65rem;
  color: var(--color-text-muted);
}

.suggestion-inline-count {
  font-size: 0.6rem;
  color: var(--color-text-muted);
  white-space: nowrap;
  flex-shrink: 0;
}

.search-scan-hint {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 0;
  font-size: 0.72rem;
  color: var(--color-text-muted);
}

.btn-scan-hint {
  font-size: 0.72rem;
  font-weight: 500;
  font-family: inherit;
  color: var(--color-accent);
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.btn-scan-hint:hover { color: var(--color-text); }
.btn-scan-hint:disabled { opacity: 0.6; cursor: default; }

.btn-add, .btn-seed {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 7px 14px;
  border-radius: var(--radius-md);
  font-size: 0.72rem;
  font-weight: 500;
  font-family: inherit;
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.btn-add:hover, .btn-seed:hover { border-color: var(--color-text-muted); color: var(--color-text); }
.btn-seed:disabled { opacity: 0.6; cursor: default; }

.add-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 16px;
  padding: 12px;
  background: var(--color-bg);
  border-radius: var(--radius-md);
}

.input {
  padding: 8px 12px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  font-size: 0.78rem;
  font-family: inherit;
  color: var(--color-text);
  background: var(--color-surface);
}

.input:focus { outline: none; border-color: var(--color-accent-border); }

.input-sm { padding: 6px 10px; font-size: 0.72rem; }
.input-date { max-width: 160px; }

.form-error {
  font-size: 0.7rem;
  color: var(--color-danger);
}

.add-form-actions {
  display: flex;
  gap: 8px;
}

.btn-submit {
  padding: 7px 16px;
  border-radius: var(--radius-md);
  font-size: 0.72rem;
  font-weight: 600;
  font-family: inherit;
  border: none;
  background: var(--color-primary);
  color: #fff;
  cursor: pointer;
}

.btn-submit:hover:not(:disabled) { background: var(--color-primary-hover); }
.btn-submit:disabled { opacity: 0.6; cursor: default; }

.btn-cancel {
  padding: 7px 16px;
  border-radius: var(--radius-md);
  font-size: 0.72rem;
  font-weight: 500;
  font-family: inherit;
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  color: var(--color-text-muted);
  cursor: pointer;
}

.btn-sm { padding: 5px 12px; font-size: 0.68rem; }

.empty-contacts {
  text-align: center;
  padding: 30px 10px;
  color: var(--color-text-muted);
  font-size: 0.78rem;
}

.contact-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 0;
  border-bottom: 1px solid var(--color-border);
  flex-wrap: wrap;
}

.contact-row:last-child { border-bottom: none; }

.avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.62rem;
  font-weight: 600;
  flex-shrink: 0;
  color: #fff;
}

.avatar.av-orange { background: var(--color-accent); }
.avatar.av-blue { background: var(--color-blue); }
.avatar.av-purple { background: var(--color-purple); }
.avatar.av-green { background: var(--color-success); }
.avatar.av-red { background: var(--color-danger); }

.avatar-sm { width: 28px; height: 28px; font-size: 0.58rem; }

.contact-info { flex: 1; min-width: 0; }

.contact-name {
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--color-text);
}

.contact-company {
  font-weight: 400;
  color: var(--color-text-muted);
  margin-left: 4px;
}

.contact-email {
  font-size: 0.68rem;
  color: var(--color-text-muted);
}

.contact-phone {
  color: var(--color-success);
}

.contact-last {
  font-size: 0.65rem;
  color: var(--color-text-muted);
  margin-top: 2px;
}

.thread-status {
  color: var(--color-text-muted);
}

.contact-actions {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}

.btn-fact, .btn-remove {
  width: 44px;
  height: 44px;
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  color: var(--color-text-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all var(--transition-fast);
}

.btn-fact:hover { color: var(--color-success); border-color: var(--color-success); }
.btn-remove:hover { color: var(--color-danger); border-color: var(--color-danger); }

.fact-form {
  width: 100%;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 6px;
  padding: 8px 0 0 42px;
}

.fact-form .input { flex: 1; min-width: 120px; }
.fact-form-actions { display: flex; gap: 6px; width: 100%; }

/* Seed tab */
.seed-start {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  padding: 30px 10px;
}

.seed-start-text {
  font-size: 0.78rem;
  color: var(--color-text-muted);
  text-align: center;
}

.seed-loading {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 30px 10px;
  color: var(--color-text-muted);
  font-size: 0.78rem;
}

.seed-progress-info {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
}

.seed-progress-bar {
  width: 100%;
  height: 6px;
  background: var(--color-bg);
  border-radius: 3px;
  overflow: hidden;
}

.seed-progress-fill {
  height: 100%;
  background: var(--color-accent);
  border-radius: 3px;
  transition: width 0.3s ease;
}

.seed-progress-stats {
  display: flex;
  justify-content: space-between;
  font-size: 0.68rem;
  color: var(--color-text-muted);
}

.seed-spinner {
  width: 16px;
  height: 16px;
  border: 2px solid var(--color-border);
  border-top-color: var(--color-accent);
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}

@keyframes spin { to { transform: rotate(360deg); } }

.seed-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}

.seed-search-wrap {
  flex: 1;
  position: relative;
}

.seed-search-icon {
  position: absolute;
  left: 10px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--color-text-muted);
  pointer-events: none;
}

.seed-search-input {
  width: 100%;
  padding: 8px 12px 8px 30px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  font-size: 0.75rem;
  font-family: inherit;
  color: var(--color-text);
  background: var(--color-surface);
}

.seed-search-input:focus { outline: none; border-color: var(--color-accent-border); }

.seed-description {
  font-size: 0.68rem;
  color: var(--color-text-muted);
  margin-bottom: 8px;
}

.seed-rescan {
  display: flex;
  justify-content: center;
  padding: 14px 0 4px;
  border-top: 1px solid var(--color-border);
  margin-top: 8px;
}

.suggestion-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
  border-bottom: 1px solid var(--color-border);
  cursor: pointer;
  transition: background var(--transition-fast);
}

.suggestion-row:hover { background: var(--color-bg); margin: 0 -8px; padding: 8px 8px; border-radius: var(--radius-md); }

.suggestion-check {
  flex-shrink: 0;
  accent-color: var(--color-accent);
}

.suggestion-info { flex: 1; min-width: 0; }

.suggestion-name {
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--color-text);
}

.suggestion-email {
  font-size: 0.68rem;
  color: var(--color-text-muted);
}

.suggestion-summary {
  font-size: 0.68rem;
  color: var(--color-text-secondary);
  margin-top: 2px;
  line-height: 1.35;
}

.suggestion-count {
  font-size: 0.62rem;
  color: var(--color-text-muted);
  white-space: nowrap;
  flex-shrink: 0;
}

.btn-add-single {
  padding: 4px 10px;
  border-radius: var(--radius-md);
  font-size: 0.65rem;
  font-weight: 600;
  font-family: inherit;
  border: 1px solid var(--color-accent-border);
  background: var(--color-accent-soft);
  color: var(--color-accent);
  cursor: pointer;
  flex-shrink: 0;
  transition: all var(--transition-fast);
}

.btn-add-single:hover:not(:disabled) { background: var(--color-accent); color: #fff; }
.btn-add-single:disabled { opacity: 0.5; cursor: default; }

.seed-scanned-count {
  font-size: 0.62rem;
  color: var(--color-text-muted);
  margin-top: 4px;
}

.seed-rescan {
  flex-direction: column;
  align-items: center;
}

@media (max-width: 640px) {
  .modal-overlay {
    padding: 10px;
  }

  .modal-content {
    max-height: 90vh;
  }

  .modal-body {
    padding: 14px 16px;
  }

  .btn-add-single {
    min-height: 44px;
    padding: 6px 12px;
  }

  .btn-submit {
    min-height: 44px;
  }

  .btn-cancel {
    min-height: 44px;
  }

  .btn-seed {
    min-height: 44px;
  }

  .btn-add-icon {
    width: 44px;
    height: 44px;
  }

  .tab {
    min-height: 44px;
  }

  .contact-email {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .suggestion-email {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .suggestion-inline-email {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .seed-toolbar {
    flex-wrap: wrap;
  }

  .fact-form {
    padding-left: 0;
  }
}
</style>
