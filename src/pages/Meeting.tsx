import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Mic, Square } from 'lucide-react'
import { useAuthStore } from '@/store/authStore'
import { pickMimeType } from '@/hooks/useVoiceRecorder'

/**
 * /meeting - Mobile-first meeting recorder (Phase 1).
 *
 * No auth gate - designed to be opened directly as a phone PWA shortcut.
 * Uses the token from authStore if available (set by a prior logged-in
 * session on the same device) but does NOT redirect to /login if absent.
 *
 * Flow:
 *   Tap Record -> POST /api/meetings (create session) -> MediaRecorder start
 *   Each 30s chunk -> POST /api/meetings/:id/chunk (multipart)
 *   Tap Stop -> POST /api/meetings/:id/stop -> navigate /meetings/:id
 */

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) || '/api'
const CHUNK_INTERVAL_MS = 30_000

type RecordState = 'idle' | 'recording' | 'stopping' | 'error'

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export default function MeetingPage() {
  const navigate = useNavigate()
  const token = useAuthStore((s) => s.token)

  const [recState, setRecState] = useState<RecordState>('idle')
  const [meetingId, setMeetingId] = useState<string | null>(null)
  const [chunkCount, setChunkCount] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [audioLevel, setAudioLevel] = useState(0)

  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const rafRef = useRef<number | null>(null)
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const startTimeRef = useRef(0)
  const chunkIndexRef = useRef(0)
  const meetingIdRef = useRef<string | null>(null)
  const uploadQueueRef = useRef<Promise<void>>(Promise.resolve())

  // Keep meetingId accessible inside MediaRecorder callbacks
  useEffect(() => {
    meetingIdRef.current = meetingId
  }, [meetingId])

  const authHeaders = useCallback((): Record<string, string> => {
    return token ? { Authorization: `Bearer ${token}` } : {}
  }, [token])

  const startLevelMeter = useCallback((stream: MediaStream) => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const Ctx = window.AudioContext || (window as any).webkitAudioContext
      const ctx = new Ctx() as AudioContext
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
      // level meter is optional
    }
  }, [])

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

  const uploadChunk = useCallback(
    async (blob: Blob, chunkIndex: number, mid: string) => {
      const mime = blob.type || 'audio/webm'
      const ext = mime.includes('mp4') ? 'mp4' : mime.includes('ogg') ? 'ogg' : 'webm'
      const fd = new FormData()
      fd.append('chunk', blob, `chunk-${chunkIndex}.${ext}`)
      fd.append('chunkIndex', String(chunkIndex))
      try {
        const res = await fetch(`${API_BASE}/meetings/${mid}/chunk`, {
          method: 'POST',
          headers: authHeaders(),
          body: fd,
        })
        if (!res.ok) {
          setError(`Chunk ${chunkIndex} upload failed (${res.status})`)
        }
      } catch (e) {
        setError(`Chunk ${chunkIndex} upload error: ${(e as Error).message}`)
      }
    },
    [authHeaders],
  )

  const startRecording = useCallback(async () => {
    setError(null)
    setChunkCount(0)
    chunkIndexRef.current = 0
    uploadQueueRef.current = Promise.resolve()

    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Microphone API not available in this browser')
      setRecState('error')
      return
    }
    const mime = pickMimeType()
    if (!mime) {
      setError('No supported audio format for this browser')
      setRecState('error')
      return
    }

    // Create meeting session
    let mid: string
    try {
      const res = await fetch(`${API_BASE}/meetings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({}),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as { id: string; started_at: string }
      mid = data.id
    } catch (e) {
      setError(`Failed to create meeting: ${(e as Error).message}`)
      setRecState('error')
      return
    }

    setMeetingId(mid)
    meetingIdRef.current = mid

    // Start MediaRecorder
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (e) {
      setError(`Microphone access denied: ${(e as Error).message}`)
      setRecState('error')
      return
    }
    streamRef.current = stream
    const mr = new MediaRecorder(stream, { mimeType: mime })
    recorderRef.current = mr

    mr.ondataavailable = (ev) => {
      if (!ev.data || ev.data.size === 0) return
      const idx = chunkIndexRef.current++
      const currentMid = meetingIdRef.current
      if (!currentMid) return
      const blob = ev.data
      // Serialise uploads so chunk order is preserved
      uploadQueueRef.current = uploadQueueRef.current.then(() =>
        uploadChunk(blob, idx, currentMid),
      )
      setChunkCount(chunkIndexRef.current)
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mr.onerror = (ev: any) => {
      setError(`Recorder error: ${ev?.error?.message ?? 'unknown'}`)
    }

    mr.start(CHUNK_INTERVAL_MS)
    setRecState('recording')
    startTimeRef.current = Date.now()
    setElapsed(0)
    tickRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000))
    }, 1000)
    startLevelMeter(stream)
  }, [authHeaders, uploadChunk, startLevelMeter])

  const stopRecording = useCallback(async () => {
    setRecState('stopping')

    if (tickRef.current) {
      clearInterval(tickRef.current)
      tickRef.current = null
    }
    stopLevelMeter()

    const mr = recorderRef.current
    try {
      if (mr && mr.state !== 'inactive') mr.stop()
    } catch {
      // ignore
    }
    if (streamRef.current) {
      for (const t of streamRef.current.getTracks()) t.stop()
      streamRef.current = null
    }

    const mid = meetingIdRef.current
    if (!mid) {
      setRecState('idle')
      return
    }

    // Wait 100ms for final ondataavailable, then drain upload queue
    await new Promise<void>((resolve) => setTimeout(resolve, 100))
    await uploadQueueRef.current

    const durationSeconds = Math.floor((Date.now() - startTimeRef.current) / 1000)
    try {
      const res = await fetch(`${API_BASE}/meetings/${mid}/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ duration_seconds: durationSeconds }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
    } catch (e) {
      // Non-fatal: still navigate to detail page
      setError(`Stop call failed: ${(e as Error).message}`)
    }

    navigate(`/meetings/${mid}`)
  }, [authHeaders, stopLevelMeter, navigate])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (tickRef.current) clearInterval(tickRef.current)
      try {
        const mr = recorderRef.current
        if (mr && mr.state !== 'inactive') mr.stop()
      } catch {
        // ignore
      }
      if (streamRef.current) {
        for (const t of streamRef.current.getTracks()) t.stop()
      }
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
      if (audioCtxRef.current) audioCtxRef.current.close().catch(() => {})
    }
  }, [])

  const recording = recState === 'recording'
  const stopping = recState === 'stopping'
  const levelPct = Math.min(100, Math.round(audioLevel * 200))

  const statusLabel = (() => {
    switch (recState) {
      case 'recording': return `Recording ${formatDuration(elapsed)}`
      case 'stopping': return 'Stopping...'
      case 'error': return error ?? 'Error'
      default: return 'Tap to record'
    }
  })()

  return (
    <div className="min-h-screen w-full bg-black text-white">
      <div className="mx-auto flex min-h-screen w-full max-w-[480px] flex-col px-5 py-8">
        <header className="mb-6 flex items-center justify-between">
          <h1 className="text-lg font-semibold tracking-tight text-white/90">Meeting</h1>
          <a
            href="/meetings"
            className="text-xs text-white/40 hover:text-white/70 transition-colors"
          >
            All meetings
          </a>
        </header>

        {/* Record button */}
        <div className="flex flex-1 flex-col items-center justify-center">
          <motion.button
            type="button"
            disabled={stopping}
            onClick={recording ? () => { void stopRecording() } : () => { void startRecording() }}
            whileTap={{ scale: stopping ? 1 : 0.96 }}
            className={[
              'relative flex items-center justify-center rounded-full',
              'h-[220px] w-[220px] select-none shadow-2xl',
              'transition-colors duration-300',
              stopping
                ? 'cursor-not-allowed bg-zinc-800 ring-2 ring-white/10'
                : recording
                  ? 'bg-gradient-to-br from-red-500 to-red-700 ring-4 ring-red-500/30'
                  : 'bg-gradient-to-br from-zinc-700 to-zinc-900 ring-2 ring-white/10',
            ].join(' ')}
            aria-label={recording ? 'Stop recording' : 'Start recording'}
          >
            {recording ? (
              <Square className="h-20 w-20 text-white" strokeWidth={2.5} />
            ) : (
              <Mic className="h-20 w-20 text-white/85" strokeWidth={2} />
            )}
            {recording && (
              <motion.span
                aria-hidden="true"
                className="absolute inset-0 rounded-full ring-4 ring-red-500/40"
                animate={{ scale: [1, 1.1, 1], opacity: [0.6, 0, 0.6] }}
                transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
              />
            )}
          </motion.button>

          {/* Status */}
          <div className="mt-8 min-h-[1.5rem] text-center text-base text-white/80">
            {statusLabel}
          </div>

          {/* Audio level bar */}
          <div className="mt-4 h-2 w-full max-w-[260px] overflow-hidden rounded-full bg-white/10">
            <motion.div
              className="h-full bg-gradient-to-r from-red-400 via-red-500 to-red-300"
              animate={{ width: `${levelPct}%` }}
              transition={{ duration: 0.05, ease: 'linear' }}
            />
          </div>

          {/* Error */}
          {error && (
            <div className="mt-4 max-w-full break-words rounded-lg bg-red-900/30 px-4 py-2 text-center text-sm text-red-300">
              {error}
            </div>
          )}
        </div>

        {/* Footer stats */}
        <footer className="mt-6 grid grid-cols-2 gap-3 text-[11px] text-white/40">
          <div className="rounded-xl bg-white/5 px-4 py-3">
            <div className="uppercase tracking-wider text-white/30">Chunks uploaded</div>
            <div className="mt-1 font-mono text-2xl font-semibold text-white/60">{chunkCount}</div>
          </div>
          <div className="rounded-xl bg-white/5 px-4 py-3">
            <div className="uppercase tracking-wider text-white/30">Duration</div>
            <div className="mt-1 font-mono text-2xl font-semibold text-white/60">
              {formatDuration(elapsed)}
            </div>
          </div>
        </footer>

        {meetingId && !recording && (
          <div className="mt-3 text-center text-[10px] text-white/25">
            session: {meetingId.slice(0, 8)}
          </div>
        )}
      </div>
    </div>
  )
}
