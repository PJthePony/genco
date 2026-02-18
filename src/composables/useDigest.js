import { ref } from 'vue'
import { api } from './useApi'

const items = ref([])
const loading = ref(false)

const TAG_CLASSES = {
  sale: 'tag-sale',
  news: 'tag-news',
  update: 'tag-update',
}

function toDigestItem(item) {
  // Derive a tag from the sender domain
  const domain = (item.fromEmail || '').split('@')[1] || ''
  let tag = 'Update'
  let tagClass = 'tag-update'

  // Simple heuristic: news-like domains get "News" tag
  if (domain.includes('news') || domain.includes('morning') || domain.includes('daily')) {
    tag = 'News'
    tagClass = 'tag-news'
  } else if (domain.includes('sale') || domain.includes('deal') || domain.includes('shop')) {
    tag = 'Sale'
    tagClass = 'tag-sale'
  }

  return {
    id: item.id,
    source: item.fromName || item.fromEmail.split('@')[0],
    fromEmail: item.fromEmail,
    fromName: item.fromName,
    subject: item.subject,
    bodyHtml: item.bodyHtml,
    tag,
    tagClass,
    summary: item.aiSummary || item.subject,
    receivedAt: item.receivedAt,
  }
}

export function useDigest() {
  async function fetchDigest() {
    loading.value = true
    try {
      const data = await api('/queue/digest')
      items.value = (data.items || []).map(toDigestItem)
    } catch (err) {
      console.error('Failed to fetch digest:', err)
    } finally {
      loading.value = false
    }
  }

  return {
    items,
    loading,
    fetchDigest,
  }
}
