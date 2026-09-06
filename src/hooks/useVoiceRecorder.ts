/**
 * useVoiceRecorder - shared hook for MediaRecorder + Whisper chunk pipeline.
 *
 * Extracted from /voice page logic. Consumed by:
 *   - MicButton embedded in the conductor chat input panel (ChatInputPanel)
 *   - VoicePage (/voice standalone diagnostic surface)
 *
 * Records audio via MediaRecorder in 5s timeslices, queues chunks, uploads
 * each to /api/voice/chunk (Whisper transcription), calls onChunkTranscribed
 * for each completed chunk. The backend voiceBuffer drains transcriptions into
 * conductor chat automatically — the caller does NOT need to call addUserMessage().
 *
 * Session IDs:
 *   Default (persistSessionId: false): fresh UUID per startRecording() call.
 *   persistSessionId: true: session persisted to localStorage so page refreshes
 *   continue the same session (Voice.tsx diagnostic-surface behaviour).
 *
 * Error handling:
 *   First failure on a chunk: wait 2s, retry once.
 *   Second failure: skip chunk, continue recording.
 *   Error string exposed via `error` field. Recording is NOT stopped on upload
 *   errors so the caller's mic feedback stays live.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuthStore } from '@/store/authStore'

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) || '/api'

const MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg',
] as const

export function pickMimeType(): string | null {
  if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return null
  for (const m of MIME_CANDIDATES) {
    try {
      if (MediaRecorder.isTypeSupported(m)) return m
    } catch {
      /* noop */
    }
  }
  return null
}

export function newUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  const bytes = new Uint8Array(16)
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes)
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256)
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'))
  return (
    hex.slice(0, 4).join('') +
    '-' +
    hex.slice(4, 6).join('') +
    '-' +
    hex.slice(6, 8).join('') +
    '-' +
    hex.slice(8, 10).join('') +
    '-' +
    hex.slice(10, 16).join('')
  )
}

const LS_SESSION_KEY = 'ecodia.voice.sessionId'

interface QueueItem {
  blob: Blob
  seq: number
  ts: string
  attempts: number
}

export type VoiceRecorderState = 'idle' | 'recording' | 'stopping' | 'error'

export interface ChunkResult {
  seq: number
  ts: string
  text: string
  dropped: boolean
}

export interface UseVoiceRecorderOptions {
  /**
   * Called after each chunk is transcribed (or determined to be silence).
   * text === '' when dropped (silence).
   */
  onChunkTranscribed?: (result: ChunkResult) => void
  /**
   * When true, session ID is persisted to localStorage and reused on page
   * refresh. When false (default), a fresh UUID is generated per startRecording().
   */
  persistSessionId?: boolean
}

export interface UseVoiceRecorderReturn {
  state: VoiceRecorderState
  /** 0..1 RMS amplitude from the AnalyserNode. 0 when not recording. */
  audioLevel: number
  /** Integer seconds elapsed since startRecording(). Resets on each call. */
  elapsedSeconds: number
  /** Chunks dispatched this session (resets per startRecording). */
  chunkCount: number
  /** Silence-dropped chunks this session. */
  dropCount: number
  /** Preview of the last successfully transcribed chunk (max 80 chars). */
  lastTranscript: string
  /** Latest error message, or null. Cleared on each successful chunk upload. */
  error: string | null
  /** Active session ID (set on hook init or each startRecording). */
  sessionId: string
  startRecording: () => Promise<void>
  stopRecording: () => void
}

export function useVoiceRecorder(opts?: UseVoiceRecorderOptions): UseVoiceRecorderReturn {
  const token = useAuthStore((s) => s.token)

  const [state, setState] = useState<VoiceRecorderState>('idle')
  const [audioLevel, setAudioLevel] = useState(0)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [chunkCount, setChunkCount] = useState(0)
  const [dropCount, setDropCount] = useState(0)
  const [lastTranscript, setLastTranscript] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState('')

  // Stable refs for in-flight async work
  const mimeRef = useRef<string | null>(null)
  const sessionIdRef = useRef('')
  const persistRef = useRef(opts?.persistSessionId ?? false)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const rafRef = useRef<number | null>(null)
  const seqRef = useRef(0)
  const queueRef = useRef<QueueItem[]>([])
  const drainingRef = useRef(false)
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const startTimeRef = useRef(0)
  const onChunkRef = useRef(opts?.onChunkTranscribed)

  // Keep callback refs stable across renders
  useEffect(() => {
    onChunkRef.current = opts?.onChunkTranscribed
    persistRef.current = opts?.persistSessionId ?? false
  })

  // Init session ID. If persisting, read localStorage; else will be set at startRecording.
  useEffect(() => {
    if (persistRef.current) {
      try {
        const saved = window.localStorage.getItem(LS_SESSION_KEY)
        if (saved && saved.length > 8) {
          sessionIdRef.current = saved
          setSessionId(saved)
          return
        }
      } catch {
        /* noop */
      }
      const fresh = newUUID()
      try { window.localStorage.setItem(LS_SESSION_KEY, fresh) } catch { /* noop */ }
      sessionIdRef.current = fresh
      setSessionId(fresh)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const drainQueue = useCallback(async () => {
    if (drainingRef.current) return
    drainingRef.current = true
    const mime = mimeRef.current
    const sid = sessionIdRef.current
    try {
      while (queueRef.current.length > 0) {
        const item = queueRef.current[0]
        try {
          const fd = new FormData()
          const ext = (mime ?? '').includes('mp4')
            ? 'mp4'
            : (mime ?? '').includes('ogg')
              ? 'ogg'
              : 'webm'
          fd.append('audio', item.blob, `chunk-${item.seq}.${ext}`)
          fd.append('session_id', sid)
          fd.append('seq', String(item.seq))
          fd.append('timestamp', item.ts)
          if (mime) fd.append('mime', mime)

          const headers: Record<string, string> = {}
          if (token) headers.Authorization = `Bearer ${token}`

          const res = await fetch(`${API_BASE}/voice/chunk`, {
            method: 'POST',
            body: fd,
            headers,
          })
          if (!res.ok) throw new Error(`HTTP ${res.status}`)

          const data = (await res.json().catch(() => ({}))) as {
            dropped?: boolean
            text?: string
            transcript?: string
          }
          const text = data.text ?? data.transcript ?? ''
          const dropped = !!data.dropped || !text

          if (!dropped) {
            setLastTranscript(text.length > 80 ? text.slice(0, 77) + '...' : text)
          } else {
            setDropCount((c) => c + 1)
          }

          onChunkRef.current?.({
            seq: item.seq,
            ts: item.ts,
            text: dropped ? '' : text,
            dropped,
          })

          queueRef.current.shift()
          setError(null)
        } catch (e) {
          item.attempts += 1
          if (item.attempts === 1) {
            // First failure: brief wait then retry
            setError((e as Error).message)
            await new Promise((r) => setTimeout(r, 2000))
            continue
          }
          // Second failure: skip chunk, keep recording
          setError(`chunk ${item.seq} skipped after retry`)
          queueRef.current.shift()
          break
        }
      }
    } finally {
      drainingRef.current = false
    }
  }, [token])

  const stopLevelMeter = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    analyserRef.current = null
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {})
      audioCtxRef.current = null
    }
    setAudioLevel(0)
  }, [])

  const startLevelMeter = useCallback((stream: MediaStream) => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const Ctx = window.AudioContext || (window as any).webkitAudioContext
      const ctx = new Ctx()
      audioCtxRef.current = ctx
      const src = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 512
      src.connect(analyser)
      analyserRef.current = analyser
      const buf = new Uint8Array(analyser.frequencyBinCount)
      const loop = () => {
        if (!analyserRef.current) return
        analyserRef.current.getByteFrequencyData(buf)
        let sum = 0
        for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
        setAudioLevel(Math.sqrt(sum / buf.length) / 255)
        rafRef.current = requestAnimationFrame(loop)
      }
      loop()
    } catch {
      /* level meter is optional — don't crash if AudioContext unavailable */
    }
  }, [])

  const startRecording = useCallback(async () => {
    setError(null)

    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Microphone API not available in this browser')
      setState('error')
      return
    }
    const chosen = pickMimeType()
    if (!chosen) {
      setError('No supported audio format for this browser')
      setState('error')
      return
    }
    mimeRef.current = chosen

    // Always generate a fresh session ID per startRecording() so seq always
    // starts at 0 within a unique session. If persisting, update localStorage
    // so page refreshes show the most recent session ID in the footer.
    // (The old behaviour of reusing the persisted ID across multiple presses
    // caused duplicate seq=0 entries for different chunks in the same session.)
    const sid = newUUID()
    sessionIdRef.current = sid
    setSessionId(sid)
    if (persistRef.current) {
      try { window.localStorage.setItem(LS_SESSION_KEY, sid) } catch { /* noop */ }
    }

    seqRef.current = 0
    queueRef.current = []

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const mr = new MediaRecorder(stream, { mimeType: chosen })
      recorderRef.current = mr

      mr.ondataavailable = (ev) => {
        if (!ev.data || ev.data.size === 0) return
        const seq = seqRef.current++
        queueRef.current.push({
          blob: ev.data,
          seq,
          ts: new Date().toISOString(),
          attempts: 0,
        })
        setChunkCount(seqRef.current)
        // drainQueue is internally serialised — fire-and-forget
        drainQueue()
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mr.onerror = (ev: any) => {
        setError(`MediaRecorder error: ${ev?.error?.message ?? 'unknown'}`)
      }

      mr.start(5000) // 5s timeslice
      setState('recording')
      startTimeRef.current = Date.now()
      setElapsedSeconds(0)
      setChunkCount(0)
      setDropCount(0)
      setLastTranscript('')
      tickRef.current = setInterval(() => {
        setElapsedSeconds(Math.floor((Date.now() - startTimeRef.current) / 1000))
      }, 1000)
      startLevelMeter(stream)
    } catch (e) {
      setError((e as Error).message)
      setState('error')
    }
  }, [drainQueue, startLevelMeter])

  const stopRecording = useCallback(() => {
    setState('stopping')
    if (tickRef.current) {
      clearInterval(tickRef.current)
      tickRef.current = null
    }
    try {
      const mr = recorderRef.current
      if (mr && mr.state !== 'inactive') mr.stop()
    } catch {
      /* noop */
    }
    if (streamRef.current) {
      for (const t of streamRef.current.getTracks()) t.stop()
      streamRef.current = null
    }
    stopLevelMeter()
    // Give MediaRecorder 50ms to fire the final ondataavailable before draining
    setTimeout(() => {
      drainQueue().finally(() => setState('idle'))
    }, 50)
  }, [drainQueue, stopLevelMeter])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (tickRef.current) clearInterval(tickRef.current)
      try {
        const mr = recorderRef.current
        if (mr && mr.state !== 'inactive') mr.stop()
      } catch {
        /* noop */
      }
      if (streamRef.current) {
        for (const t of streamRef.current.getTracks()) t.stop()
      }
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
      if (audioCtxRef.current) audioCtxRef.current.close().catch(() => {})
    }
  }, [])

  return {
    state,
    audioLevel,
    elapsedSeconds,
    chunkCount,
    dropCount,
    lastTranscript,
    error,
    sessionId,
    startRecording,
    stopRecording,
  }
}
