/**
 * /meetings — Meeting recorder + file-upload ingest + diarised transcript viewer.
 *
 * Three ingest paths:
 *   1. Live recording — MediaRecorder chunks streamed during recording
 *   2. File upload    — Drop/pick m4a, mp3, wav, webm, mp4 → POST /api/meetings/upload
 *
 * Five states:
 *   list      → past meetings + "New Recording" + "Upload" buttons
 *   recording → big recorder UI with timer, chunk health dots, stop button
 *   uploading → drag-drop zone + progress bar + transcribing spinner
 *   detail    → selected meeting: transcript + analysis panels
 *
 * Analysis display (shown below transcript when analysis_status='done'):
 *   - One-line summary
 *   - Tabbed: Deep Dive (exec summary + risks) / Actions (P1>P2>P3) / Decisions
 *
 * Authored: fork_mp1utwce_96fdc9 (recorder). Upload + analysis: fork_mp23mycu_029edc.
 */
import {
  useState, useRef, useEffect, useCallback, memo,
} from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Mic, MicOff, Square, Clock, FileText,
  Copy, Download, Check, AlertTriangle, RefreshCw,
  Pencil, X, ChevronLeft, Trash2, Loader2, Upload, Mail, Send,
} from 'lucide-react'
import {
  listMeetings, getMeeting, createMeeting, uploadChunk, stopMeeting,
  retranscribeMeeting, updateSpeakers, reanalyseMeeting, updateMeeting, deleteMeeting, getExportUrl,
  uploadMeetingFile, emailMeetingAnalysis, getMeetingEmailSends,
  type Meeting, type TranscriptSegment, type AnalysisData, type ActionItem, type EmailSend,
} from '@/api/meetings'

// ─── Speaker colours ──────────────────────────────────────────────────────────
const SPEAKER_COLORS: Record<string, string> = {
  A: '#2ECC71', B: '#F59E0B', C: '#10B981',
  D: '#A78BFA', E: '#60A5FA', F: '#F472B6',
}
function speakerColor(code: string | null) {
  if (!code) return '#666666'
  return SPEAKER_COLORS[code] || '#888888'
}

// ─── Formatters ───────────────────────────────────────────────────────────────
function fmtMs(ms: number) {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  return `${m}:${(s % 60).toString().padStart(2, '0')}`
}
function fmtDuration(s: number | null) {
  if (!s) return ''
  return `${Math.floor(s / 60)}m ${s % 60}s`
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleString('en-AU', {
    timeZone: 'Australia/Brisbane',
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  })
}

// ─── Chunk dot ────────────────────────────────────────────────────────────────
type ChunkStatus = 'uploading' | 'ok' | 'error'
function ChunkDot({ status }: { status: ChunkStatus }) {
  return (
    <motion.span
      initial={{ scale: 0 }}
      animate={{ scale: 1 }}
      className="inline-block h-2 w-2 rounded-full"
      style={{
        backgroundColor: status === 'ok' ? '#2ECC71' : status === 'error' ? '#F59E0B' : '#444',
      }}
      title={status}
    />
  )
}

// ─── Recorder ─────────────────────────────────────────────────────────────────
interface RecorderProps {
  onDone: (meetingId: string) => void
  onCancel: () => void
}

function Recorder({ onDone, onCancel }: RecorderProps) {
  const [phase, setPhase] = useState<'idle' | 'recording' | 'stopping' | 'transcribing'>('idle')
  const [elapsed, setElapsed] = useState(0)
  const [chunkStatuses, setChunkStatuses] = useState<ChunkStatus[]>([])
  const [error, setError] = useState<string | null>(null)

  const meetingIdRef = useRef<string | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunkIndexRef = useRef(0)
  const startTimeRef = useRef<number>(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const uploadChunkWithRetry = useCallback(async (meetingId: string, idx: number, blob: Blob) => {
    setChunkStatuses(prev => { const n = [...prev]; n[idx] = 'uploading'; return n })
    try {
      await uploadChunk(meetingId, idx, blob)
      setChunkStatuses(prev => { const n = [...prev]; n[idx] = 'ok'; return n })
    } catch {
      await new Promise(r => setTimeout(r, 2000))
      try {
        await uploadChunk(meetingId, idx, blob)
        setChunkStatuses(prev => { const n = [...prev]; n[idx] = 'ok'; return n })
      } catch {
        setChunkStatuses(prev => { const n = [...prev]; n[idx] = 'error'; return n })
      }
    }
  }, [])

  const startRecording = useCallback(async () => {
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const { id } = await createMeeting()
      meetingIdRef.current = id
      chunkIndexRef.current = 0

      const recorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus' : 'audio/webm',
      })
      recorderRef.current = recorder
      recorder.ondataavailable = async (e) => {
        if (!e.data || e.data.size < 100) return
        const idx = chunkIndexRef.current++
        uploadChunkWithRetry(id, idx, e.data)
      }
      recorder.onerror = (e) => setError(`Recorder error: ${(e as ErrorEvent).message || 'unknown'}`)
      recorder.start(5000)
      setPhase('recording')
      startTimeRef.current = Date.now()
      timerRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000))
      }, 1000)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Microphone access denied')
    }
  }, [uploadChunkWithRetry])

  const stopRecording = useCallback(async () => {
    if (!meetingIdRef.current) return
    setPhase('stopping')
    if (timerRef.current) clearInterval(timerRef.current)

    const recorder = recorderRef.current
    if (recorder && recorder.state !== 'inactive') {
      await new Promise<void>(resolve => {
        recorder.onstop = () => resolve()
        recorder.stop()
      })
      recorder.stream.getTracks().forEach(t => t.stop())
    }

    try {
      await stopMeeting(meetingIdRef.current, elapsed)
      setPhase('transcribing')
      const poll = async () => {
        try {
          const meeting = await getMeeting(meetingIdRef.current!)
          if (meeting.transcription_status === 'done' || meeting.transcription_status === 'error') {
            onDone(meetingIdRef.current!)
            return
          }
        } catch { /* keep polling */ }
        pollRef.current = setTimeout(poll, 3000)
      }
      poll()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Stop failed')
      setPhase('recording')
    }
  }, [elapsed, onDone])

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
      if (pollRef.current) clearTimeout(pollRef.current)
      recorderRef.current?.stream?.getTracks().forEach(t => t.stop())
    }
  }, [])

  const elapsedStr = `${Math.floor(elapsed / 60)}:${(elapsed % 60).toString().padStart(2, '0')}`

  if (phase === 'idle') {
    return (
      <div className="flex flex-col items-center gap-6 py-12">
        <motion.button
          whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.97 }}
          onClick={startRecording}
          className="flex h-24 w-24 items-center justify-center rounded-full"
          style={{ background: 'rgba(27,122,61,0.15)', border: '2px solid rgba(46,204,113,0.4)' }}
        >
          <Mic className="h-10 w-10 text-primary-container" />
        </motion.button>
        <p className="text-sm text-on-surface-muted">Tap to start recording</p>
        {error && <p className="text-xs text-error">{error}</p>}
        <button onClick={onCancel} className="text-xs text-on-surface-muted hover:text-on-surface">Cancel</button>
      </div>
    )
  }

  if (phase === 'transcribing') {
    return (
      <div className="flex flex-col items-center gap-4 py-12">
        <Loader2 className="h-10 w-10 animate-spin text-primary-container" />
        <p className="text-sm text-on-surface-variant">Transcribing audio...</p>
        <p className="text-xs text-on-surface-muted">30-90 seconds depending on length</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center gap-5 py-8">
      <div className="flex items-center gap-2">
        <motion.span
          animate={{ opacity: [1, 0.3, 1] }}
          transition={{ repeat: Infinity, duration: 1.2 }}
          className="h-2 w-2 rounded-full bg-error"
        />
        <span className="text-xs font-medium tracking-widest text-error uppercase">Recording</span>
      </div>
      <div className="font-mono text-4xl font-light text-on-surface">{elapsedStr}</div>
      <div className="flex flex-wrap justify-center gap-1 max-w-xs min-h-4">
        {chunkStatuses.map((s, i) => <ChunkDot key={i} status={s} />)}
      </div>
      {chunkStatuses.some(s => s === 'error') && (
        <p className="text-xs text-tertiary-container text-center max-w-xs">
          Some chunks had upload errors. Transcript may have small gaps.
        </p>
      )}
      <motion.button
        whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.97 }}
        onClick={stopRecording}
        disabled={phase === 'stopping'}
        className="flex h-16 w-16 items-center justify-center rounded-full"
        style={{ background: 'rgba(220,38,38,0.15)', border: '2px solid rgba(220,38,38,0.5)' }}
      >
        {phase === 'stopping'
          ? <Loader2 className="h-6 w-6 animate-spin text-error" />
          : <Square className="h-6 w-6 text-error" fill="currentColor" />}
      </motion.button>
      <p className="text-xs text-on-surface-muted">Tap to stop</p>
    </div>
  )
}

// ─── File Uploader ────────────────────────────────────────────────────────────
interface FileUploaderProps {
  onDone: (meetingId: string) => void
  onCancel: () => void
}

function FileUploader({ onDone, onCancel }: FileUploaderProps) {
  const [phase, setPhase] = useState<'idle' | 'uploading' | 'transcribing'>('idle')
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [filename, setFilename] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => { if (pollRef.current) clearTimeout(pollRef.current) }, [])

  const processFile = useCallback(async (file: File) => {
    const ACCEPTED_EXTS = ['mp3', 'm4a', 'm4b', 'wav', 'ogg', 'webm', 'mp4']
    const ext = file.name.split('.').pop()?.toLowerCase() || ''
    const okMime = file.type.startsWith('audio/') || file.type === 'video/mp4'
    if (!okMime && !ACCEPTED_EXTS.includes(ext)) {
      setError(`Unsupported format: ${file.type || ext}. Use mp3, m4a, wav, webm, or mp4.`)
      return
    }

    const titleFromName = file.name
      .replace(/\.[^.]+$/, '')
      .replace(/[-_]+/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase())
      .slice(0, 120)

    setFilename(file.name)
    setPhase('uploading')
    setProgress(0)
    setError(null)

    try {
      const result = await uploadMeetingFile(file, {
        title: titleFromName,
        onProgress: setProgress,
      })
      setPhase('transcribing')
      const poll = async () => {
        try {
          const meeting = await getMeeting(result.id)
          if (meeting.transcription_status === 'done' || meeting.transcription_status === 'error') {
            onDone(result.id)
            return
          }
        } catch { /* transient error, keep polling */ }
        pollRef.current = setTimeout(poll, 5000)
      }
      poll()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Upload failed')
      setPhase('idle')
    }
  }, [onDone])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) processFile(file)
  }, [processFile])

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) processFile(file)
    e.target.value = ''
  }, [processFile])

  if (phase === 'uploading') {
    return (
      <div className="flex flex-col items-center gap-5 py-10 px-4">
        <Upload className="h-8 w-8 text-primary-container opacity-60" />
        <div className="w-full max-w-xs">
          <div className="mb-2 flex justify-between text-xs">
            <span className="truncate max-w-[180px] text-on-surface-muted">{filename}</span>
            <span className="text-primary-container font-medium">{progress}%</span>
          </div>
          <div className="h-1.5 w-full rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)' }}>
            <motion.div
              className="h-full rounded-full"
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.3 }}
              style={{ background: 'rgba(46,204,113,0.8)' }}
            />
          </div>
        </div>
        <p className="text-xs text-on-surface-muted">Uploading to storage...</p>
      </div>
    )
  }

  if (phase === 'transcribing') {
    return (
      <div className="flex flex-col items-center gap-4 py-12">
        <Loader2 className="h-10 w-10 animate-spin text-primary-container" />
        <p className="text-sm text-on-surface-variant">Transcribing...</p>
        <p className="text-xs text-on-surface-muted">May take a few minutes for long recordings</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center gap-4 py-8 px-4">
      <input
        ref={fileInputRef}
        type="file"
        accept=".mp3,.m4a,.m4b,.wav,.ogg,.webm,.mp4,audio/*"
        className="hidden"
        onChange={handleFileChange}
      />
      <div
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className="flex flex-col items-center gap-3 w-full max-w-xs rounded-xl px-6 py-8 cursor-pointer transition-all"
        style={{
          background: isDragging ? 'rgba(46,204,113,0.06)' : 'rgba(255,255,255,0.03)',
          border: `2px dashed ${isDragging ? 'rgba(46,204,113,0.5)' : 'rgba(255,255,255,0.12)'}`,
        }}
      >
        <Upload
          className="h-8 w-8 transition-colors"
          style={{ color: isDragging ? '#2ECC71' : '#666' }}
        />
        <div className="text-center">
          <p className="text-sm text-on-surface-variant">Drop audio file here</p>
          <p className="text-xs text-on-surface-muted mt-1">or click to browse</p>
        </div>
        <p className="text-xs text-on-surface-muted opacity-60">mp3 · m4a · wav · webm · mp4</p>
      </div>
      {error && (
        <p className="text-xs text-error text-center max-w-xs leading-relaxed">{error}</p>
      )}
      <button onClick={onCancel} className="text-xs text-on-surface-muted hover:text-on-surface">Cancel</button>
    </div>
  )
}

// ─── Analysis view ────────────────────────────────────────────────────────────
function PriorityBadge({ p }: { p: 'P1' | 'P2' | 'P3' }) {
  const colors = { P1: '#DC2626', P2: '#F59E0B', P3: '#6B7280' }
  return (
    <span
      className="text-xs font-mono font-bold px-1.5 py-0.5 rounded flex-shrink-0"
      style={{ background: `${colors[p]}20`, color: colors[p] }}
    >{p}</span>
  )
}

function AnalysisView({ analysis, actionItems }: { analysis: AnalysisData; actionItems: ActionItem[] }) {
  const [section, setSection] = useState<'summary' | 'actions' | 'decisions'>('summary')
  // Guard: action_items_json was historically stored double-encoded (JSONB string, not array).
  // DB rows are now repaired but guard defensively in case of any future edge case.
  const safeItems = Array.isArray(actionItems) ? actionItems : []
  const p1 = safeItems.filter(a => a.priority === 'P1')
  const p2 = safeItems.filter(a => a.priority === 'P2')
  const p3 = safeItems.filter(a => a.priority === 'P3')
  const orderedItems = [...p1, ...p2, ...p3]

  return (
    <div className="flex flex-col gap-4 pt-5" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
      {/* One-line summary */}
      <div
        className="rounded-xl px-4 py-3"
        style={{ background: 'rgba(46,204,113,0.05)', border: '1px solid rgba(46,204,113,0.12)' }}
      >
        <p className="text-xs font-semibold text-primary-container uppercase tracking-wider mb-1">Analysis</p>
        <p className="text-sm text-on-surface font-medium leading-snug">{analysis.one_line_summary}</p>
      </div>

      {/* Section tabs */}
      <div className="flex gap-1.5 flex-wrap">
        {(['summary', 'actions', 'decisions'] as const).map(s => (
          <button
            key={s}
            onClick={() => setSection(s)}
            className="px-3 py-1 rounded-lg text-xs capitalize transition-colors"
            style={{
              background: section === s ? 'rgba(46,204,113,0.12)' : 'rgba(255,255,255,0.03)',
              color: section === s ? '#2ECC71' : '#777',
              border: `1px solid ${section === s ? 'rgba(46,204,113,0.3)' : 'rgba(255,255,255,0.07)'}`,
            }}
          >
            {s === 'actions'
              ? `Actions (${actionItems.length})`
              : s === 'decisions'
              ? `Decisions (${analysis.key_decisions?.length || 0})`
              : 'Deep Dive'}
          </button>
        ))}
      </div>

      {/* Deep dive: exec summary + risks */}
      {section === 'summary' && (
        <div className="flex flex-col gap-3">
          {(analysis.executive_summary || '')
            .split(/\n\n+/)
            .filter(Boolean)
            .map((p, i) => (
              <p key={i} className="text-sm leading-relaxed text-on-surface-variant">{p}</p>
            ))}
          {analysis.risks_red_flags?.length > 0 && (
            <div className="mt-1">
              <p className="text-xs font-semibold text-error mb-2 uppercase tracking-wider">Risks</p>
              <div className="flex flex-col gap-2">
                {analysis.risks_red_flags.map((r, i) => (
                  <div key={i} className="flex gap-2 text-xs">
                    <span
                      className="mt-0.5 flex-shrink-0 font-bold"
                      style={{ color: r.severity === 'high' ? '#DC2626' : r.severity === 'medium' ? '#F59E0B' : '#6B7280' }}
                    >●</span>
                    <span className="text-on-surface-variant leading-relaxed">
                      <span className="font-medium text-on-surface">{r.risk}</span>
                      {r.context ? ` - ${r.context}` : ''}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {analysis.strategic_implications?.length > 0 && (
            <div className="mt-1">
              <p className="text-xs font-semibold text-on-surface-muted mb-2 uppercase tracking-wider">Strategic implications</p>
              <div className="flex flex-col gap-1.5">
                {analysis.strategic_implications.map((si, i) => (
                  <div key={i} className="flex gap-2 text-xs">
                    <span className="text-on-surface-muted mt-0.5 flex-shrink-0">→</span>
                    <span className="text-on-surface-variant leading-relaxed">
                      {si.implication}
                      <span className="ml-2 opacity-50">({si.timeframe})</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Action items */}
      {section === 'actions' && (
        <div className="flex flex-col gap-2.5">
          {orderedItems.length === 0 && (
            <p className="text-xs text-on-surface-muted">No action items extracted.</p>
          )}
          {orderedItems.map((item) => (
            <div
              key={item.id}
              className="rounded-lg px-3 py-2.5"
              style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
            >
              <div className="flex items-start gap-2 mb-1">
                <PriorityBadge p={item.priority} />
                <p className="text-xs text-on-surface font-medium leading-snug flex-1">{item.action}</p>
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-on-surface-muted mt-1">
                {item.owner && item.owner !== 'TBD' && (
                  <span>Owner: <span className="text-on-surface-variant">{item.owner}</span></span>
                )}
                {item.due && item.due !== 'TBD' && (
                  <span>Due: <span className="text-on-surface-variant">{item.due}</span></span>
                )}
                {item.source === 'implicit' && <span className="opacity-50">implicit</span>}
              </div>
              {item.context && (
                <p className="text-xs text-on-surface-muted mt-1.5 leading-relaxed">{item.context}</p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Key decisions */}
      {section === 'decisions' && (
        <div className="flex flex-col gap-2.5">
          {(!analysis.key_decisions || analysis.key_decisions.length === 0) && (
            <p className="text-xs text-on-surface-muted">No key decisions extracted.</p>
          )}
          {analysis.key_decisions?.map((d, i) => (
            <div
              key={i}
              className="rounded-lg px-3 py-2.5"
              style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
            >
              <p className="text-xs text-on-surface font-medium leading-snug">{d.decision}</p>
              {d.rationale && (
                <p className="text-xs text-on-surface-muted mt-1 leading-relaxed">{d.rationale}</p>
              )}
              <div className="flex gap-3 text-xs text-on-surface-muted mt-1.5">
                {d.owner && <span>Owner: <span className="text-on-surface-variant">{d.owner}</span></span>}
                {d.timestamp && <span>{d.timestamp}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Attendees input ──────────────────────────────────────────────────────────
// Free-text list of who was in the meeting. Saved on blur (or Enter). The
// analysis prompt passes this to Claude so it can attribute commitments and
// decisions to the actual people, not "Speaker A".
function AttendeesInput({
  initial, saving, onSave,
}: { initial: string; saving: boolean; onSave: (value: string) => void }) {
  const [value, setValue] = useState(initial)
  // Keep local state in sync if the meeting refetches with a different value
  useEffect(() => { setValue(initial) }, [initial])

  const commit = () => {
    const trimmed = value.trim()
    if (trimmed === (initial || '').trim()) return
    onSave(trimmed)
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[10px] text-on-surface-muted uppercase tracking-wider">
        Who was in this meeting
      </label>
      <input
        type="text"
        value={value}
        onChange={e => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') { e.currentTarget.blur() } }}
        placeholder="e.g. Richard, Kurt, Meg, Angelica, Tate"
        className="w-full rounded-lg bg-surface-container-high px-3 py-2 text-xs text-on-surface placeholder:text-on-surface-muted outline-none"
        style={{ border: '1px solid rgba(255,255,255,0.06)' }}
        maxLength={1000}
        disabled={saving}
      />
    </div>
  )
}

// ─── Speaker label (editable) ─────────────────────────────────────────────────
function SpeakerLabel({
  code, names, onRename,
}: { code: string | null; names: Record<string, string>; onRename: (code: string, name: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  if (!code) return null
  const display = names[code] || `Speaker ${code}`
  const color = speakerColor(code)

  if (editing) {
    const save = () => { if (draft.trim()) onRename(code, draft.trim()); setEditing(false) }
    return (
      <form
        onSubmit={e => { e.preventDefault(); save() }}
        className="inline-flex items-center gap-1"
      >
        <input
          value={draft} onChange={e => setDraft(e.target.value)} autoFocus
          className="w-28 rounded bg-surface-container-high px-2 py-0.5 text-xs text-on-surface outline-none"
          onKeyDown={e => { if (e.key === 'Escape') setEditing(false) }}
          maxLength={40}
        />
        <button
          type="submit"
          onMouseDown={e => e.preventDefault()}
          className="text-primary-container"
        ><Check className="h-3 w-3" /></button>
        <button
          type="button"
          onMouseDown={e => e.preventDefault()}
          onClick={() => setEditing(false)}
          className="text-on-surface-muted"
        ><X className="h-3 w-3" /></button>
      </form>
    )
  }

  return (
    <button
      onClick={() => { setDraft(names[code] || `Speaker ${code}`); setEditing(true) }}
      className="inline-flex items-center gap-1 text-xs font-semibold hover:opacity-80"
      style={{ color }}
      title="Click to rename"
    >
      {display}
      <Pencil className="h-2.5 w-2.5 opacity-50" />
    </button>
  )
}

// ─── Transcript display ───────────────────────────────────────────────────────
const TranscriptView = memo(function TranscriptView({
  meeting, onSpeakerRename,
}: { meeting: Meeting; onSpeakerRename: (code: string, name: string) => void }) {
  const [copied, setCopied] = useState(false)
  const transcript = meeting.transcript_json
  const speakerNames = meeting.speaker_names || {}

  const copyText = () => {
    navigator.clipboard.writeText(meeting.transcript_text || '').then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={copyText}
          className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs"
          style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}
        >
          {copied ? <Check className="h-3.5 w-3.5 text-primary-container" /> : <Copy className="h-3.5 w-3.5 text-on-surface-muted" />}
          <span className="text-on-surface-variant">{copied ? 'Copied' : 'Copy'}</span>
        </button>
        <a
          href={getExportUrl(meeting.id, 'md')} download
          className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs"
          style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}
        >
          <Download className="h-3.5 w-3.5 text-on-surface-muted" />
          <span className="text-on-surface-variant">Export .md</span>
        </a>
      </div>

      {meeting.transcription_status === 'done' && !meeting.transcript_diarised && (
        <div
          className="rounded-lg px-3 py-2 text-xs text-tertiary-container"
          style={{ background: 'rgba(217,119,6,0.08)', border: '1px solid rgba(217,119,6,0.2)' }}
        >
          {meeting.transcript_engine === 'deepgram'
            ? 'Deepgram ran but returned no speaker boundaries — likely a short or single-speaker recording.'
            : 'Speaker separation requires Deepgram. This recording used Whisper as fallback.'}
        </div>
      )}

      {transcript?.diarised && transcript.paragraphs?.length > 0 ? (
        <div className="flex flex-col gap-5">
          {transcript.paragraphs.map((seg, i) => (
            <ScriptLine key={i} seg={seg} names={speakerNames} onRename={onSpeakerRename} />
          ))}
        </div>
      ) : transcript?.paragraphs?.length ? (
        <div className="flex flex-col gap-4">
          {transcript.paragraphs.map((seg, i) => (
            <p key={i} className="text-sm leading-relaxed text-on-surface-variant">{seg.text}</p>
          ))}
        </div>
      ) : (
        <p className="text-sm leading-relaxed text-on-surface-variant whitespace-pre-wrap">
          {meeting.transcript_text || '(no transcript)'}
        </p>
      )}
    </div>
  )
})

function ScriptLine({
  seg, names, onRename,
}: { seg: TranscriptSegment; names: Record<string, string>; onRename: (code: string, name: string) => void }) {
  const color = speakerColor(seg.speaker)
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <SpeakerLabel code={seg.speaker} names={names} onRename={onRename} />
        {(seg.start_ms > 0 || seg.end_ms > 0) && (
          <span className="text-xs text-on-surface-muted">
            {fmtMs(seg.start_ms)} - {fmtMs(seg.end_ms)}
          </span>
        )}
      </div>
      <p
        className="pl-3 text-sm leading-relaxed text-on-surface-variant"
        style={{ borderLeft: `2px solid ${color}40` }}
      >{seg.text}</p>
    </div>
  )
}

// ─── Meeting list item ────────────────────────────────────────────────────────
function MeetingRow({ meeting, selected, onClick }: { meeting: Meeting; selected: boolean; onClick: () => void }) {
  const preview = meeting.transcript_text?.slice(0, 80) || ''

  // Status dot reflects transcription first, then analysis
  const ts = meeting.transcription_status
  const as = meeting.analysis_status
  const dotColor =
    ts === 'error' ? '#DC2626' :
    ts === 'done' && as === 'error' ? '#F59E0B' :
    ts === 'done' && as === 'done' ? '#2ECC71' :
    ts === 'done' ? '#60A5FA' :
    (ts === 'processing' || ts === 'retrying') ? '#F59E0B' :
    '#555'

  return (
    <button
      onClick={onClick}
      className="w-full rounded-xl px-4 py-3 text-left transition-colors"
      style={{
        background: selected ? 'rgba(27,122,61,0.12)' : 'rgba(255,255,255,0.03)',
        border: `1px solid ${selected ? 'rgba(46,204,113,0.25)' : 'rgba(255,255,255,0.06)'}`,
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-on-surface truncate">{meeting.title || fmtDate(meeting.started_at)}</span>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {meeting.audio_source === 'upload' && (
            <span title="Uploaded file"><Upload className="h-2.5 w-2.5 text-on-surface-muted opacity-50" /></span>
          )}
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: dotColor }} />
        </div>
      </div>
      <div className="mt-1 flex items-center gap-2 text-xs text-on-surface-muted">
        <Clock className="h-3 w-3" />
        <span>{meeting.duration_seconds ? fmtDuration(meeting.duration_seconds) : fmtDate(meeting.started_at)}</span>
      </div>
      {preview && (
        <p className="mt-1.5 text-xs text-on-surface-muted line-clamp-2 leading-relaxed">{preview}</p>
      )}
    </button>
  )
}

// ─── Meeting detail panel ─────────────────────────────────────────────────────
function MeetingDetail({ meetingId, onBack }: { meetingId: string; onBack: () => void }) {
  const queryClient = useQueryClient()

  const { data: meeting, isLoading, isError } = useQuery({
    queryKey: ['meeting', meetingId],
    queryFn: () => getMeeting(meetingId),
    refetchInterval: (data) => {
      const d = data?.state?.data
      const ts = d?.transcription_status
      const as = d?.analysis_status
      // Poll during transcription
      if (ts === 'processing' || ts === 'pending' || ts === 'retrying') return 3000
      // Poll during analysis (slower cadence - Claude call takes time)
      if (ts === 'done' && (as === 'processing' || as === 'pending')) return 5000
      return false
    },
  })

  const speakerMutation = useMutation({
    mutationFn: ({ code, name }: { code: string; name: string }) =>
      updateSpeakers(meetingId, { ...(meeting?.speaker_names || {}), [code]: name }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['meeting', meetingId] }),
  })

  const retranscribeMutation = useMutation({
    mutationFn: () => retranscribeMeeting(meetingId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['meeting', meetingId] }),
  })

  const reanalyseMutation = useMutation({
    mutationFn: () => reanalyseMeeting(meetingId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['meeting', meetingId] }),
  })

  const attendeesMutation = useMutation({
    mutationFn: (attendees: string) => updateMeeting(meetingId, { attendees: attendees || null }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['meeting', meetingId] }),
  })

  const deleteMutation = useMutation({
    mutationFn: () => deleteMeeting(meetingId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['meetings'] })
      onBack()
    },
  })

  // ── Email state ──────────────────────────────────────────────────────────────
  const [emailOpen, setEmailOpen] = useState(false)
  const [emailTo, setEmailTo] = useState('')
  const [emailSubject, setEmailSubject] = useState('')
  const [emailNote, setEmailNote] = useState('')
  const [emailSending, setEmailSending] = useState(false)
  const [emailError, setEmailError] = useState<string | null>(null)
  const [emailSuccess, setEmailSuccess] = useState<string | null>(null)
  const [emailSends, setEmailSends] = useState<EmailSend[]>([])
  const [sendsLoaded, setSendsLoaded] = useState(false)

  const openEmailModal = async (meeting: Meeting) => {
    setEmailTo('')
    setEmailSubject(`Meeting analysis: ${meeting.title || fmtDate(meeting.started_at)}`)
    setEmailNote('')
    setEmailError(null)
    setEmailSuccess(null)
    setEmailOpen(true)
    // Load send history in the background
    try {
      const { sends } = await getMeetingEmailSends(meetingId)
      setEmailSends(sends)
      setSendsLoaded(true)
    } catch { /* non-critical */ }
  }

  const handleSendEmail = async () => {
    if (!emailTo.trim()) { setEmailError('Enter at least one recipient'); return }
    setEmailSending(true)
    setEmailError(null)
    setEmailSuccess(null)
    try {
      const result = await emailMeetingAnalysis(meetingId, {
        to: emailTo,
        subject: emailSubject || undefined,
        note: emailNote || undefined,
      })
      setEmailSuccess(`Sent to ${result.sent_to.join(', ')}`)
      setEmailTo('')
      setEmailNote('')
      // Refresh send history
      const { sends } = await getMeetingEmailSends(meetingId)
      setEmailSends(sends)
    } catch (e) {
      setEmailError((e as Error).message || 'Send failed')
    } finally {
      setEmailSending(false)
    }
  }

  if (isLoading) return (
    <div className="flex items-center justify-center py-16">
      <Loader2 className="h-6 w-6 animate-spin text-on-surface-muted" />
    </div>
  )

  if (isError || !meeting) return (
    <div className="py-8 text-center text-sm text-error">Failed to load meeting.</div>
  )

  const isTranscribing = ['processing', 'pending', 'retrying'].includes(meeting.transcription_status)
  const isTranscriptError = meeting.transcription_status === 'error'
  const isAnalysing = meeting.transcription_status === 'done' && meeting.analysis_status === 'processing'

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="text-on-surface-muted hover:text-on-surface">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-on-surface truncate">
            {meeting.title || fmtDate(meeting.started_at)}
          </p>
          <p className="text-xs text-on-surface-muted">
            {meeting.duration_seconds ? fmtDuration(meeting.duration_seconds) : fmtDate(meeting.started_at)}
            {meeting.transcript_engine && ` · ${meeting.transcript_engine}`}
            {meeting.transcript_diarised && ' · diarised'}
            {meeting.audio_source === 'upload' && ' · uploaded'}
          </p>
        </div>
        <button
          onClick={() => { if (confirm('Delete this meeting?')) deleteMutation.mutate() }}
          className="text-on-surface-muted hover:text-error"
          title="Delete"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      {/* Attendees - free-text list of who was in the meeting.
          Passed to Claude so it can attribute commitments to the right people. */}
      <AttendeesInput
        initial={meeting.attendees || ''}
        saving={attendeesMutation.isPending}
        onSave={(value) => attendeesMutation.mutate(value)}
      />

      {/* Transcription in-progress */}
      {isTranscribing && (
        <div
          className="flex items-center gap-2 rounded-lg px-3 py-2"
          style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)' }}
        >
          <Loader2 className="h-4 w-4 animate-spin text-tertiary-container" />
          <span className="text-xs text-tertiary-container">Transcribing...</span>
        </div>
      )}

      {/* Transcription error */}
      {isTranscriptError && (
        <div
          className="flex items-center justify-between rounded-lg px-3 py-2"
          style={{ background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)' }}
        >
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-error" />
            <span className="text-xs text-error">Transcription failed</span>
          </div>
          <button
            onClick={() => retranscribeMutation.mutate()}
            disabled={retranscribeMutation.isPending}
            className="flex items-center gap-1 text-xs text-on-surface-variant hover:text-on-surface"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${retranscribeMutation.isPending ? 'animate-spin' : ''}`} />
            Retry
          </button>
        </div>
      )}

      {/* Transcript */}
      {meeting.transcription_status === 'done' && (
        <TranscriptView
          meeting={meeting}
          onSpeakerRename={(code, name) => speakerMutation.mutate({ code, name })}
        />
      )}

      {/* Analysis in-progress */}
      {isAnalysing && (
        <div
          className="flex items-center gap-2 rounded-lg px-3 py-2"
          style={{ background: 'rgba(46,204,113,0.05)', border: '1px solid rgba(46,204,113,0.15)' }}
        >
          <Loader2 className="h-4 w-4 animate-spin text-primary-container" />
          <span className="text-xs text-primary-container">Analysing meeting...</span>
        </div>
      )}

      {/* Analysis result */}
      {meeting.transcription_status === 'done' && meeting.analysis_status === 'done' && meeting.analysis_json && (
        <AnalysisView
          analysis={meeting.analysis_json}
          actionItems={Array.isArray(meeting.action_items_json) ? meeting.action_items_json : []}
        />
      )}

      {/* Analysis action buttons - visible when analysis is ready */}
      {meeting.analysis_status === 'done' && meeting.analysis_json && (
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => openEmailModal(meeting)}
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs transition-colors"
            style={{
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
              color: '#999',
            }}
          >
            <Mail className="h-3.5 w-3.5" />
            Email this analysis
          </button>
          {(Object.keys(meeting.speaker_names || {}).length > 0 || meeting.attendees) && (
            <button
              onClick={() => reanalyseMutation.mutate()}
              disabled={reanalyseMutation.isPending}
              className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs transition-colors disabled:opacity-50"
              style={{
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.08)',
                color: '#999',
              }}
              title="Re-run analysis with the current speaker names so owners reflect who actually said what"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${reanalyseMutation.isPending ? 'animate-spin' : ''}`} />
              {reanalyseMutation.isPending ? 'Queuing...' : 'Re-run analysis with current speaker names'}
            </button>
          )}
        </div>
      )}

      {/* Email modal */}
      {emailOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center"
          style={{ background: 'rgba(0,0,0,0.7)' }}
          onClick={(e) => { if (e.target === e.currentTarget) setEmailOpen(false) }}
        >
          <div
            className="w-full max-w-md rounded-2xl p-5 flex flex-col gap-4"
            style={{ background: '#161616', border: '1px solid rgba(255,255,255,0.1)' }}
          >
            {/* Modal header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Mail className="h-4 w-4 text-primary-container" />
                <span className="text-sm font-medium text-on-surface">Email analysis</span>
              </div>
              <button onClick={() => setEmailOpen(false)} className="text-on-surface-muted hover:text-on-surface">
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* To field */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-on-surface-muted uppercase tracking-wider">To</label>
              <input
                type="email"
                value={emailTo}
                onChange={(e) => setEmailTo(e.target.value)}
                placeholder="name@example.com (comma-separate for multiple)"
                className="rounded-lg px-3 py-2 text-sm text-on-surface placeholder:text-on-surface-muted outline-none"
                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}
                autoFocus
              />
            </div>

            {/* Subject field */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-on-surface-muted uppercase tracking-wider">Subject</label>
              <input
                type="text"
                value={emailSubject}
                onChange={(e) => setEmailSubject(e.target.value)}
                className="rounded-lg px-3 py-2 text-sm text-on-surface placeholder:text-on-surface-muted outline-none"
                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}
              />
            </div>

            {/* Note field */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-on-surface-muted uppercase tracking-wider">Note <span className="normal-case opacity-50">(optional - prepended to email)</span></label>
              <textarea
                value={emailNote}
                onChange={(e) => setEmailNote(e.target.value)}
                rows={3}
                placeholder="Add a note to the recipient..."
                className="rounded-lg px-3 py-2 text-sm text-on-surface placeholder:text-on-surface-muted outline-none resize-none"
                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}
              />
            </div>

            {/* What's included note */}
            <p className="text-xs text-on-surface-muted opacity-60">
              Sends: summary, action items, decisions, deep dive. Transcript is not included.
            </p>

            {/* Error / success */}
            {emailError && (
              <div className="rounded-lg px-3 py-2 text-xs text-error" style={{ background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)' }}>
                {emailError}
              </div>
            )}
            {emailSuccess && (
              <div className="rounded-lg px-3 py-2 text-xs" style={{ background: 'rgba(46,204,113,0.08)', border: '1px solid rgba(46,204,113,0.2)', color: '#2ECC71' }}>
                {emailSuccess}
              </div>
            )}

            {/* Send button */}
            <button
              onClick={handleSendEmail}
              disabled={emailSending || !emailTo.trim()}
              className="flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-medium transition-colors disabled:opacity-40"
              style={{ background: emailSending ? 'rgba(46,204,113,0.15)' : 'rgba(46,204,113,0.2)', color: '#2ECC71', border: '1px solid rgba(46,204,113,0.3)' }}
            >
              {emailSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {emailSending ? 'Sending...' : 'Send'}
            </button>

            {/* Send history */}
            {sendsLoaded && emailSends.length > 0 && (
              <div className="flex flex-col gap-1.5 pt-1" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                <p className="text-xs text-on-surface-muted uppercase tracking-wider">Previously sent</p>
                {emailSends.slice(0, 5).map((s) => (
                  <div key={s.id} className="flex items-center justify-between text-xs text-on-surface-muted">
                    <span className="truncate">{s.sent_to.join(', ')}</span>
                    <span className="flex-shrink-0 ml-2 opacity-50">
                      {new Date(s.sent_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Analysis error */}
      {meeting.transcription_status === 'done' && meeting.analysis_status === 'error' && (
        <div
          className="rounded-lg px-3 py-2 text-xs text-on-surface-muted"
          style={{ background: 'rgba(220,38,38,0.05)', border: '1px solid rgba(220,38,38,0.15)' }}
        >
          <span className="text-error mr-1">Analysis failed.</span>
          {meeting.analysis_error}
        </div>
      )}

      {/* Awaiting transcription API key */}
      {meeting.transcription_status === 'uploaded_awaiting_transcription' && (
        <div className="py-4 text-center text-sm text-on-surface-muted">
          Audio uploaded. Configure an API key to transcribe.
        </div>
      )}
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function MeetingsPage() {
  const { id: routeId } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [mode, setMode] = useState<'list' | 'recording' | 'uploading' | 'detail'>(
    routeId ? 'detail' : 'list',
  )
  const [selectedId, setSelectedId] = useState<string | null>(routeId ?? null)
  const queryClient = useQueryClient()

  // Sync route param → state (back/forward, direct deep-link).
  useEffect(() => {
    if (routeId && routeId !== selectedId) {
      setSelectedId(routeId)
      setMode('detail')
    } else if (!routeId && mode === 'detail') {
      setMode('list')
      setSelectedId(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeId])

  const { data, isLoading } = useQuery({
    queryKey: ['meetings'],
    queryFn: () => listMeetings(30),
    refetchInterval: mode === 'list' ? 15000 : false,
  })

  const meetings = data?.meetings || []

  const handleDone = useCallback((id: string) => {
    queryClient.invalidateQueries({ queryKey: ['meetings'] })
    navigate(`/meetings/${id}`)
  }, [queryClient, navigate])

  const handleSelect = useCallback((id: string) => {
    navigate(`/meetings/${id}`)
  }, [navigate])

  const ingestMode = mode === 'recording' || mode === 'uploading'

  return (
    <div className="flex h-full flex-col overflow-hidden" style={{ color: '#e0e0e0' }}>
      {/* Top bar */}
      <div
        className="flex items-center justify-between px-5 py-4 flex-shrink-0"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}
      >
        <div className="flex items-center gap-2">
          {mode === 'detail' && (
            <button onClick={() => navigate('/meetings')} className="text-on-surface-muted hover:text-on-surface md:hidden">
              <ChevronLeft className="h-5 w-5" />
            </button>
          )}
          <h1 className="text-base font-semibold text-on-surface tracking-tight">Meetings</h1>
          {meetings.length > 0 && mode === 'list' && (
            <span className="text-xs text-on-surface-muted">({data?.total ?? meetings.length})</span>
          )}
        </div>

        {/* Action buttons — hidden only during active recording/uploading */}
        {!ingestMode && (
          <div className="flex items-center gap-2">
            <motion.button
              whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}
              onClick={() => setMode('uploading')}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: '#aaa' }}
            >
              <Upload className="h-3.5 w-3.5" />
              Upload
            </motion.button>
            <motion.button
              whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}
              onClick={() => setMode('recording')}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium"
              style={{ background: 'rgba(27,122,61,0.2)', border: '1px solid rgba(46,204,113,0.3)', color: '#2ECC71' }}
            >
              <Mic className="h-3.5 w-3.5" />
              Record
            </motion.button>
          </div>
        )}
      </div>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* List pane */}
        <div
          className={`flex flex-col overflow-y-auto ${mode === 'detail' ? 'hidden md:flex' : 'flex'} md:w-72 md:flex-shrink-0 w-full`}
          style={{ borderRight: '1px solid rgba(255,255,255,0.06)' }}
        >
          <AnimatePresence mode="wait">
            {ingestMode ? (
              <motion.div
                key={mode}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="px-4"
              >
                {mode === 'recording' ? (
                  <Recorder onDone={handleDone} onCancel={() => setMode('list')} />
                ) : (
                  <FileUploader onDone={handleDone} onCancel={() => setMode('list')} />
                )}
              </motion.div>
            ) : (
              <motion.div
                key="list"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex flex-col gap-2 p-3"
              >
                {isLoading && (
                  <div className="py-8 text-center">
                    <Loader2 className="mx-auto h-5 w-5 animate-spin text-on-surface-muted" />
                  </div>
                )}
                {!isLoading && meetings.length === 0 && (
                  <div className="py-12 text-center">
                    <MicOff className="mx-auto mb-3 h-8 w-8 text-on-surface-muted opacity-40" />
                    <p className="text-sm text-on-surface-muted">No recordings yet.</p>
                    <p className="mt-1 text-xs text-on-surface-muted">Record or upload to start.</p>
                  </div>
                )}
                {meetings.map(m => (
                  <MeetingRow
                    key={m.id}
                    meeting={m}
                    selected={m.id === selectedId}
                    onClick={() => handleSelect(m.id)}
                  />
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Detail pane */}
        <div className={`flex-1 overflow-y-auto p-5 ${mode !== 'detail' ? 'hidden md:block' : ''}`}>
          <AnimatePresence mode="wait">
            {mode === 'detail' && selectedId ? (
              <motion.div
                key={selectedId}
                initial={{ opacity: 0, x: 8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0 }}
              >
                <MeetingDetail meetingId={selectedId} onBack={() => navigate('/meetings')} />
              </motion.div>
            ) : (
              <motion.div
                key="empty"
                initial={{ opacity: 0 }}
                animate={{ opacity: 0.4 }}
                className="flex h-full items-center justify-center"
              >
                <div className="text-center">
                  <FileText className="mx-auto mb-3 h-10 w-10 text-on-surface-muted" />
                  <p className="text-sm text-on-surface-muted">Select a meeting to view its transcript</p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}
