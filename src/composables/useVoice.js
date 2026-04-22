import { ref } from 'vue'
import { api } from './useApi'

const profiles = ref([])
const analyzedAt = ref(null)
const sampleCount = ref(0)
const loading = ref(false)
const analyzing = ref(false)

export function useVoice() {
  async function fetchProfiles() {
    loading.value = true
    try {
      const data = await api('/voice')
      profiles.value = data.profiles || []
      analyzedAt.value = data.analyzedAt || null
      sampleCount.value = data.sampleCount || 0
    } finally {
      loading.value = false
    }
  }

  async function runAnalysis(batchSize = 50) {
    analyzing.value = true
    try {
      const data = await api('/voice/analyze', {
        method: 'POST',
        body: JSON.stringify({ batchSize }),
      })
      await fetchProfiles()
      return data
    } finally {
      analyzing.value = false
    }
  }

  async function resetSamples() {
    await api('/voice/samples', { method: 'DELETE' })
    await fetchProfiles()
  }

  async function updateProfile(id, patch) {
    const data = await api(`/voice/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    })
    // Update locally
    const idx = profiles.value.findIndex((p) => p.id === id)
    if (idx >= 0 && data.profile) profiles.value[idx] = data.profile
    return data
  }

  async function deleteProfile(id) {
    await api(`/voice/${id}`, { method: 'DELETE' })
    profiles.value = profiles.value.filter((p) => p.id !== id)
  }

  async function previewDrafts({ bucketId, recipientName, recipientEmail, scenario }) {
    const data = await api('/voice/preview', {
      method: 'POST',
      body: JSON.stringify({ bucketId, recipientName, recipientEmail, scenario }),
    })
    return data
  }

  return {
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
  }
}
