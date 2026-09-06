/**
 * ChatInputPanel - the focused input panel for typing to the OS.
 *
 * Round-5 (fork_mp1sxm2q_898560) — voice integration:
 *   Added MicButton + RecordingBanner inline so Tate can record directly
 *   from the conductor chat without navigating to /voice. Uses the new
 *   useVoiceRecorder() hook (src/hooks/useVoiceRecorder.ts) which shares
 *   the chunk-upload + MediaRecorder logic with the /voice page. Tap-toggle
 *   UX: tap mic to start, tap again (or the inline stop button) to stop.
 *   Backend voiceBuffer drains transcriptions into chat automatically — no
 *   addUserMessage() call needed here.
 *   Visual states: idle (ember mic icon) / recording (pulsing red, banner)
 *   / stopping (dimmed, "processing…") / error (red inline toast).
 *
 * Round-3 bugfix, 2026-05-08, fork_mowu9a3g_f34229:
 *   - Bug 1 (400 "message is required"): switched to canonical sendOSMessage()
 *     which posts { message, mode } matching the backend shape.
 *   - Bug 3 (textarea doesn't auto-grow): useLayoutEffect reset height to
 *     auto → scrollHeight on every value change, capped at 30vh.
 *
 * Round-2 polish, 2026-05-08, fork_mowe5tuh_f2ddd3:
 *   - Real submit button (arrow-in-disc).
 *   - Live "thinking" hairline under the input while OS is streaming.
 *   - Cmd+K affordance.
 *
 * Bottom-anchored, narrow, glassy. Posts to /api/os-session/message.
 */
import React, { useState, useEffect, useLayoutEffect, useRef } from 'react'
import { sendOSMessage, abortOS, uploadAttachment } from '@/api/osSession'
import { useOSSessionStore } from '@/store/osSessionStore'
import { useVoiceRecorder } from '@/hooks/useVoiceRecorder'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface UploadedAttachment {
  url: string
  name: string
  type: string
  size: number
  extracted_text: string
}

interface PendingAttachment {
  localId: string
  name: string
  size: number
  type: string
  status: 'uploading' | 'done' | 'error'
  error?: string
  result?: UploadedAttachment
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`
  return `${(n / (1024 * 1024)).toFixed(1)}MB`
}

function buildEnrichedMessage(text: string, attachments: UploadedAttachment[]): string {
  if (attachments.length === 0) return text
  const blocks = attachments.map((a) => {
    const head = `<attachment name="${a.name}" type="${a.type}" size="${a.size}" url="${a.url}">`
    const body = a.extracted_text
      ? `\n${a.extracted_text}\n`
      : `\n(binary file — fetch from url to inspect)\n`
    return `${head}${body}</attachment>`
  })
  return `${text}\n\n${blocks.join('\n\n')}`.trim()
}

function formatElapsed(secs: number): string {
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

const PLACEHOLDERS = [
  'speak to ecodiaos',
  'what now',
  'next move',
  'tell it',
  'direct',
]

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────

export function ChatInputPanel() {
  const [value, setValue] = useState('')
  const [sending, setSending] = useState(false)
  const [aborting, setAborting] = useState(false)
  const [placeholderIdx, setPlaceholderIdx] = useState(0)
  const [_hasFocused, setHasFocused] = useState(false)
  const [attachments, setAttachments] = useState<PendingAttachment[]>([])
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const isStreaming = useOSSessionStore((s) => s.status === 'streaming')
  const addUserMessage = useOSSessionStore((s) => s.addUserMessage)

  // ── Voice recorder ──────────────────────────────────────────────────────────
  const voiceRecorder = useVoiceRecorder()
  const { startRecording, stopRecording } = voiceRecorder

  const isRecording = voiceRecorder.state === 'recording'
  const isStopping = voiceRecorder.state === 'stopping'

  // ── Abort ───────────────────────────────────────────────────────────────────
  const onAbort = async () => {
    if (aborting) return
    setAborting(true)
    try { await abortOS() } catch {}
    finally { setAborting(false) }
  }

  // Slow placeholder rotation
  useEffect(() => {
    const t = window.setInterval(() => {
      setPlaceholderIdx((i) => (i + 1) % PLACEHOLDERS.length)
    }, 7000)
    return () => window.clearInterval(t)
  }, [])

  // Cmd/Ctrl+K focuses input
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Auto-grow textarea
  useLayoutEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    const max = Math.round(window.innerHeight * 0.30)
    const next = Math.min(el.scrollHeight, max)
    el.style.height = next + 'px'
    el.style.overflowY = el.scrollHeight > max ? 'auto' : 'hidden'
  }, [value])

  const uploadOne = async (file: File) => {
    const localId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    setAttachments((prev) => [
      ...prev,
      { localId, name: file.name, size: file.size, type: file.type || 'application/octet-stream', status: 'uploading' },
    ])
    try {
      const dataUrl = await readFileAsBase64(file)
      const result = await uploadAttachment({
        name: file.name,
        type: file.type || 'application/octet-stream',
        base64: dataUrl,
      })
      setAttachments((prev) =>
        prev.map((a) => (a.localId === localId ? { ...a, status: 'done', result } : a)),
      )
    } catch (err: any) {
      setAttachments((prev) =>
        prev.map((a) =>
          a.localId === localId
            ? { ...a, status: 'error', error: err?.message || 'upload failed' }
            : a,
        ),
      )
    }
  }

  const onFilesSelected = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    const list = Array.from(files)
    if (fileInputRef.current) fileInputRef.current.value = ''
    for (const f of list) {
      void uploadOne(f)
    }
  }

  const removeAttachment = (localId: string) => {
    setAttachments((prev) => prev.filter((a) => a.localId !== localId))
  }

  const uploadsInFlight = attachments.some((a) => a.status === 'uploading')

  const onSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    if (sending || uploadsInFlight) return
    if (!value.trim() && attachments.length === 0) return
    setSending(true)
    const text = value
    const uploaded = attachments
      .filter((a): a is PendingAttachment & { result: UploadedAttachment } => a.status === 'done' && !!a.result)
      .map((a) => a.result)
    const enriched = buildEnrichedMessage(text, uploaded)
    setValue('')
    setAttachments([])
    addUserMessage(enriched)
    try {
      await sendOSMessage(enriched, 'direct')
    } catch {
      setValue(text)
    } finally {
      setSending(false)
    }
  }

  const canSubmit =
    !sending && !uploadsInFlight && (value.trim().length > 0 || attachments.some((a) => a.status === 'done'))

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div
      className="ambient-input w-full"
      style={{
        position: 'relative',
        zIndex: 20,
        background:
          'linear-gradient(180deg, rgba(6,7,10,0) 0%, rgba(6,7,10,0.86) 30%, rgba(6,7,10,0.96) 100%)',
        // Single shared hairline with the chat log above — no gap, no inset box.
        borderTop: '1px solid rgba(212,175,55,0.08)',
        // iOS safe area so the home-indicator never overlaps the input controls.
        paddingBottom: 'env(safe-area-inset-bottom, 0)',
      }}
    >
      <div className="w-full">

        {/* ── Recording Banner ── visible while mic is active ── */}
        <RecordingBanner
          state={voiceRecorder.state}
          elapsed={voiceRecorder.elapsedSeconds}
          lastTranscript={voiceRecorder.lastTranscript}
          audioLevel={voiceRecorder.audioLevel}
          error={voiceRecorder.error}
          onStop={stopRecording}
        />

        {/* ── Input form ── */}
        <form
          onSubmit={onSubmit}
          style={{ position: 'relative' }}
        >
          <div className="relative overflow-hidden"
            style={{
              background: 'linear-gradient(180deg, rgba(15,18,24,0.55) 0%, rgba(8,10,14,0.78) 100%)',
              boxShadow: isStreaming
                ? '0 0 32px rgba(255,178,122,0.18), inset 0 0 18px rgba(255,178,122,0.08)'
                : isRecording
                  ? '0 0 32px rgba(239,68,68,0.14), inset 0 0 18px rgba(239,68,68,0.06)'
                  : '0 0 28px rgba(255,178,122,0.06), inset 0 0 14px rgba(255,178,122,0.04)',
              backdropFilter: 'blur(18px) saturate(1.2)',
              WebkitBackdropFilter: 'blur(18px) saturate(1.2)',
              transition: 'box-shadow 320ms ease-out',
            }}
          >
            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-1.5 px-3 pt-2.5">
                {attachments.map((a) => (
                  <AttachmentChip
                    key={a.localId}
                    attachment={a}
                    onRemove={() => removeAttachment(a.localId)}
                  />
                ))}
              </div>
            )}

            <div className="flex items-end gap-1.5 sm:gap-2 px-2 sm:px-3 py-2.5">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                hidden
                onChange={(e) => onFilesSelected(e.target.files)}
              />
              <AttachButton
                onClick={() => fileInputRef.current?.click()}
                disabled={sending}
              />
              <textarea
                ref={inputRef}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onFocus={() => setHasFocused(true)}
                onKeyDown={(e) => {
                  // IME composition (CJK) — Enter commits the composition, not the form.
                  if (e.nativeEvent.isComposing || e.keyCode === 229) return
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    onSubmit()
                  }
                }}
                placeholder={
                  isRecording
                    ? 'recording voice…'
                    : isStopping
                      ? 'processing…'
                      : PLACEHOLDERS[placeholderIdx]
                }
                rows={1}
                /* font-size 16px on mobile keeps iOS Safari from auto-zooming the
                   viewport when the textarea is focused. */
                className="flex-1 resize-none bg-transparent text-[16px] sm:text-[14px] text-white placeholder:text-white/30 focus:outline-none"
                style={{ minHeight: '24px', maxHeight: '30vh', lineHeight: '1.45' }}
                disabled={sending}
              />
              {isStreaming && <StopButton aborting={aborting} onAbort={onAbort} />}
              <SubmitButton sending={sending} canSubmit={canSubmit} />
              {/* Mic button — tap to record, tap again to stop */}
              <MicButton
                state={voiceRecorder.state}
                onStart={startRecording}
                onStop={stopRecording}
                disabled={sending}
              />
            </div>

            {/* Streaming hairline */}
            <StreamingRibbon active={isStreaming} />
            {/* Recording hairline — red when mic is hot */}
            <RecordingRibbon active={isRecording} />
          </div>

        </form>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Recording Banner
// ─────────────────────────────────────────────────────────────────────────────

interface RecordingBannerProps {
  state: 'idle' | 'recording' | 'stopping' | 'error'
  elapsed: number
  lastTranscript: string
  audioLevel: number
  error: string | null
  onStop: () => void
}

function RecordingBanner({ state, elapsed, lastTranscript, audioLevel, error, onStop }: RecordingBannerProps) {
  const visible = state === 'recording' || state === 'stopping'
  if (!visible) return null

  const levelPct = Math.min(100, Math.round(audioLevel * 220))

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 12px 6px 10px',
        marginBottom: 4,
        borderRadius: 6,
        background: 'linear-gradient(90deg, rgba(239,68,68,0.10) 0%, rgba(10,12,18,0.80) 100%)',
        border: '1px solid rgba(239,68,68,0.22)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        overflow: 'hidden',
      }}
      role="status"
      aria-label={`Recording: ${formatElapsed(elapsed)}`}
    >
      {/* Pulsing red dot */}
      <span
        aria-hidden
        style={{
          width: 7,
          height: 7,
          borderRadius: '50%',
          background: '#ef4444',
          boxShadow: '0 0 6px rgba(239,68,68,0.8)',
          flexShrink: 0,
          animation: state === 'recording' ? 'ambient-pulse 1.4s ease-in-out infinite' : 'none',
          opacity: state === 'stopping' ? 0.45 : 1,
        }}
      />

      {/* Elapsed time */}
      <span
        style={{
          color: state === 'stopping' ? 'rgba(248,113,113,0.55)' : '#f87171',
          fontFamily: "'JetBrains Mono', ui-monospace, monospace",
          fontSize: 11,
          flexShrink: 0,
          letterSpacing: '0.04em',
        }}
      >
        {formatElapsed(elapsed)}
      </span>

      {/* Last transcript preview */}
      <span
        style={{
          color: 'rgba(255,255,255,0.60)',
          fontSize: 12,
          flex: 1,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          minWidth: 0,
        }}
      >
        {state === 'stopping'
          ? 'processing…'
          : error
            ? <span style={{ color: '#f87171' }}>⚠ {error}</span>
            : lastTranscript || 'listening…'
        }
      </span>

      {/* Audio level mini-bar */}
      {state === 'recording' && (
        <div
          aria-hidden
          style={{
            width: 36,
            height: 3,
            background: 'rgba(255,255,255,0.10)',
            borderRadius: 2,
            flexShrink: 0,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              height: '100%',
              width: `${levelPct}%`,
              background: 'linear-gradient(90deg, #ef4444, #f87171)',
              borderRadius: 2,
              transition: 'width 60ms linear',
            }}
          />
        </div>
      )}

      {/* Stop button */}
      {state === 'recording' && (
        <button
          type="button"
          onClick={onStop}
          aria-label="stop recording"
          title="stop recording"
          style={{
            width: 22,
            height: 22,
            borderRadius: 4,
            border: '1px solid rgba(239,68,68,0.45)',
            background: 'rgba(239,68,68,0.12)',
            color: '#f87171',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            cursor: 'pointer',
            transition: 'all 160ms ease-out',
          }}
        >
          <svg viewBox="0 0 10 10" width="8" height="8" fill="currentColor">
            <rect x="1.5" y="1.5" width="7" height="7" rx="1" />
          </svg>
        </button>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Mic Button
// ─────────────────────────────────────────────────────────────────────────────

interface MicButtonProps {
  state: 'idle' | 'recording' | 'stopping' | 'error'
  onStart: () => Promise<void>
  onStop: () => void
  disabled?: boolean
}

function MicButton({ state, onStart, onStop, disabled }: MicButtonProps) {
  const isRecording = state === 'recording'
  const isStopping = state === 'stopping'
  const isError = state === 'error'
  const isActive = isRecording || isStopping

  const handleClick = () => {
    if (disabled || isStopping) return
    if (isRecording) {
      onStop()
    } else {
      onStart()
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled || isStopping}
      aria-label={isRecording ? 'Stop recording' : 'Start voice recording'}
      title={isRecording ? 'Stop recording' : 'Record voice'}
      style={{
        width: 30,
        height: 30,
        borderRadius: 999,
        border: isActive
          ? '1px solid rgba(239,68,68,0.60)'
          : isError
            ? '1px solid rgba(239,68,68,0.40)'
            : '1px solid rgba(255,255,255,0.10)',
        background: isActive
          ? 'radial-gradient(circle at 50% 40%, rgba(239,68,68,0.30) 0%, rgba(239,68,68,0.04) 70%)'
          : 'transparent',
        color: isActive
          ? '#f87171'
          : isError
            ? 'rgba(239,68,68,0.70)'
            : 'rgba(255,178,122,0.70)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        cursor: disabled || isStopping ? 'default' : 'pointer',
        transition: 'all 200ms ease-out',
        boxShadow: isActive ? '0 0 10px rgba(239,68,68,0.20)' : 'none',
        animation: isRecording ? 'mic-glow 2s ease-in-out infinite' : 'none',
        opacity: isStopping ? 0.50 : 1,
      }}
    >
      {isStopping ? (
        <SpinnerGlyph color="rgba(248,113,113,0.60)" />
      ) : isRecording ? (
        /* Solid mic = recording state */
        <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
          <rect x="5.5" y="2" width="5" height="8" rx="2.5" />
          <path
            d="M3 8a5 5 0 0 0 10 0"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
          <line x1="8" y1="13" x2="8" y2="15" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          <line x1="5.5" y1="15" x2="10.5" y2="15" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      ) : (
        /* Outline mic = idle state */
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor"
          strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="5.5" y="2" width="5" height="8" rx="2.5" />
          <path d="M3 8a5 5 0 0 0 10 0" />
          <line x1="8" y1="13" x2="8" y2="15" />
          <line x1="5.5" y1="15" x2="10.5" y2="15" />
        </svg>
      )}
    </button>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Recording ribbon (red hairline under input when mic is hot)
// ─────────────────────────────────────────────────────────────────────────────

function RecordingRibbon({ active }: { active: boolean }) {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 bottom-0 h-px overflow-hidden"
      style={{ opacity: active ? 1 : 0, transition: 'opacity 240ms ease-out' }}
    >
      <div
        style={{
          height: '1px',
          width: '40%',
          background: 'linear-gradient(90deg, rgba(239,68,68,0) 0%, rgba(239,68,68,0.90) 50%, rgba(239,68,68,0) 100%)',
          animation: 'ambient-ribbon 2.0s linear infinite',
          boxShadow: '0 0 6px rgba(239,68,68,0.65)',
        }}
      />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Existing sub-components (unchanged)
// ─────────────────────────────────────────────────────────────────────────────

function StopButton({ aborting, onAbort }: { aborting: boolean; onAbort: () => void }) {
  return (
    <button
      type="button"
      onClick={onAbort}
      disabled={aborting}
      aria-label="stop turn"
      style={{
        width: 30,
        height: 30,
        borderRadius: 999,
        border: '1px solid rgba(248,113,113,0.50)',
        background: 'radial-gradient(circle at 50% 40%, rgba(248,113,113,0.28) 0%, rgba(248,113,113,0.04) 70%)',
        color: aborting ? 'rgba(248,113,113,0.45)' : '#f87171',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        cursor: aborting ? 'default' : 'pointer',
        transition: 'all 200ms ease-out',
        boxShadow: '0 0 10px rgba(248,113,113,0.18)',
      }}
    >
      {aborting ? <SpinnerGlyph /> : <StopGlyph />}
    </button>
  )
}

function StopGlyph() {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor">
      <rect x="3.5" y="3.5" width="9" height="9" rx="1.5" />
    </svg>
  )
}

function SubmitButton({ sending, canSubmit }: { sending: boolean; canSubmit: boolean }) {
  return (
    <button
      type="submit"
      disabled={!canSubmit}
      aria-label="send message"
      className="group relative flex items-center justify-center"
      style={{
        width: 30,
        height: 30,
        borderRadius: 999,
        border: canSubmit ? '1px solid rgba(255,178,122,0.55)' : '1px solid rgba(255,255,255,0.08)',
        background: canSubmit
          ? 'radial-gradient(circle at 50% 40%, rgba(255,178,122,0.42) 0%, rgba(255,178,122,0.04) 70%)'
          : 'transparent',
        color: canSubmit ? '#ffb27a' : 'rgba(255,255,255,0.18)',
        transition: 'all 200ms ease-out',
        cursor: canSubmit ? 'pointer' : 'default',
        boxShadow: canSubmit ? '0 0 10px rgba(255,178,122,0.22)' : 'none',
      }}
    >
      {sending ? <SpinnerGlyph /> : <ArrowGlyph />}
    </button>
  )
}

function ArrowGlyph() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor"
      strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 13 L8 3" />
      <path d="M3.5 7.5 L8 3 L12.5 7.5" />
    </svg>
  )
}

function SpinnerGlyph({ color }: { color?: string } = {}) {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none"
      stroke={color ?? 'currentColor'}
      strokeWidth="1.6" strokeLinecap="round"
      style={{ animation: 'ambient-spin 0.9s linear infinite' }}>
      <circle cx="8" cy="8" r="5.4" opacity="0.25" />
      <path d="M8 2.6 A5.4 5.4 0 0 1 13.4 8" />
    </svg>
  )
}


function StreamingRibbon({ active }: { active: boolean }) {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 bottom-0 h-px overflow-hidden"
      style={{ opacity: active ? 1 : 0, transition: 'opacity 240ms ease-out' }}
    >
      <div
        style={{
          height: '1px',
          width: '40%',
          background: 'linear-gradient(90deg, rgba(255,178,122,0) 0%, rgba(255,178,122,0.95) 50%, rgba(255,178,122,0) 100%)',
          animation: 'ambient-ribbon 2.4s linear infinite',
          boxShadow: '0 0 6px rgba(255,178,122,0.7)',
        }}
      />
    </div>
  )
}

function AttachButton({ onClick, disabled }: { onClick: () => void; disabled: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label="attach file"
      title="attach file"
      className="flex items-center justify-center flex-shrink-0"
      style={{
        width: 30,
        height: 30,
        borderRadius: 999,
        border: '1px solid rgba(255,255,255,0.10)',
        background: 'transparent',
        color: disabled ? 'rgba(255,255,255,0.18)' : 'rgba(255,178,122,0.85)',
        cursor: disabled ? 'default' : 'pointer',
        transition: 'all 180ms ease-out',
      }}
    >
      <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor"
        strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10.5 4 L5.5 9 a2 2 0 0 0 2.8 2.8 L13 7 a3.5 3.5 0 0 0 -5 -5 L3 7 a5 5 0 0 0 7 7 L14 10" />
      </svg>
    </button>
  )
}

function AttachmentChip({
  attachment,
  onRemove,
}: {
  attachment: PendingAttachment
  onRemove: () => void
}) {
  const isUploading = attachment.status === 'uploading'
  const isError = attachment.status === 'error'
  const result = attachment.result
  const hasExtraction = !!result?.extracted_text
  const borderColor = isError
    ? 'rgba(248,113,113,0.45)'
    : isUploading
    ? 'rgba(255,178,122,0.30)'
    : 'rgba(255,178,122,0.45)'

  return (
    <div
      className="inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-[11px]"
      style={{
        background: 'rgba(255,178,122,0.06)',
        border: `1px solid ${borderColor}`,
        color: isError ? '#f87171' : 'rgba(255,255,255,0.88)',
        fontFamily: "'JetBrains Mono', ui-monospace, monospace",
        letterSpacing: '0.02em',
        maxWidth: 280,
      }}
      title={
        isError
          ? `error: ${attachment.error}`
          : isUploading
          ? 'uploading…'
          : hasExtraction
          ? `${attachment.name} · text extracted`
          : attachment.name
      }
    >
      {isUploading ? (
        <SpinnerGlyph />
      ) : isError ? (
        <span aria-hidden style={{ color: '#f87171' }}>!</span>
      ) : (
        <span
          aria-hidden
          style={{
            width: 6,
            height: 6,
            borderRadius: 999,
            background: hasExtraction ? '#5fe89d' : '#ffb27a',
            boxShadow: `0 0 4px ${hasExtraction ? '#5fe89d' : '#ffb27a'}`,
            display: 'inline-block',
          }}
        />
      )}
      <span className="truncate" style={{ maxWidth: 180 }}>
        {attachment.name}
      </span>
      <span style={{ color: 'rgba(255,255,255,0.4)', flexShrink: 0 }}>
        {formatBytes(attachment.size)}
      </span>
      <button
        type="button"
        onClick={onRemove}
        aria-label="remove attachment"
        style={{
          marginLeft: 2,
          color: 'rgba(255,255,255,0.45)',
          cursor: 'pointer',
          padding: 0,
          background: 'transparent',
          border: 'none',
          lineHeight: 1,
        }}
      >
        ×
      </button>
    </div>
  )
}
