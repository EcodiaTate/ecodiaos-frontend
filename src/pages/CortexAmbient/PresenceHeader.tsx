/**
 * PresenceHeader — typographic identity + breath of the entity.
 *
 * Round-3, fork_mowtlsvo_95bffd (manager fork_mowtf5s4_82c7f4).
 *
 * Sticky-top wordmark + breath line + alive/thinking/quiet label + AEST
 * clock + tiny audio toggle. Pure CSS keyframes. No 3D, no R3F.
 *
 * Spec §4.1.
 */
import { useEffect, useState } from 'react'
import { AMBIENT_PALETTE } from './palette'

interface PresenceHeaderProps {
  audioEnabled: boolean
  onToggleAudio: () => void
  forkCount: number
  /** Mobile mode shrinks the layout and surfaces rail-toggle buttons. */
  isMobile?: boolean
  onOpenLeftSheet?: () => void
  onOpenRightSheet?: () => void
  forksRunning?: number
  statusUnacked?: number
}

function presenceLabel(forkCount: number): string {
  if (forkCount <= 0) return 'quiet'
  if (forkCount === 1) return 'alive'
  return 'thinking'
}

/** Keyed to fork count: 1 fork = lazy 5s, 5+ forks = brisk 2s. */
function breathPeriodSeconds(forkCount: number): number {
  if (forkCount <= 0) return 5
  if (forkCount >= 5) return 2
  // 1->4.4s, 2->3.8s, 3->3.2s, 4->2.6s
  return 5 - 0.6 * forkCount
}

function formatAEST(now: Date): string {
  // 24h HH:mm in Australia/Brisbane (AEST, no DST). Pad to 2 digits.
  try {
    return new Intl.DateTimeFormat('en-AU', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'Australia/Brisbane',
    }).format(now)
  } catch {
    const h = now.getUTCHours() + 10
    const hh = ((h % 24) + 24) % 24
    return `${String(hh).padStart(2, '0')}:${String(now.getUTCMinutes()).padStart(2, '0')}`
  }
}

export function PresenceHeader({
  audioEnabled,
  onToggleAudio,
  forkCount,
  isMobile = false,
  onOpenLeftSheet,
  onOpenRightSheet,
  forksRunning = 0,
  statusUnacked = 0,
}: PresenceHeaderProps) {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 15000)
    return () => window.clearInterval(t)
  }, [])

  const label = presenceLabel(forkCount)
  const period = breathPeriodSeconds(forkCount)
  const clock = formatAEST(now)

  return (
    <header
      className="ambient-presence-header sticky top-0 z-40"
      style={{
        background: 'rgba(6,7,10,0.92)',
        borderBottom: '1px solid rgba(212,175,55,0.08)',
        backdropFilter: 'blur(12px) saturate(1.1)',
        WebkitBackdropFilter: 'blur(12px) saturate(1.1)',
      }}
    >
      <div
        className="flex items-center px-3"
        style={{ height: isMobile ? 44 : 32, gap: isMobile ? 10 : 16 }}
      >
        {/* Mobile-only left hamburger — opens left rail as a side sheet */}
        {isMobile && onOpenLeftSheet && (
          <button
            type="button"
            onClick={onOpenLeftSheet}
            aria-label="open systems panel"
            style={{
              width: 32, height: 32,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              borderRadius: 6,
              border: '1px solid rgba(255,255,255,0.10)',
              background: 'transparent',
              color: 'rgba(255,255,255,0.65)',
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor"
              strokeWidth="1.6" strokeLinecap="round">
              <line x1="2.5" y1="4" x2="13.5" y2="4" />
              <line x1="2.5" y1="8" x2="13.5" y2="8" />
              <line x1="2.5" y1="12" x2="13.5" y2="12" />
            </svg>
          </button>
        )}

        {/* Left: wordmark + breath line inline */}
        <div className="flex items-center gap-2" style={{ flexShrink: 0 }}>
          <span
            style={{
              color: AMBIENT_PALETTE.coreGlow,
              fontSize: 13,
              fontWeight: 600,
              letterSpacing: '-0.01em',
              fontFamily: "'Inter', system-ui, sans-serif",
              lineHeight: 1,
            }}
          >
            EcodiaOS
          </span>
          <div
            aria-hidden
            className="ambient-breath-line"
            style={{
              width: 28,
              height: 1,
              background: AMBIENT_PALETTE.coreGlow,
              opacity: 0.55,
              animationDuration: `${period}s`,
            }}
          />
        </div>

        {/* Status + fork count */}
        <div
          style={{
            fontSize: 11,
            color: AMBIENT_PALETTE.textDim,
            fontFamily: "'JetBrains Mono', ui-monospace, monospace",
            letterSpacing: '0.04em',
            lineHeight: 1,
          }}
        >
          <span style={{
            color:
              label === 'thinking' ? AMBIENT_PALETTE.coreGlow
              : label === 'alive' ? AMBIENT_PALETTE.emberSoft
              : AMBIENT_PALETTE.textDim,
          }}>
            {label}
          </span>
          {forkCount > 0 && (
            <span style={{ color: AMBIENT_PALETTE.textDim }}> · {forkCount}</span>
          )}
        </div>

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Clock + audio toggle (desktop) / forks-badge + right-rail toggle (mobile) */}
        <div className="flex items-center gap-2">
          {!isMobile && (
            <span
              style={{
                fontSize: 11,
                fontVariantNumeric: 'tabular-nums',
                color: AMBIENT_PALETTE.textDim,
                fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                letterSpacing: '0.05em',
                lineHeight: 1,
              }}
              aria-label={`time ${clock} AEST`}
            >
              {clock} <span style={{ opacity: 0.6 }}>AEST</span>
            </span>
          )}

          {/* Mobile-only forks-running pill — taps the right rail open */}
          {isMobile && forksRunning > 0 && onOpenRightSheet && (
            <button
              type="button"
              onClick={onOpenRightSheet}
              aria-label={`${forksRunning} forks running, open forks panel`}
              style={{
                display: 'flex', alignItems: 'center', gap: 4,
                padding: '4px 8px',
                borderRadius: 999,
                border: '1px solid rgba(46,204,113,0.25)',
                background: 'rgba(46,204,113,0.08)',
                color: '#5fe89d',
                fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                fontSize: 10,
                letterSpacing: '0.04em',
                cursor: 'pointer',
                flexShrink: 0,
              }}
            >
              <span style={{
                width: 5, height: 5, borderRadius: 999,
                background: '#22c55e', boxShadow: '0 0 4px #22c55e',
              }} />
              {forksRunning}
            </button>
          )}

          <button
            type="button"
            onClick={onToggleAudio}
            aria-label={audioEnabled ? 'mute ambient audio' : 'enable ambient audio'}
            aria-pressed={audioEnabled}
            style={{
              width: 26, height: 26,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              borderRadius: '50%',
              border: audioEnabled ? '1px solid rgba(255,178,122,0.45)' : '1px solid rgba(255,255,255,0.10)',
              background: audioEnabled ? 'rgba(255,178,122,0.12)' : 'transparent',
              color: audioEnabled ? AMBIENT_PALETTE.coreGlow : 'rgba(255,255,255,0.40)',
              cursor: 'pointer',
              transition: 'all 200ms ease',
              flexShrink: 0,
            }}
          >
            {audioEnabled ? <SpeakerOnGlyph /> : <SpeakerOffGlyph />}
          </button>

          {/* Mobile-only right hamburger — opens FORKS / THREADS rail as side sheet */}
          {isMobile && onOpenRightSheet && (
            <button
              type="button"
              onClick={onOpenRightSheet}
              aria-label="open status panel"
              style={{
                width: 32, height: 32,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                borderRadius: 6,
                border: '1px solid rgba(255,255,255,0.10)',
                background: 'transparent',
                color: statusUnacked > 0 ? '#f59e0b' : 'rgba(255,255,255,0.65)',
                cursor: 'pointer',
                flexShrink: 0,
                position: 'relative',
              }}
            >
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor"
                strokeWidth="1.6" strokeLinecap="round">
                <circle cx="3.5" cy="4" r="1.2" />
                <line x1="6.5" y1="4" x2="13.5" y2="4" />
                <circle cx="3.5" cy="8" r="1.2" />
                <line x1="6.5" y1="8" x2="13.5" y2="8" />
                <circle cx="3.5" cy="12" r="1.2" />
                <line x1="6.5" y1="12" x2="13.5" y2="12" />
              </svg>
              {statusUnacked > 0 && (
                <span style={{
                  position: 'absolute', top: 3, right: 3,
                  width: 6, height: 6, borderRadius: 999,
                  background: '#f59e0b', boxShadow: '0 0 4px #f59e0b',
                }} />
              )}
            </button>
          )}
        </div>
      </div>

      <style>{`
        @keyframes ambient-breath {
          0%, 100% { opacity: 0.3; }
          50% { opacity: 1; }
        }
        .ambient-breath-line {
          animation-name: ambient-breath;
          animation-timing-function: ease-in-out;
          animation-iteration-count: infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .ambient-breath-line {
            animation: none !important;
            opacity: 0.6 !important;
          }
        }
      `}</style>
    </header>
  )
}

function SpeakerOnGlyph() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor"
      strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3.5 6 H6 L9.5 3 V13 L6 10 H3.5 Z" />
      <path d="M11.5 6 Q13 8 11.5 10" />
    </svg>
  )
}

function SpeakerOffGlyph() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor"
      strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3.5 6 H6 L9.5 3 V13 L6 10 H3.5 Z" />
      <path d="M11.5 6 L13.5 8 M13.5 6 L11.5 8" />
    </svg>
  )
}
