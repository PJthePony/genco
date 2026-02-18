import { ref, computed } from 'vue'
import { api } from './useApi'
import { avatarColor, getInitials, daysAgo } from '../lib/formatters'

// Module-scope state (singleton)
const contacts = ref([])
const followUps = ref([])
const suggestions = ref([])
const loading = ref(false)
const seeding = ref(false)

const REASON_LABELS = {
  ball_in_your_court: 'Ball in your court',
  went_cold: 'Went cold',
  date_coming_up: 'Coming up',
}

const REASON_ICONS = {
  ball_in_your_court: 'reply',
  went_cold: 'clock',
  date_coming_up: 'calendar',
}

function toFollowUpCard(item) {
  const contact = item.contact || {}
  return {
    id: item.id,
    contactId: contact.id,
    contactName: contact.displayName || contact.email?.split('@')[0] || 'Unknown',
    contactEmail: contact.email || '',
    company: contact.company || '',
    initials: getInitials(contact.displayName, contact.email || ''),
    avatarClass: avatarColor(contact.email || ''),
    reason: item.reason,
    reasonLabel: REASON_LABELS[item.reason] || item.reason,
    reasonIcon: REASON_ICONS[item.reason] || 'clock',
    contextSnapshot: item.contextSnapshot || '',
    suggestedAction: item.suggestedAction || 'check_in',
    aiDraft: item.aiDraft || null,
    surfacedAt: item.surfacedAt,
    lastContactAt: contact.lastContactAt,
    lastDirection: contact.lastDirection,
    lastSubject: contact.lastSubject,
    daysAgo: daysAgo(contact.lastContactAt),
    status: item.status,
    drafting: false,
  }
}

export function useNetwork() {
  async function fetchContacts() {
    loading.value = true
    try {
      const data = await api('/network')
      contacts.value = data.contacts || []
    } catch (err) {
      console.error('Failed to fetch network contacts:', err)
    } finally {
      loading.value = false
    }
  }

  async function fetchFollowUps() {
    try {
      const data = await api('/network/follow-ups')
      followUps.value = (data.followUps || []).map(toFollowUpCard)
    } catch (err) {
      console.error('Failed to fetch follow-ups:', err)
    }
  }

  async function addContact(contactData) {
    try {
      const data = await api('/network', {
        method: 'POST',
        body: JSON.stringify(contactData),
      })
      await fetchContacts()
      return data
    } catch (err) {
      console.error('Failed to add contact:', err)
      throw err
    }
  }

  async function removeContact(id) {
    try {
      await api(`/network/${id}`, { method: 'DELETE' })
      contacts.value = contacts.value.filter(c => c.id !== id)
    } catch (err) {
      console.error('Failed to remove contact:', err)
      throw err
    }
  }

  async function updateContact(id, data) {
    try {
      await api(`/network/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      })
      await fetchContacts()
    } catch (err) {
      console.error('Failed to update contact:', err)
      throw err
    }
  }

  async function actOnFollowUp(id, action, snoozeDays) {
    try {
      await api(`/network/follow-ups/${id}/action`, {
        method: 'POST',
        body: JSON.stringify({ action, snoozeDays }),
      })
      // Remove from local state
      followUps.value = followUps.value.filter(f => f.id !== id)
    } catch (err) {
      console.error('Failed to act on follow-up:', err)
      throw err
    }
  }

  async function generateDraft(followUpId) {
    const item = followUps.value.find(f => f.id === followUpId)
    if (item) item.drafting = true

    try {
      const data = await api(`/network/follow-ups/${followUpId}/draft`, {
        method: 'POST',
      })
      // Update the follow-up with the draft
      if (item) {
        item.aiDraft = data.draft
        item.drafting = false
      }
      return data.draft
    } catch (err) {
      if (item) item.drafting = false
      console.error('Failed to generate draft:', err)
      throw err
    }
  }

  async function seedContacts() {
    seeding.value = true
    try {
      const data = await api('/network/seed', { method: 'POST' })
      suggestions.value = data.suggestions || []
      return data.suggestions
    } catch (err) {
      console.error('Failed to seed contacts:', err)
      throw err
    } finally {
      seeding.value = false
    }
  }

  async function batchAddContacts(contactsList) {
    try {
      const data = await api('/network/batch', {
        method: 'POST',
        body: JSON.stringify({ contacts: contactsList }),
      })
      await fetchContacts()
      return data
    } catch (err) {
      console.error('Failed to batch add contacts:', err)
      throw err
    }
  }

  async function addFact(contactId, fact, dateRelevant) {
    try {
      const data = await api(`/network/${contactId}/context`, {
        method: 'POST',
        body: JSON.stringify({ fact, dateRelevant }),
      })
      return data
    } catch (err) {
      console.error('Failed to add fact:', err)
      throw err
    }
  }

  async function removeFact(contactId, factId) {
    try {
      await api(`/network/${contactId}/context/${factId}`, { method: 'DELETE' })
    } catch (err) {
      console.error('Failed to remove fact:', err)
      throw err
    }
  }

  const followUpCount = computed(() => followUps.value.length)

  return {
    contacts,
    followUps,
    suggestions,
    loading,
    seeding,
    followUpCount,
    fetchContacts,
    fetchFollowUps,
    addContact,
    removeContact,
    updateContact,
    actOnFollowUp,
    generateDraft,
    seedContacts,
    batchAddContacts,
    addFact,
    removeFact,
  }
}
