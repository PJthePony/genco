# Genco — Implementation & Test Plan

## Current State
Frontend prototype is live at genco.tanzillo.ai with shared Supabase auth working. All data is mock/hardcoded. No backend exists yet.

---

## Phase 1: Backend Foundation
**Goal:** Hono + TypeScript server with database, deployed on Railway

### 1.1 — Project Scaffold
- Hono + Node.js + TypeScript (mirror Luca's stack)
- Drizzle ORM + PostgreSQL (use Supabase's Postgres, or separate Railway Postgres)
- Deploy to Railway at `api.genco.tanzillo.ai`

### 1.2 — Database Schema

**gmail_connections**
- id, user_id, gmail_address, google_tokens (jsonb), created_at, updated_at

**email_queue** (the core triage queue)
- id, user_id, gmail_message_id (unique), gmail_thread_id
- from_email, from_name, subject, body_text, body_html
- received_at, ai_summary, ai_recommended_action, ai_priority, is_urgent
- status (pending | processed | skipped), chosen_action, processed_at, created_at

**feedback_log** (migrate from localStorage)
- id, user_id, email_queue_id (FK), sender
- original_action, chosen_action, reason, created_at

**briefing_sources**
- id, user_id, email_address, display_name, tag, created_at

**user_preferences**
- id, user_id, scan_frequency, urgent_sms_enabled, phone_number, created_at

### 1.3 — Auth Middleware
- Read `sb_access_token` from cookie (copy Luca's `verifySupabaseJwt` pattern)
- All API routes require valid Supabase JWT
- CORS: allow genco.tanzillo.ai

### 1.4 — Fix Luca CORS
- Update Luca's `/auth/session/refresh` to allow genco.tanzillo.ai origin
- Dynamic origin check against allowlist instead of hardcoded tessio.tanzillo.ai

**Tests:**
- Health endpoint returns 200
- Auth middleware rejects unauthenticated requests
- Luca cookie sync works from genco.tanzillo.ai

---

## Phase 2: Gmail Integration
**Goal:** Connect Gmail, fetch emails, store in queue

### 2.1 — Google OAuth for Gmail
- Reuse Luca's OAuth pattern (`getAuthUrl`, `exchangeCode`)
- Scopes: `gmail.readonly`, `gmail.modify`, `gmail.send`
- `GET /auth/google` → redirect to Google consent
- `GET /auth/google/callback` → exchange code, store tokens in gmail_connections
- Frontend Settings: "Connect Gmail" button replaces hardcoded account display

### 2.2 — Email Fetching
- `GET /emails/scan` — fetch new emails since last scan
- Gmail API: `messages.list` with `q="is:unread in:inbox"` + historyId for incremental
- Parse each message: extract from, subject, body (text + html), date
- Store in email_queue with `status='pending'`
- Track last historyId for incremental fetches (no duplicates)

### 2.3 — Scheduled Scanning
- Cron job or BullMQ recurring job: every hour, scan all connected accounts
- Alternative: Railway cron or simple setInterval

**Tests:**
- OAuth flow completes, tokens stored
- Manual scan fetches real emails from inbox
- Incremental scan avoids duplicates
- Token refresh works when access_token expires

---

## Phase 3: AI Classification
**Goal:** Claude analyzes each email and recommends an action

### 3.1 — Email Classifier
- Anthropic SDK with claude-sonnet (reuse Luca's tool-use pattern)
- Tool schema returns: summary, recommended_action, priority, is_urgent, reply_draft, task_title
- Process each email_queue row where `status='pending'` and `ai_summary IS NULL`

### 3.2 — Classification with Context
- Include user's feedback history as system context
  - "User previously changed Archive → Reply for Sarah Chen because 'I always reply to this person'"
- Include briefing_sources list so classifier routes matching senders to "+ Briefing"
- Classify into: Reply, + Task, Archive, Unsubscribe, + Briefing, Act

### 3.3 — Urgent Detection + SMS
- If `is_urgent=true`, send SMS/iMessage to user
- Reuse Luca's iMessage gateway pattern, or add Twilio
- Configurable via user_preferences

**Tests:**
- Newsletter → Archive or Unsubscribe
- Personal email → Reply
- Actionable request → + Task
- Feedback history influences future recommendations
- Urgent emails trigger SMS
- Edge cases: empty body, attachments, foreign language

---

## Phase 4: API Endpoints + Frontend Wiring
**Goal:** Replace all mock data with real API calls

### 4.1 — Queue API
- `GET /queue` — pending items, ordered by priority then received_at
- `GET /queue/digest` — briefing source items
- `POST /queue/:id/action` — record chosen_action + execute it

### 4.2 — Action Execution
When user approves:
- **Reply** → `gmail.users.drafts.create`, return draft link
- **+ Task** → POST to Tessio API (same as Luca: `tags: ['genco']`)
- **Archive** → Gmail modify: remove INBOX label
- **Unsubscribe** → Archive + suppression list
- **+ Briefing** → Add sender to briefing_sources, archive email
- **Act** → Mark processed (manual action)

### 4.3 — Feedback API
- `POST /feedback` — persist to feedback_log table
- `GET /feedback/stats` — override patterns for Settings
- Migrate `useFeedback.js` from localStorage to API (keep composable interface)

### 4.4 — Settings API
- CRUD `/briefing-sources`
- `GET/PUT /preferences` — scan frequency, SMS toggle
- `GET /gmail/status` — connection status

### 4.5 — Frontend Integration
- New composable: `useQueue()` → replaces hardcoded cards array
- New composable: `useDigest()` → replaces hardcoded digestItems
- Update `useFeedback()` → POST to API instead of localStorage
- New composable: `useSettings()` → CRUD for sources and preferences
- Add loading states, error handling, empty states
- Add "Connect Gmail" flow in Settings

**Tests:**
- Dashboard loads real emails from API
- "Reply" creates Gmail draft
- "+ Task" creates task in Tessio with [genco] tag
- "Archive" removes from Gmail inbox
- Feedback persists across devices
- Settings changes persist

---

## Phase 5: Daily Briefing
**Goal:** Auto-summarize briefing source emails into the digest

### 5.1 — Briefing Pipeline
During hourly scan, emails from briefing_sources senders:
1. Auto-archived in Gmail (remove INBOX label)
2. Summarized by Claude (one-line summary)
3. Stored in email_queue with `recommended_action='+ Briefing'`

`GET /queue/digest` returns these for the DailyDigest component.

### 5.2 — Frontend
- DailyDigest.vue fetches from `/queue/digest`
- "Manage sources" in Settings uses real CRUD
- "+ Briefing" action adds sender to briefing_sources

**Tests:**
- Briefing source emails appear in digest, not decision queue
- "+ Briefing" action routes future emails from that sender
- Removing source stops routing
- Auto-archive removes from Gmail inbox

---

## Phase 6: Polish & Production Hardening

### 6.1 — Error Handling
- Gmail token expiry → auto-refresh, "Reconnect Gmail" fallback
- API timeouts → retry with backoff
- Claude API errors → show email without AI summary
- Rate limiting on scan endpoint

### 6.2 — Mobile UX
- Bottom sheet modal on mobile
- Pull-to-refresh on dashboard
- "Scanning..." loading indicator

### 6.3 — Performance
- Pagination for queue (don't load 100+ emails at once)
- Debounce feedback submissions
- Cache digest items until next scan

### 6.4 — Security
- RLS on all Supabase tables (`user_id = auth.uid()`)
- Gmail tokens encrypted at rest
- Rate limit scan endpoint
- Validate all API inputs

**Tests:**
- Works on mobile Safari and Chrome
- Token refresh works silently
- Large inboxes (100+ unread) handled gracefully
- Degrades when Claude API is down

---

## Manual Test Checklist

- [ ] Login via magic link on genco.tanzillo.ai
- [ ] Login on tessio.tanzillo.ai → visit genco.tanzillo.ai → already logged in
- [ ] Connect Gmail in Settings
- [ ] Trigger manual scan → emails appear as decision cards
- [ ] Approve "Reply" → Gmail draft created
- [ ] Approve "+ Task" → task appears in Tessio with [genco] tag
- [ ] Approve "Archive" → email removed from inbox
- [ ] Click "Change" → pick alt → feedback prompt appears
- [ ] Submit feedback with reason → shows in Settings > AI Learning
- [ ] Skip feedback → correction logged without reason
- [ ] Add sender to Daily Briefing via "+ Briefing" action
- [ ] Next scan: that sender's emails in digest, not queue
- [ ] Remove briefing source in Settings
- [ ] Urgent email triggers SMS/iMessage
- [ ] Clear all cards → "All clear, Don." empty state
- [ ] Log out → cookie cleared across all apps
- [ ] Test on mobile: bottom sheet, touch targets

---

## Build Order
1. **Backend scaffold** + DB + auth middleware + Luca CORS fix
2. **Gmail OAuth** + email fetching
3. **AI classification** + urgent detection
4. **API endpoints** + wire frontend to real data
5. **Daily briefing** pipeline
6. **Polish**, error handling, mobile, security
