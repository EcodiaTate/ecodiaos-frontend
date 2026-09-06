import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * OS Session Store — state for the persistent CC OS session.
 * Manages the conversation stream, streaming state, and raw NDJSON chunks.
 *
 * Persistence: messages, sessionId, lastUserMessageAt survive tab close.
 * streamText and streamChunks are NOT persisted — they thrash localStorage
 * on every token delta, killing streaming performance.
 */

export interface OSSessionMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  /** Raw NDJSON chunks from CC stream-json (for distillation) */
  chunks?: string[]
  /** Tool calls that occurred during this response */
  tools?: LiveToolCall[]
  /** Extended thinking content for this response */
  thinking?: string
  /** Per-turn telemetry captured from turn_complete (Pinnacle P1) */
  telemetry?: TurnTelemetry
  timestamp: Date
}

export interface TokenUsage {
  input: number
  output: number
  total: number
  threshold: number
  needsCompaction: boolean
}

/** A live tool call being tracked during streaming */
export interface LiveToolCall {
  id: string
  name: string
  /** SDK tool_use_id — used to match tool_result events */
  toolUseId?: string
  /** Raw input JSON as it streams in */
  input?: string
  /** Tool result once received */
  result?: string
  startedAt: number
  completedAt?: number
  /** Pinnacle P1 lifecycle — 'preparing' between tool_use_starting and
   *  tool_use_input_complete; 'running' once input is finalised and the tool
   *  is actually executing; 'done' on tool_use_result; 'error' on tool_use_error. */
  status?: 'preparing' | 'running' | 'done' | 'error'
  /** True when status === 'error'; result carries the error body. */
  isError?: boolean
  /** Pinnacle P1: error message from tool_use_end when tool failed. */
  error?: string
}

/** Per-turn telemetry emitted in turn_complete (Pinnacle P1). */
export interface TurnTelemetry {
  turnId: string
  durationMs: number
  model?: string
  stopReason?: string | null
  at?: number
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  /** Tokens written to the cache during this turn (alias: cacheWriteTokens). */
  cacheCreationTokens?: number
  cacheWriteTokens?: number
  /** Estimated USD cost for this turn. */
  costUsd?: number
  /** Number of tool calls made during this turn. */
  toolCallCount?: number
  /** Total conversation turns in this session. */
  numTurns?: number
}

/** Transient inline banner (compaction, session events). */
export interface InlineBannerEntry {
  id: string
  kind: 'compaction' | 'session_event'
  /** For compaction: 'start' | 'end'. For session_event: the subtype string. */
  detail: string
  at: number
}

/**
 * Liveness signal from the backend. Emitted every 5s while a turn is in-flight
 * so the UI can show "still working — N seconds, running tool X" instead of a
 * blank spinner that looks frozen during long tool runs or thinking pauses.
 */
export interface LivenessSignal {
  phase: 'thinking' | 'tool'
  elapsedSec: number
  detail: {
    name: string
    runningSec: number
    outstanding: number
  } | null
  receivedAt: number
}

interface OSSessionStore {
  status: 'idle' | 'streaming' | 'complete' | 'error'
  /** Latest liveness tick from the backend. Null when idle or stale (>20s old). */
  liveness: LivenessSignal | null
  messages: OSSessionMessage[]
  /** Chunks accumulating for the current assistant response */
  streamChunks: string[]
  /** Extracted text content from current stream (for live display) */
  streamText: string
  /** Live tool calls in progress during current stream */
  streamTools: LiveToolCall[]
  /** Accumulated thinking text during current stream (real-time) */
  streamThinking: string
  /** Pinnacle P1: set on assistant_message_starting, cleared on first
   *  text_delta / tool_use_starting / turn_complete — drives the pre-token
   *  "thinking…" pulse so the gap between send and first output is visible. */
  assistantTurnStarting: boolean
  /** Pinnacle P1: latest pending turn telemetry (attached to the next finalised message). */
  pendingTurnTelemetry: TurnTelemetry | null
  /** Pinnacle P1: transient banners (compaction start/end, session_event). */
  inlineBanners: InlineBannerEntry[]
  /** Pinnacle P1: explicit compaction phase from compact_boundary events.
   *  Distinct from `compacting` (which was driven by legacy status messages). */
  compactionPhase: 'idle' | 'active'
  /** Pinnacle P1: monotonic seq of last WS event applied. Persisted so a hard
   *  refresh can request replay from the backend ring buffer. */
  lastSeenSeq: number | null
  /** Pinnacle P1: chunk-level seq of the last os-session:output chunk applied.
   *  Separate from lastSeenSeq (which tracks WS-message-level seq). */
  lastSeq: number | null
  /** Pinnacle P1: telemetry from the last completed turn. Survives
   *  finalizeResponse so it remains accessible after pendingTurnTelemetry is
   *  cleared. */
  lastTurnTelemetry: TurnTelemetry | null
  /** Pinnacle P1: true while compact_boundary phase='starting' is active (i.e.
   *  compaction is in progress). Cleared on phase='complete'. Distinct from
   *  compactionPhase (enum) — this boolean is for external consumers that just
   *  need a yes/no signal. */
  compactingInPlace: boolean
  sessionId: string | null
  /** Token usage tracking for auto-compaction */
  tokenUsage: TokenUsage | null
  /** Whether compaction is in progress */
  compacting: boolean
  /** ISO timestamp of last user message — used for recovery after tab close */
  lastUserMessageAt: string | null
  /** Whether recovery has been attempted this session */
  recoveryAttempted: boolean
  /** Messages sent by user while OS was streaming (interrupt queue) */
  interruptQueue: string[]
  /** Handover state — null when idle */
  handover: {
    phase: 'preparing' | 'warming' | 'complete' | 'failed' | 'cancelled'
    briefPreview?: string
    newSessionId?: string
    error?: string
  } | null

  /** Resilience: timestamp + reason from last os-session:status:error event.
   *  Cleared when status returns to 'idle' / on next user message / on
   *  successful extended-recovery. Drives the "Stream errored - tap to
   *  recover" pill. Origin: 7 May 2026 DeepSeek 400 storm phone-freeze. */
  lastErrorAt: string | null
  lastErrorReason: string | null
  /** Resilience: count of messages injected by the most recent extended-
   *  recovery call. Drives the "N new messages" pill. Cleared on tap or
   *  after auto-dismiss. */
  recoveredMessageCount: number

  // Actions
  setStatus: (status: OSSessionStore['status']) => void
  setLiveness: (signal: LivenessSignal | null) => void
  addUserMessage: (content: string) => void
  appendStreamChunk: (chunk: string) => void
  appendStreamText: (text: string) => void
  replaceStreamText: (text: string) => void
  addStreamTool: (tool: Omit<LiveToolCall, 'id' | 'startedAt'>) => void
  /** Match by toolUseId first, fall back to name */
  updateStreamTool: (idOrName: string, patch: Partial<LiveToolCall>) => void
  appendStreamThinking: (text: string) => void
  finalizeResponse: () => void
  setSessionId: (id: string | null) => void
  setTokenUsage: (usage: TokenUsage | null) => void
  setCompacting: (v: boolean) => void
  clearMessages: () => void
  /** Inject a recovered assistant message (from backend recovery) */
  injectRecoveredResponse: (text: string, chunks?: string[]) => void
  setRecoveryAttempted: () => void
  /** Queue an interrupt message (sent while OS is streaming) */
  queueInterrupt: (msg: string) => void
  clearInterruptQueue: () => void
  /** Update handover state (from WebSocket events) */
  setHandover: (state: OSSessionStore['handover']) => void
  // Pinnacle P1 actions
  setAssistantTurnStarting: (v: boolean) => void
  setPendingTurnTelemetry: (t: TurnTelemetry | null) => void
  pushInlineBanner: (b: Omit<InlineBannerEntry, 'id' | 'at'>) => void
  dismissInlineBanner: (id: string) => void
  setCompactionPhase: (p: 'idle' | 'active') => void
  setLastSeenSeq: (seq: number | null) => void
  setLastSeq: (seq: number | null) => void
  setLastTurnTelemetry: (t: TurnTelemetry | null) => void
  setCompactingInPlace: (v: boolean) => void
  /** Resilience: capture an os-session:status:error event with optional reason. */
  setError: (reason: string | null) => void
  /** Resilience: clear the error state (also resets status to 'idle' if currently 'error'). */
  clearError: () => void
  /** Resilience: dedup-merge messages from /os-session/messages?since= into
   *  the chat timeline. Skips any (role, content, ~created_at) already present
   *  among the latest 200 messages. Returns the count of messages newly added. */
  injectRecoveredMessages: (
    msgs: Array<{ role: 'user' | 'assistant'; content: string; created_at: string }>,
  ) => number
  /** Resilience: clear the "N new messages" pill counter. */
  clearRecoveredCount: () => void
  /** Render a delivered queued message as a user card without disrupting any
   *  in-flight stream state (status, streamText, buffers). Used when the
   *  backend auto-delivers queue messages — we want them visible in the chat
   *  timeline but not treated as a fresh user turn. */
  addDeliveredQueueMessage: (content: string) => void
}

/** Max messages to keep in memory/localStorage. Older messages are trimmed on add. */
const MAX_MESSAGES = 100

function trimMessages(msgs: OSSessionMessage[]): OSSessionMessage[] {
  return msgs.length > MAX_MESSAGES ? msgs.slice(-MAX_MESSAGES) : msgs
}

/**
 * Batched stream text accumulator.
 * Instead of calling set() on every single text_delta (which triggers a React
 * re-render + localStorage write per token), we accumulate deltas in a plain
 * string buffer and flush to Zustand state at ~30fps using requestAnimationFrame.
 * This reduces re-renders from ~50/s (one per token) to ~30/s (one per frame).
 */
let _streamTextBuffer = ''
let _streamChunkBuffer: string[] = []
let _streamThinkingBuffer = ''
let _flushScheduled = false
let _turnStartTimeout: ReturnType<typeof setTimeout> | null = null

function scheduleFlush() {
  if (_flushScheduled) return
  _flushScheduled = true
  requestAnimationFrame(() => {
    _flushScheduled = false
    const textToAdd = _streamTextBuffer
    const chunksToAdd = _streamChunkBuffer
    const thinkingToAdd = _streamThinkingBuffer
    _streamTextBuffer = ''
    _streamChunkBuffer = []
    _streamThinkingBuffer = ''

    if (!textToAdd && chunksToAdd.length === 0 && !thinkingToAdd) return

    useOSSessionStore.setState(state => ({
      ...(textToAdd ? { streamText: state.streamText + textToAdd } : {}),
      ...(chunksToAdd.length > 0 ? { streamChunks: [...state.streamChunks, ...chunksToAdd] } : {}),
      ...(thinkingToAdd ? { streamThinking: state.streamThinking + thinkingToAdd } : {}),
    }))
  })
}

/**
 * True current length of streamed text, accounting for the rAF-batched buffer
 * that hasn't flushed to Zustand state yet. Callers that need to compare an
 * incoming "full text" against what's already been received must use this —
 * checking `store.streamText.length` alone will be up to 1 frame stale and
 * miscount the gap.
 */
export function getEffectiveStreamTextLength(): number {
  return useOSSessionStore.getState().streamText.length + _streamTextBuffer.length
}

/**
 * Drop all pending rAF-buffered deltas without flushing them. Used when the
 * caller is about to wipe streamText/streamChunks/streamThinking entirely
 * (clearMessages, restart) — flushing would re-pollute the freshly-cleared
 * state with stale buffer content on the next rAF.
 */
export function resetStreamBuffers(): void {
  _streamTextBuffer = ''
  _streamChunkBuffer = []
  _streamThinkingBuffer = ''
  _flushScheduled = false
  if (_turnStartTimeout) {
    clearTimeout(_turnStartTimeout)
    _turnStartTimeout = null
  }
}

/**
 * Force-flush any pending rAF-buffered deltas into the store synchronously.
 * Used when a terminal event (assistant complete, finalize) arrives before
 * the next animation frame — without this, the last ~1 frame of deltas would
 * be lost because the buffer is reset on `addUserMessage` / `finalizeResponse`.
 */
export function flushStreamBuffersSync(): void {
  if (!_streamTextBuffer && _streamChunkBuffer.length === 0 && !_streamThinkingBuffer) return
  const textToAdd = _streamTextBuffer
  const chunksToAdd = _streamChunkBuffer
  const thinkingToAdd = _streamThinkingBuffer
  _streamTextBuffer = ''
  _streamChunkBuffer = []
  _streamThinkingBuffer = ''
  _flushScheduled = false
  useOSSessionStore.setState(state => ({
    ...(textToAdd ? { streamText: state.streamText + textToAdd } : {}),
    ...(chunksToAdd.length > 0 ? { streamChunks: [...state.streamChunks, ...chunksToAdd] } : {}),
    ...(thinkingToAdd ? { streamThinking: state.streamThinking + thinkingToAdd } : {}),
  }))
}

export const useOSSessionStore = create<OSSessionStore>()(persist((set, get) => ({
  status: 'idle',
  liveness: null,
  messages: [],
  streamChunks: [],
  streamText: '',
  streamTools: [],
  streamThinking: '',
  assistantTurnStarting: false,
  pendingTurnTelemetry: null,
  inlineBanners: [],
  compactionPhase: 'idle',
  lastSeenSeq: null,
  lastSeq: null,
  lastTurnTelemetry: null,
  compactingInPlace: false,
  sessionId: null,
  tokenUsage: null,
  compacting: false,
  lastUserMessageAt: null,
  recoveryAttempted: false,
  interruptQueue: [],
  handover: null,
  lastErrorAt: null,
  lastErrorReason: null,
  recoveredMessageCount: 0,

  setStatus: (status) => set({ status }),
  setLiveness: (signal) => set({ liveness: signal }),

  addUserMessage: (content) => {
    // Safety timeout: if no backend event arrives at all within 30s, clear
    // the pre-token pulse so the UI doesn't shimmer forever against a dead
    // backend. Real turns will have cleared it within the first few hundred
    // ms via text_delta, tool_use_starting, thinking, or liveness.
    if (_turnStartTimeout) clearTimeout(_turnStartTimeout)
    _turnStartTimeout = setTimeout(() => {
      _turnStartTimeout = null
      const s = useOSSessionStore.getState()
      if (s.assistantTurnStarting && !s.streamText && !s.streamThinking && s.streamTools.length === 0) {
        useOSSessionStore.setState({ assistantTurnStarting: false })
      }
    }, 30_000)
    set(state => {
      // If there's an in-progress stream, snapshot it as a completed assistant message
      // before adding the user message. This preserves tools/thinking on interrupt.
      const inFlightMessages: OSSessionMessage[] = []
      if (state.streamText || state.streamChunks.length > 0 || state.streamTools.length > 0) {
        // When the user interrupts mid-turn, snapshot what we have. Falling back
        // to "(processing...)" made the truncated assistant message look like it
        // had frozen; describe what was actually captured instead.
        const snapshotContent = state.streamText
          || (state.streamTools.length > 0 ? `(interrupted mid-turn — ${state.streamTools.length} tool call${state.streamTools.length === 1 ? '' : 's'} in progress)` : '')
          || (state.streamThinking ? '(interrupted mid-turn — thinking in progress)' : '(interrupted)')
        inFlightMessages.push({
          id: crypto.randomUUID(),
          role: 'assistant' as const,
          content: snapshotContent,
          chunks: state.streamChunks,
          tools: state.streamTools.length > 0 ? state.streamTools : undefined,
          thinking: state.streamThinking || undefined,
          timestamp: new Date(),
        })
      }
      return {
        messages: trimMessages([
          ...state.messages,
          ...inFlightMessages,
          {
            id: crypto.randomUUID(),
            role: 'user' as const,
            content,
            timestamp: new Date(),
          },
        ]),
        status: 'streaming' as const,
        liveness: null,
        streamChunks: [],
        streamText: '',
        streamTools: [],
        streamThinking: '',
        assistantTurnStarting: true,
        pendingTurnTelemetry: null,
        lastUserMessageAt: new Date().toISOString(),
        recoveryAttempted: false,
        // Resilience: a fresh user send clears the error pill - either the
        // user is moving on past the previous error or the new turn will
        // re-establish flow. Either way the stale pill must dismiss.
        lastErrorAt: null,
        lastErrorReason: null,
        recoveredMessageCount: 0,
      }
    })
  },

  appendStreamChunk: (chunk) => {
    _streamChunkBuffer.push(chunk)
    scheduleFlush()
  },

  appendStreamText: (text) => {
    _streamTextBuffer += text
    scheduleFlush()
  },

  replaceStreamText: (text) => {
    set({ streamText: text })
  },

  addStreamTool: (tool) => {
    set(state => {
      // Idempotent by toolUseId: the backend emits both a new lifecycle event
      // (tool_use_starting) AND a legacy bulk event (tool_use) for the same
      // tool call. Both funnel here. If we've already tracked this toolUseId,
      // treat the repeat as a no-op — the lifecycle owns the record and will
      // update it through its preparing/running/done states.
      if (tool.toolUseId && state.streamTools.some(t => t.toolUseId === tool.toolUseId)) {
        return state
      }
      // Secondary dedupe when the caller couldn't supply a toolUseId (legacy
      // CLI streams): if a tool with the SAME name and input was just added
      // (within 1s, still running), treat as duplicate. Prevents the double-
      // pill rendering seen when the same tool event arrives on two code paths.
      if (!tool.toolUseId) {
        const now = Date.now()
        const recentDup = state.streamTools.find(t =>
          !t.toolUseId &&
          t.name === tool.name &&
          (t.input || null) === (tool.input || null) &&
          !t.completedAt &&
          now - t.startedAt < 1000
        )
        if (recentDup) return state
      }
      return {
        streamTools: [...state.streamTools, {
          id: crypto.randomUUID(),
          startedAt: Date.now(),
          ...tool,
        }],
      }
    })
  },

  updateStreamTool: (idOrName, patch) => {
    // Strict match by toolUseId first. If the caller passes a toolUseId that
    // matches no tool, DO NOT fall back to name-match — two concurrent Bash
    // calls would otherwise both receive the patch for whichever finishes first,
    // clobbering each other. Name-match is only used as a last resort when we
    // know the id wasn't available (legacy tool_result path without tool_use_id).
    set(state => {
      const idMatch = state.streamTools.some(t => t.toolUseId === idOrName)
      return {
        streamTools: state.streamTools.map(t => {
          if (idMatch) {
            return t.toolUseId === idOrName ? { ...t, ...patch } : t
          }
          // Fallback path: no tool has that id, so the caller was probably
          // passing a name. Match by name, and only if exactly one tool has
          // that name is in flight — otherwise we'd corrupt state.
          const sameNameTools = state.streamTools.filter(
            x => x.name === idOrName && (x.status === 'preparing' || x.status === 'running' || !x.completedAt)
          )
          if (sameNameTools.length === 1) {
            return t === sameNameTools[0] ? { ...t, ...patch } : t
          }
          return t
        }),
      }
    })
  },

  appendStreamThinking: (text) => {
    _streamThinkingBuffer += text
    scheduleFlush()
  },

  finalizeResponse: () => {
    // Idempotent: if we're already complete/idle with nothing in flight, this
    // is a duplicate event (WS complete + 5s poll both resolving, etc.) — no-op.
    const pre = get()
    if (pre.status !== 'streaming' &&
        !_streamTextBuffer && _streamChunkBuffer.length === 0 && !_streamThinkingBuffer &&
        !pre.streamText && pre.streamChunks.length === 0 && pre.streamTools.length === 0 && !pre.streamThinking) {
      return
    }
    // Flush any buffered deltas immediately before finalizing
    if (_streamTextBuffer || _streamChunkBuffer.length > 0 || _streamThinkingBuffer) {
      const s = get()
      set({
        streamText: s.streamText + _streamTextBuffer,
        streamChunks: _streamChunkBuffer.length > 0 ? [...s.streamChunks, ..._streamChunkBuffer] : s.streamChunks,
        streamThinking: s.streamThinking + _streamThinkingBuffer,
      })
      _streamTextBuffer = ''
      _streamChunkBuffer = []
      _streamThinkingBuffer = ''
      _flushScheduled = false
    }

    const { streamChunks, streamText, streamTools, streamThinking, pendingTurnTelemetry } = get()
    // Only add a message if we have content
    if (streamChunks.length === 0 && !streamText && streamTools.length === 0 && !streamThinking) {
      set({
        status: 'complete',
        streamChunks: [], streamText: '', streamTools: [], streamThinking: '',
        assistantTurnStarting: false,
        pendingTurnTelemetry: null,
        lastUserMessageAt: null,
      })
      return
    }
    // Finalise with the text we actually got. No placeholder copy when text
    // is empty — the tool pills + thinking block tell the full story
    // themselves, and narrating "the OS did N things, no text response"
    // added noise without adding information.
    const finalContent = streamText || ''
    set(state => ({
      messages: trimMessages([...state.messages, {
        id: crypto.randomUUID(),
        role: 'assistant' as const,
        content: finalContent,
        chunks: streamChunks,
        tools: streamTools.length > 0 ? streamTools : undefined,
        thinking: streamThinking || undefined,
        telemetry: pendingTurnTelemetry || undefined,
        timestamp: new Date(),
      }]),
      status: 'complete',
      liveness: null,
      streamChunks: [],
      streamText: '',
      streamTools: [],
      streamThinking: '',
      assistantTurnStarting: false,
      pendingTurnTelemetry: null,
      lastUserMessageAt: null,
    }))
  },

  setSessionId: (id) => set({ sessionId: id }),
  setTokenUsage: (usage) => set({ tokenUsage: usage }),
  setCompacting: (v) => set({ compacting: v }),
  clearMessages: () => {
    resetStreamBuffers()
    set({
      messages: [], streamChunks: [], streamText: '', streamTools: [], streamThinking: '', status: 'idle',
      tokenUsage: null, lastUserMessageAt: null, recoveryAttempted: false, interruptQueue: [],
      assistantTurnStarting: false, pendingTurnTelemetry: null, inlineBanners: [],
      compactionPhase: 'idle', lastSeenSeq: null, lastSeq: null, lastTurnTelemetry: null,
    })
  },

  /** Inject a response recovered from the backend after tab close */
  injectRecoveredResponse: (text, chunks) => {
    if (!text && (!chunks || chunks.length === 0)) return
    set(state => ({
      messages: trimMessages([...state.messages, {
        id: crypto.randomUUID(),
        role: 'assistant' as const,
        content: text || '(recovered response)',
        chunks,
        timestamp: new Date(),
      }]),
      status: 'complete',
      liveness: null,
      streamChunks: [],
      streamText: '',
      streamTools: [],
      streamThinking: '',
      lastUserMessageAt: null,
    }))
  },

  setRecoveryAttempted: () => set({ recoveryAttempted: true }),

  queueInterrupt: (msg) => {
    set(state => ({ interruptQueue: [...state.interruptQueue, msg] }))
  },

  clearInterruptQueue: () => set({ interruptQueue: [] }),

  setHandover: (handoverState) => set({ handover: handoverState }),

  // ─── Pinnacle P1 actions ────────────────────────────────────────────────

  setAssistantTurnStarting: (v) => set({ assistantTurnStarting: v }),

  setPendingTurnTelemetry: (t) => set({ pendingTurnTelemetry: t }),

  pushInlineBanner: (b) => {
    set(state => ({
      inlineBanners: [
        ...state.inlineBanners,
        { id: crypto.randomUUID(), at: Date.now(), ...b },
      ],
    }))
  },

  dismissInlineBanner: (id) => {
    set(state => ({
      inlineBanners: state.inlineBanners.filter(bn => bn.id !== id),
    }))
  },

  setCompactionPhase: (p) => set({ compactionPhase: p }),

  setLastSeenSeq: (seq) => set({ lastSeenSeq: seq }),

  setLastSeq: (seq) => set({ lastSeq: seq }),

  setLastTurnTelemetry: (t) => set({ lastTurnTelemetry: t }),

  setCompactingInPlace: (v) => set({ compactingInPlace: v }),

  setError: (reason) => set({
    lastErrorAt: new Date().toISOString(),
    lastErrorReason: reason,
  }),
  clearError: () => set(state => ({
    lastErrorAt: null,
    lastErrorReason: null,
    status: state.status === 'error' ? 'idle' : state.status,
  })),
  injectRecoveredMessages: (msgs) => {
    if (!msgs || msgs.length === 0) return 0
    const state = get()
    // Dedup window: last 200 existing messages, match by (role, trimmed content,
    // created_at within 2s). Server log times can drift slightly from the live
    // event timestamp the FE captured.
    const existing = state.messages.slice(-200)
    const seenKeys = new Set<string>()
    for (const m of existing) {
      const ts = m.timestamp instanceof Date ? m.timestamp.getTime() : new Date(m.timestamp).getTime()
      // Bucket by 2s windows so log-time vs live-time drift collapses to the
      // same bucket. Drop the last 3 digits of millis (ie /1000) to round to seconds.
      const bucket = Math.floor(ts / 2000)
      seenKeys.add(`${m.role}|${(m.content || '').trim()}|${bucket}`)
      // Also tolerate +/- 1 bucket for cross-second message timing.
      seenKeys.add(`${m.role}|${(m.content || '').trim()}|${bucket - 1}`)
      seenKeys.add(`${m.role}|${(m.content || '').trim()}|${bucket + 1}`)
    }
    const additions: OSSessionMessage[] = []
    for (const r of msgs) {
      const ts = new Date(r.created_at).getTime()
      const bucket = Math.floor(ts / 2000)
      const key = `${r.role}|${(r.content || '').trim()}|${bucket}`
      if (seenKeys.has(key)) continue
      seenKeys.add(key)
      additions.push({
        id: crypto.randomUUID(),
        role: r.role,
        content: r.content,
        timestamp: new Date(r.created_at),
      })
    }
    if (additions.length === 0) return 0
    // Splice additions into the message timeline ordered by timestamp.
    set(s => ({
      messages: trimMessages(
        [...s.messages, ...additions].sort((a, b) => {
          const ta = a.timestamp instanceof Date ? a.timestamp.getTime() : new Date(a.timestamp).getTime()
          const tb = b.timestamp instanceof Date ? b.timestamp.getTime() : new Date(b.timestamp).getTime()
          return ta - tb
        })
      ),
      recoveredMessageCount: s.recoveredMessageCount + additions.length,
    }))
    return additions.length
  },
  clearRecoveredCount: () => set({ recoveredMessageCount: 0 }),

  addDeliveredQueueMessage: (content) => {
    if (!content) return
    set(state => ({
      messages: trimMessages([
        ...state.messages,
        {
          id: crypto.randomUUID(),
          role: 'user' as const,
          content,
          timestamp: new Date(),
        },
      ]),
      lastUserMessageAt: new Date().toISOString(),
    }))
  },
}),
{
  name: 'os-session-chat',
  partialize: (state) => ({
    messages: state.messages,
    sessionId: state.sessionId,
    lastUserMessageAt: state.lastUserMessageAt,
    // Pinnacle P1: persist lastSeenSeq so a hard refresh / tab close can
    // request replay from the backend ring buffer.
    lastSeenSeq: state.lastSeenSeq,
  }),
},
))
