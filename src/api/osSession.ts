import api from './client'

/**
 * OS Session API — communicates with the persistent CC OS session.
 * Response data streams via WebSocket, these calls just initiate/query.
 */

export async function sendOSMessage(message: string, mode: 'direct' | 'queue' = 'direct') {
  const { data } = await api.post('/os-session/message', { message, mode })
  return data as { accepted: boolean; status: string } | { queued_id: string; queued_at: string }
}

export async function getOSStatus() {
  const { data } = await api.get('/os-session/status')
  return data as {
    active: boolean
    sessionId: string | null
    ccCliSessionId: string | null
    status: 'idle' | 'streaming' | 'complete' | 'error'
    startedAt: string | null
  }
}

export async function restartOS() {
  const { data } = await api.post('/os-session/restart')
  return data as { sessionId: string }
}

export async function getOSHistory(limit = 100) {
  const { data } = await api.get('/os-session/history', { params: { limit } })
  return data.history as { content: string; created_at: string }[]
}

export async function compactOS(summary: string) {
  const { data } = await api.post('/os-session/compact', { summary }, { timeout: 0 })
  return data as { sessionId: string }
}

export async function getTokenUsage() {
  const { data } = await api.get('/os-session/tokens')
  return data as { input: number; output: number; total: number; threshold: number; needsCompaction: boolean }
}

export interface EnergySnapshot {
  weekStart: string
  inputTokens: number
  outputTokens: number
  turns: number
  pctUsed: number
  pctRemaining: number
  avgDailyBurn: number
  projectedPctUsed: number
  daysUntilExhaustion: number | null
  hoursUntilReset: number
  level: 'full' | 'healthy' | 'conserve' | 'low' | 'critical'
  label: string
  modelRec: 'opus' | 'sonnet' | 'bedrock-sonnet'
  scheduleMultiplier: number
  summary: string
  currentProvider: 'claude_max' | 'claude_max_2' | 'bedrock_opus' | 'bedrock_sonnet'
}

export async function getEnergy() {
  const { data } = await api.get('/os-session/energy')
  return data as EnergySnapshot
}

export async function getEnergyHistory(weeks = 4) {
  const { data } = await api.get('/os-session/energy/history', { params: { weeks } })
  return data.history as Array<{
    week_start: string
    provider: string
    input_tokens: number
    output_tokens: number
    turns: number
  }>
}

/** Recover missed assistant response after tab close / disconnect.
 *
 *  Accepts an optional opts object (Pinnacle P1):
 *  - sinceSeq: replay from a specific chunk-level seq
 *  - sinceTimestamp: ISO timestamp alternative to the positional `since` arg
 *
 *  Backward compatible — callers using only the first arg (`since`) continue
 *  to work without change. */
export async function recoverResponse(since?: string, opts?: { sinceSeq?: number; sinceTimestamp?: string }) {
  const params: Record<string, string | number> = {}
  if (since) params.since = since
  if (opts?.sinceSeq != null) params.since_seq = opts.sinceSeq
  if (opts?.sinceTimestamp) params.since_timestamp = opts.sinceTimestamp
  const { data } = await api.get('/os-session/recover', { params: Object.keys(params).length ? params : {} })
  return data as {
    found: boolean
    text: string
    chunks: string[]
    status: string
    streaming: boolean
    sessionId?: string
  }
}

/** Pinnacle P1: seq-based event replay from the backend ring buffer.
 *
 *  Call this whenever we detect a gap (`incoming.seq > lastSeenSeq + 1`)
 *  or on WS reconnect when `lastSeenSeq` is known. Returns every event
 *  with `seq > since_seq` that's still in the 100-event ring buffer. If
 *  `since_seq` is older than the oldest buffered event, the backend
 *  simply returns the whole buffer — callers should still dedupe by seq. */
export async function recoverEventsSince(sinceSeq: number) {
  const { data } = await api.get('/os-session/recover', { params: { since_seq: sinceSeq } })
  return data as {
    events: Array<{
      seq: number
      ts: string
      epoch?: string
      type: string
      sessionId?: string | null
      data?: unknown
      [k: string]: unknown
    }>
    count: number
    seq_based: true
    /** Current server seq-epoch. Clients clear their lastSeenSeq when this
     *  differs from the epoch on their last applied event. */
    epoch?: string
  }
}

/** Extended-recovery via the durable cc_session_logs transcript.
 *
 *  When the in-memory ring buffer can't cover a long disconnect (>500 events
 *  aged out, or PM2 restarted the session epoch and the ring is empty),
 *  this fetches the role-tagged transcript since `sinceIsoTs`. Use as a
 *  fallback after `recoverEventsSince()` returns count=0 or as the
 *  primary recover path on stream-error / extended-stale-stream.
 *
 *  Tool calls and thinking blocks are NOT here - those live only in the
 *  live event ring. This endpoint surfaces what would be rendered as chat
 *  messages, not the full SDK event stream.
 *
 *  Default lookback: 24h server-side. Max 1000 messages. */
export async function getMessagesSince(sinceIsoTs?: string, limit = 200) {
  const params: Record<string, string | number> = { limit }
  if (sinceIsoTs) params.since = sinceIsoTs
  const { data } = await api.get('/os-session/messages', { params })
  return data as {
    messages: Array<{ role: 'user' | 'assistant'; content: string; created_at: string }>
    session_id: string | null
    count: number
    since: string | null
  }
}

/** Abort the active OS session query immediately */
export async function abortOS() {
  const { data } = await api.post('/os-session/abort')
  return data as { aborted: boolean; reason?: string }
}

/** Manually trigger a handover (generates brief + warms new session) */
export async function triggerHandover() {
  const { data } = await api.post('/os-session/handover', {}, { timeout: 0 })
  return data
}

/** Upload a file to Supabase Storage via the backend, returns a public URL
 * + any server-extracted text (PDF/docx/txt-like files). Pass either `base64`
 * (binary, optionally as a data URL) or `text` (raw UTF-8). */
export async function uploadAttachment(file: {
  name: string
  type: string
  base64?: string
  text?: string
}) {
  const { data } = await api.post('/os-session/upload', file)
  return data as {
    url: string
    name: string
    type: string
    size: number
    extracted_text: string
  }
}
