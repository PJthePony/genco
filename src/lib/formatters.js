// Shared formatting utilities used across composables and components

const COLORS = ['av-orange', 'av-blue', 'av-purple', 'av-green', 'av-red']
const colorCache = {}

export function avatarColor(email) {
  if (!colorCache[email]) {
    const hash = email.split('').reduce((a, c) => a + c.charCodeAt(0), 0)
    colorCache[email] = COLORS[hash % COLORS.length]
  }
  return colorCache[email]
}

export function getInitials(name, email) {
  if (name) {
    const parts = name.trim().split(/\s+/)
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    return parts[0].slice(0, 2).toUpperCase()
  }
  return email.slice(0, 2).toUpperCase()
}

export function getOrg(email) {
  const domain = email.split('@')[1] || ''
  if (domain.includes('gmail') || domain.includes('yahoo') || domain.includes('hotmail') || domain.includes('outlook')) return ''
  const name = domain.split('.')[0]
  return name.charAt(0).toUpperCase() + name.slice(1)
}

export function timeAgo(dateStr) {
  const now = new Date()
  const date = new Date(dateStr)
  const diffMs = now - date
  const diffMin = Math.floor(diffMs / 60000)
  const diffHr = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)
  if (diffMin < 60) return `${diffMin}m ago`
  if (diffHr < 24) return `${diffHr}h ago`
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function daysAgo(dateStr) {
  if (!dateStr) return null
  const now = new Date()
  const date = new Date(dateStr)
  return Math.floor((now - date) / 86400000)
}
