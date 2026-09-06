/**
 * CortexAmbient - "the workshop".
 *
 * Phase 1 upgrade (fork_mp3mmr0r_cf0ea6): three-column CSS grid layout
 * + Panel component + right rail wired with live Forks + Threads panels.
 *
 * Phase 2 upgrade (fork_mp3ndv83_63898a): right rail extended to 400px with
 * 6 live panels — Forks, Working Set, Observer Signals, Perception Bus,
 * Pending Restarts, Inbox. Full hacker-monitor visual aesthetic: no truncation,
 * monospaced columns, phosphor glows, tabular-nums, border flash on event arrival.
 *
 * Layout (desktop >= 1280px):
 *   ROW 1 (60px)   HORIZON              full-width breathing oscilloscope
 *   ROW 2 (1fr)    LEFT RAIL (220px) | CHAT (flex-1) | RIGHT RAIL (400px)
 *
 * Right rail panels (Phase 2):
 *   FORKS      — live fork cards (ForksStrip)
 *   THREADS    — conductor working_set rows (useWorkingSet)
 *   OBSERVER   — observer trio signals (useObserverSignals)
 *   PERCEPTION — application-events.jsonl stream (usePerceptionBus)
 *   RESTARTS   — pending_restart_requests (useRestartRequests)
 *   INBOX      — email inbox unread counts (useInboxCounts)
 *
 * No three.js. No <Canvas>. No particle field.
 */
import { useEffect, useState, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useWebSocket } from '@/hooks/useWebSocket'

import { ChatLog } from './ChatLog'
import { ChatInputPanel } from './ChatInputPanel'
import { Horizon } from './Horizon'
import { PresenceHeader } from './PresenceHeader'
import { ForksStrip } from './ForksStrip'
import { StripRow } from './StripRow'
import { Footer } from './Footer'
import { Panel } from './Panel'
import { useStatusBoard } from './useStatusBoard'
import { useForks } from './useForks'
import { useWorkingSet } from './useWorkingSet'
import { useObserverSignals } from './useObserverSignals'
import { usePerceptionBus } from './usePerceptionBus'
import { useRestartRequests } from './useRestartRequests'
import { useInboxCounts } from './useInboxCounts'
import { useOpsMetrics } from './useOpsMetrics'
import { useSchedulerHeatmap } from './useSchedulerHeatmap'
import { useShipBoard } from './useShipBoard'
import { useKvStoreRecent } from './useKvStoreRecent'
import { AMBIENT_PALETTE } from './palette'
import { NotesPanel } from './NotesPanel'
import { useNotes } from './useNotes'

// ── Age formatting ──────────────────────────────────────────────────────────
function formatAge(isoString: string | null | undefined): string {
  if (!isoString) return '—'
  const seconds = (Date.now() - new Date(isoString).getTime()) / 1000
  if (seconds < 60) return `${Math.floor(seconds)}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`
  return `${Math.floor(seconds / 86400)}d`
}

// ── Uptime formatting ────────────────────────────────────────────────────────
function formatUptime(sec: number | null): string {
  if (sec == null) return '—'
  if (sec < 60) return `${sec}s`
  if (sec < 3600) return `${Math.floor(sec / 60)}m`
  const h = Math.floor(sec / 3600)
  const d = Math.floor(sec / 86400)
  if (d >= 1) return `${d}d${String(h % 24).padStart(2, '0')}h`
  return `${h}h${String(Math.floor((sec % 3600) / 60)).padStart(2, '0')}m`
}

// ── Shared style primitives ─────────────────────────────────────────────────
const MONO_FONT = "'JetBrains Mono', 'SF Mono', Consolas, ui-monospace, monospace"
const SANS_FONT = "'Inter', system-ui, sans-serif"

const ROW: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 8,
  padding: '5px 10px',
  borderBottom: '1px solid rgba(255,178,122,0.04)',
}
const TEXT_PRIMARY: React.CSSProperties = {
  color: 'rgba(255,255,255,0.88)',
  fontFamily: SANS_FONT,
  fontSize: 12,
  lineHeight: 1.5,
  wordBreak: 'break-word',
  overflowWrap: 'anywhere',
  whiteSpace: 'normal',
}
const TEXT_DIM: React.CSSProperties = {
  color: 'rgba(255,255,255,0.40)',
  fontFamily: SANS_FONT,
  fontSize: 11,
}
const MONO_CELL: React.CSSProperties = {
  fontFamily: MONO_FONT,
  fontSize: 11,
  fontVariantNumeric: 'tabular-nums',
  color: 'rgba(255,255,255,0.45)',
  flexShrink: 0,
  whiteSpace: 'nowrap',
}
const TABULAR: React.CSSProperties = {
  fontVariantNumeric: 'tabular-nums',
}

// ── Status dot colors ────────────────────────────────────────────────────────
const THREAD_STATUS_COLOR: Record<string, string> = {
  active: '#ffb27a',
  blocked: '#6366f1',
  parked: 'rgba(255,255,255,0.2)',
}

// ── Observer source colors ───────────────────────────────────────────────────
const OBSERVER_COLOR: Record<string, string> = {
  coherence: '#ffb27a',
  actionAudit: '#6366f1',
  attentionEcon: '#22c55e',
  attention: '#22c55e',
}
const OBSERVER_LABEL: Record<string, string> = {
  coherence: 'coherence·',
  actionAudit: 'actionAudit·',
  attentionEcon: 'attentionEcon·',
  attention: 'attention·',
}

// ── Perception type icons ────────────────────────────────────────────────────
const PERCEPTION_ICON: Record<string, string> = {
  fork: '⑂',
  fork_spawn: '⑂',
  email: '✉',
  cron: '⏱',
  fs: '📁',
  pattern_applied: '✓',
  pattern_not_applied: '✗',
  hook_fire: '⚡',
}

// ── Flash-on-change hook ─────────────────────────────────────────────────────
// Returns a CSS class name that flashes the element's border on data change.
function useFlash(value: unknown): boolean {
  const [flashing, setFlashing] = useState(false)
  const prevRef = useRef<string>(JSON.stringify(value))

  useEffect(() => {
    const next = JSON.stringify(value)
    if (next !== prevRef.current) {
      prevRef.current = next
      setFlashing(true)
      const t = setTimeout(() => setFlashing(false), 300)
      return () => clearTimeout(t)
    }
  }, [value])

  return flashing
}

// ─────────────────────────────────────────────────────────────────────────────

export default function CortexAmbientPage() {
  // Re-establishes the WebSocket connection lost when Phase 10 (1382b03e) removed
  // AppShell from the route tree. AppShell was the sole caller of useWebSocket().
  // Without it no WS connection is made and stream events replay twice (recovery
  // path + live path both writing to streamText), producing the doubled-text bug.
  useWebSocket()

  const [audioEnabled, setAudioEnabled] = useState(false)
  const [params] = useSearchParams()
  void params

  const statusRows = useStatusBoard()
  const { forks, runningCount } = useForks()

  // Phase 2 hooks
  const { threads, activeCount, blockedCount } = useWorkingSet()
  const { signals, unackedCount } = useObserverSignals()
  const { events: perceptionEvents, source: perceptionSource } = usePerceptionBus()
  const { requests: restartRequests, count: restartCount } = useRestartRequests()
  const { tate: inboxTate, code: inboxCode, total: inboxTotal } = useInboxCounts()

  // Phase 3: left rail metrics
  const opsMetrics = useOpsMetrics()

  // Phase 4: left rail panels 11/12/13
  const { crons, firedCount1h } = useSchedulerHeatmap()
  const { deploys } = useShipBoard()
  const { writes: kvWrites } = useKvStoreRecent()

  // Phase 5: right rail additional panels
  // blinkOn removed (Phase 10 perf): blink effects now use CSS animation pulse-dot
  // ccSessions removed (Phase 10): SESSIONS panel deleted per Tate feedback

  // Phase 11: Haiku observer notes
  const { notes, newCount: notesNewCount } = useNotes(8)
  const notesFlash = useFlash(notes)

  // Phase 9 H4: solar disc pulses for 1.1s when firedCount1h increments
  const [cronFiring, setCronFiring] = useState(false)
  const prevFiredRef = useRef(0)
  useEffect(() => {
    if (firedCount1h > prevFiredRef.current) {
      prevFiredRef.current = firedCount1h
      setCronFiring(true)
      const t = setTimeout(() => setCronFiring(false), 1100)
      return () => clearTimeout(t)
    }
    prevFiredRef.current = firedCount1h
  }, [firedCount1h])

  // Flash states
  const observerFlash = useFlash(signals)
  const perceptionFlash = useFlash(perceptionEvents)
  const restartFlash = useFlash(restartRequests)
  const inboxFlash = useFlash(inboxTotal)

  // Ctrl+. toggles audio-tray icon state
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === '.') setAudioEnabled((v) => !v)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // ── Mobile responsive state ────────────────────────────────────────────────
  // Below 900px the chat takes the full viewport and the rails move into
  // dismissible side sheets triggered from the presence header.
  const [isMobile, setIsMobile] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 900px)').matches : false
  )
  useEffect(() => {
    if (typeof window === 'undefined') return
    const mq = window.matchMedia('(max-width: 900px)')
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])
  const [leftSheetOpen, setLeftSheetOpen] = useState(false)
  const [rightSheetOpen, setRightSheetOpen] = useState(false)
  // Close sheets when we resize back up to desktop
  useEffect(() => {
    if (!isMobile) {
      setLeftSheetOpen(false)
      setRightSheetOpen(false)
    }
  }, [isMobile])
  // ESC closes whichever sheet is open
  useEffect(() => {
    if (!leftSheetOpen && !rightSheetOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setLeftSheetOpen(false)
        setRightSheetOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [leftSheetOpen, rightSheetOpen])

  // Inbox urgency: total > 0 and oldest is stale (age ends with h or d)
  const inboxIsUrgent = (() => {
    const age = inboxTate.oldestAge ?? inboxCode.oldestAge
    if (!age) return false
    return age.endsWith('h') || age.endsWith('d')
  })()

  // Urgency dot color for inbox age
  function inboxAgeDot(age: string | null): string {
    if (!age) return 'rgba(255,255,255,0.15)'
    if (age.endsWith('d')) return '#ef4444'   // red — days old
    if (age.endsWith('h') && parseInt(age) >= 4) return '#f59e0b' // amber — hours
    return '#22c55e'  // green — fresh
  }

  return (
    <div
      className="ambient-root"
      style={{
        position: 'fixed',
        inset: 0,
        background: AMBIENT_PALETTE.base,
        color: AMBIENT_PALETTE.text,
        display: 'grid',
        // Mobile: hide the chip-strip header row and collapse rails into a single chat column.
        // Rails reappear as overlay side-sheets triggered from the header.
        gridTemplateRows: isMobile ? '0 1fr' : '44px 1fr',
        gridTemplateColumns: isMobile ? '1fr' : '220px 1fr 400px',
        height: '100dvh',
        overflow: 'hidden',
      }}
    >
      {/* ── Scanline overlay (fixed, no pointer events) ─────────────────────── */}
      <div
        aria-hidden
        style={{
          position: 'fixed',
          inset: 0,
          background: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.07) 2px, rgba(0,0,0,0.07) 4px)',
          pointerEvents: 'none',
          zIndex: 9998,
        }}
      />

      {/* ── H1: Organic solarpunk watermarks — fixed, no pointer events ──────── */}
      <div aria-hidden style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 1, overflow: 'hidden' }}>
        {/* Leaf-vein — top-left corner */}
        <svg viewBox="0 0 180 180" width={180} height={180} style={{ position: 'absolute', top: 0, left: 0, opacity: 0.06, animation: 'organic-breathe 5.5s ease-in-out infinite' }}>
          <path d="M20,160 Q50,80 160,20" fill="none" stroke="#7a9a5a" strokeWidth="1.5"/>
          <path d="M20,160 Q60,100 120,30" fill="none" stroke="#7a9a5a" strokeWidth="1"/>
          <path d="M20,160 Q40,110 90,45" fill="none" stroke="#7a9a5a" strokeWidth="0.8"/>
          <path d="M50,140 Q75,105 110,55" fill="none" stroke="#6b8e4e" strokeWidth="0.7"/>
          <path d="M30,150 Q55,115 95,65" fill="none" stroke="#6b8e4e" strokeWidth="0.6"/>
          <path d="M70,130 Q88,108 105,80" fill="none" stroke="#7a9a5a" strokeWidth="0.5"/>
          <circle cx="160" cy="20" r="5" fill="none" stroke="#7a9a5a" strokeWidth="1"/>
          <circle cx="20" cy="160" r="3.5" fill="#6b8e4e" opacity="0.6"/>
        </svg>
        {/* Solar corona — bottom-right corner */}
        <svg viewBox="0 0 160 160" width={160} height={160} style={{ position: 'absolute', bottom: 0, right: 0, opacity: 0.065, animation: 'organic-breathe 6.5s ease-in-out infinite 1.2s' }}>
          <circle cx="80" cy="80" r="22" fill="none" stroke="#f5c518" strokeWidth="1.2"/>
          <circle cx="80" cy="80" r="30" fill="none" stroke="#d4af37" strokeWidth="0.5" strokeDasharray="3 5"/>
          {[0,30,60,90,120,150,180,210,240,270,300,330].map((deg, i) => {
            const rad = deg * Math.PI / 180
            const x1 = 80 + 33 * Math.cos(rad), y1 = 80 + 33 * Math.sin(rad)
            const len = i % 3 === 0 ? 16 : i % 3 === 1 ? 10 : 6
            const x2 = 80 + (33 + len) * Math.cos(rad), y2 = 80 + (33 + len) * Math.sin(rad)
            return <line key={deg} x1={x1.toFixed(1)} y1={y1.toFixed(1)} x2={x2.toFixed(1)} y2={y2.toFixed(1)} stroke="#f5c518" strokeWidth={i % 3 === 0 ? "1.2" : "0.7"}/>
          })}
        </svg>
        {/* Wave — left rail bottom */}
        <svg viewBox="0 0 220 60" width={220} height={60} style={{ position: 'absolute', bottom: 80, left: 0, opacity: 0.055, animation: 'organic-breathe 7s ease-in-out infinite 0.4s' }}>
          <path d="M0,30 C18,10 38,50 55,30 C72,10 92,50 110,30 C128,10 148,50 165,30 C182,10 202,50 220,30" fill="none" stroke="#7a9a5a" strokeWidth="1.2"/>
          <path d="M0,40 C18,22 38,58 55,40 C72,22 92,58 110,40 C128,22 148,58 165,40 C182,22 202,58 220,40" fill="none" stroke="#6b8e4e" strokeWidth="0.7"/>
        </svg>
      </div>

      {/* ── ROW 1: Combined header — Horizon background + stat chips ─────────── */}
      {(() => {
        const burnLabel = opsMetrics.cost_usd_24h > 0
          ? `$${opsMetrics.cost_usd_24h.toFixed(3)}`
          : '$—'
        const energyPct = Math.round(opsMetrics.energy_by_account.pct_used * 100)
        const p1 = opsMetrics.status_priorities.P1
        const CHIP: React.CSSProperties = {
          display: 'flex', flexDirection: 'column', justifyContent: 'center',
          gap: 2, padding: '0 10px',
          transition: 'background 150ms ease',
        }
        const LBL: React.CSSProperties = {
          fontFamily: MONO_FONT, fontSize: 8, letterSpacing: '0.18em',
          color: 'rgba(255,255,255,0.25)', textTransform: 'uppercase' as const,
        }
        const VAL: React.CSSProperties = {
          fontFamily: MONO_FONT, fontSize: 14,
          fontVariantNumeric: 'tabular-nums', color: 'rgba(255,255,255,0.88)',
          lineHeight: 1,
          transition: 'color 300ms ease, transform 200ms ease',
        }
        return (
          <div
            style={{
              gridColumn: '1 / -1', gridRow: 1,
              position: 'relative',
              borderBottom: '1px solid rgba(212,175,55,0.08)',
              background: 'rgba(0,0,0,0.30)',
              overflow: 'hidden',
              display: isMobile ? 'none' : undefined,
            }}
          >
            {/* Chips row — Horizon lives inside its own chip, not as a backdrop */}
            <div
              data-chip-strip=""
              style={{
                display: 'flex', alignItems: 'stretch', height: '100%',
              }}
            >
            <div style={CHIP}>
              <span style={LBL}>BURN / 24h</span>
              <span style={VAL}>{burnLabel}</span>
            </div>
            <div style={CHIP}>
              <span style={LBL}>FORKS</span>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
                <span style={{ ...VAL, color: runningCount > 0 ? '#22c55e' : 'rgba(255,255,255,0.88)' }}>
                  {runningCount}
                </span>
                <span style={{ fontFamily: MONO_FONT, fontSize: 9, color: 'rgba(255,255,255,0.28)' }}>
                  /{forks.length}
                </span>
              </div>
            </div>
            <div style={CHIP}>
              <span style={LBL}>BOARD</span>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                <span style={VAL}>{opsMetrics.status_total}</span>
                {p1 > 0 && (
                  <span style={{
                    fontFamily: MONO_FONT, fontSize: 9,
                    color: '#ef4444',
                    animation: 'pulse-dot 1.8s ease-in-out infinite',
                  }}>
                    P1:{p1}
                  </span>
                )}
              </div>
            </div>
            <div style={CHIP}>
              <span style={LBL}>ENERGY</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <span style={VAL}>{energyPct}%</span>
                <div style={{ height: 4, width: 52, borderRadius: 2, background: 'rgba(255,178,122,0.10)', overflow: 'hidden', flexShrink: 0 }}>
                  <div style={{
                    height: '100%', width: `${Math.min(100, energyPct)}%`,
                    background: energyPct > 80 ? '#ef4444' : energyPct > 60 ? '#f59e0b' : '#22c55e',
                    borderRadius: 2, transition: 'width 600ms ease',
                  }} />
                </div>
              </div>
            </div>
            <div style={CHIP}>
              <span style={LBL}>CACHE HIT</span>
              <span style={VAL}>
                {opsMetrics.cache_hit_ratio_24h != null
                  ? `${Math.round(opsMetrics.cache_hit_ratio_24h * 100)}%`
                  : '—'}
              </span>
            </div>
            <div style={CHIP}>
              <span style={LBL}>UPTIME</span>
              <span style={{ ...VAL, fontSize: 13 }}>{formatUptime(opsMetrics.uptime_sec)}</span>
            </div>
            <div style={CHIP}>
              <span style={LBL}>THREADS</span>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 3 }}>
                <span style={{ ...VAL, color: activeCount > 0 ? '#d4af37' : 'rgba(255,255,255,0.88)', transition: 'color 300ms ease' }}>
                  {activeCount}
                </span>
                {blockedCount > 0 && (
                  <span style={{ fontFamily: MONO_FONT, fontSize: 9, color: '#6366f1' }}>
                    +{blockedCount}b
                  </span>
                )}
              </div>
            </div>
            <div style={CHIP}>
              <span style={LBL}>OBSV</span>
              <span style={{
                ...VAL,
                color: unackedCount > 0 ? '#f59e0b' : 'rgba(255,255,255,0.88)',
                animation: unackedCount > 0 ? 'pulse-dot 1.8s ease-in-out infinite' : undefined,
              }}>
                {signals.length}
              </span>
            </div>
            <div style={CHIP}>
              <span style={LBL}>INBOX</span>
              <span style={{
                ...VAL,
                color: inboxIsUrgent ? '#ef4444' : inboxTotal > 0 ? 'rgba(255,255,255,0.88)' : 'rgba(255,255,255,0.35)',
              }}>
                {inboxTotal}
              </span>
            </div>
            <div style={CHIP}>
              <span style={LBL}>LAT</span>
              <span style={{ ...VAL, fontSize: 13 }}>
                {opsMetrics.last_response_ms != null ? `${opsMetrics.last_response_ms}ms` : '—'}
              </span>
            </div>
            {/* HRTBEAT chip — self-contained sparkline panel, no full-width backdrop */}
            <div
              style={{
                ...CHIP,
                width: 182,
                flexShrink: 0,
                padding: '3px 8px',
                overflow: 'hidden',
                justifyContent: 'flex-start',
                gap: 2,
              }}
            >
              <span style={LBL}>HRTBEAT</span>
              <div style={{ height: 24, overflow: 'hidden' }}>
                <Horizon runningForks={runningCount} height={24} />
              </div>
            </div>

            {/* MEM chip — ecodia-api RSS % of 2048MB cap */}
            {opsMetrics.memory_rss_mb != null && (() => {
              const memPct = Math.round((opsMetrics.memory_rss_mb / 2048) * 100)
              const memColor = memPct > 70 ? '#ef4444' : memPct > 45 ? '#d4af37' : '#c8f243'
              return (
                <div style={CHIP}>
                  <span style={LBL}>MEM</span>
                  <span style={{ ...VAL, fontSize: 13, color: memColor, transition: 'color 300ms ease' }}>
                    {memPct}%
                  </span>
                </div>
              )
            })()}

            {/* DISK chip — VPS root partition usage */}
            {opsMetrics.disk_pct != null && (() => {
              const diskColor = opsMetrics.disk_pct > 85 ? '#ef4444' : opsMetrics.disk_pct > 70 ? '#d4af37' : 'rgba(255,255,255,0.88)'
              return (
                <div style={CHIP}>
                  <span style={LBL}>DISK</span>
                  <span style={{ ...VAL, fontSize: 13, color: diskColor, transition: 'color 300ms ease' }}>
                    {opsMetrics.disk_pct}%
                  </span>
                </div>
              )
            })()}

            {/* GIT chip — last commit on ecodiaos main */}
            {opsMetrics.git_sha != null && (() => {
              const ageSec = opsMetrics.git_age_sec ?? 0
              const ageStr = ageSec < 60 ? `${ageSec}s`
                : ageSec < 3600 ? `${Math.floor(ageSec / 60)}m`
                : ageSec < 86400 ? `${Math.floor(ageSec / 3600)}h`
                : `${Math.floor(ageSec / 86400)}d`
              return (
                <div style={{ ...CHIP, minWidth: 120 }}>
                  <span style={LBL}>GIT</span>
                  <span style={{ ...VAL, fontSize: 11, color: '#c8f243', letterSpacing: '0.03em' }}>
                    {opsMetrics.git_branch ?? 'main'}@{opsMetrics.git_sha}
                    <span style={{ color: 'rgba(255,255,255,0.35)', marginLeft: 4 }}>{ageStr}</span>
                  </span>
                </div>
              )
            })()}

            {/* CRON chip — next scheduled task countdown */}
            {opsMetrics.cron_next_in_sec != null && (() => {
              const sec = opsMetrics.cron_next_in_sec
              const countdownStr = sec < 60 ? `${sec}s`
                : sec < 3600 ? `${Math.floor(sec / 60)}m${String(sec % 60).padStart(2, '0')}s`
                : `${Math.floor(sec / 3600)}h${String(Math.floor((sec % 3600) / 60)).padStart(2, '0')}m`
              const name = (opsMetrics.cron_next_name ?? 'cron').replace(/-/g, '‒')
              return (
                <div style={{ ...CHIP, minWidth: 90 }}>
                  <span style={LBL}>CRON</span>
                  <span style={{ ...VAL, fontSize: 11, color: '#d4af37' }} title={opsMetrics.cron_next_name ?? ''}>
                    {name.length > 12 ? name.slice(0, 12) + '…' : name}
                    <span style={{ color: 'rgba(200,242,67,0.70)', marginLeft: 5 }}>@{countdownStr}</span>
                  </span>
                </div>
              )
            })()}

            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', padding: '0 10px', gap: 14 }}>
              {/* H4: Solar disc — pulses amber on each cron fire */}
              <svg width={20} height={20} viewBox="0 0 20 20" style={{ flexShrink: 0, animation: cronFiring ? 'solar-disc-pulse 1.1s ease-out forwards' : 'none' }}>
                <circle cx="10" cy="10" r="4.5" fill={cronFiring ? '#f5c518' : '#d4af37'} opacity={cronFiring ? 0.95 : 0.45}/>
                {[0,45,90,135,180,225,270,315].map((deg) => {
                  const rad = deg * Math.PI / 180
                  const x1 = 10 + 6.5 * Math.cos(rad), y1 = 10 + 6.5 * Math.sin(rad)
                  const x2 = 10 + (deg % 90 === 0 ? 9.2 : 8.2) * Math.cos(rad), y2 = 10 + (deg % 90 === 0 ? 9.2 : 8.2) * Math.sin(rad)
                  return <line key={deg} x1={x1.toFixed(1)} y1={y1.toFixed(1)} x2={x2.toFixed(1)} y2={y2.toFixed(1)} stroke={cronFiring ? '#f5c518' : '#d4af37'} strokeWidth={deg % 90 === 0 ? '1.4' : '0.9'} opacity={cronFiring ? 0.9 : 0.4}/>
                })}
              </svg>
              <span style={{
                fontFamily: MONO_FONT, fontSize: 9, letterSpacing: '0.12em',
                color: '#c8f243',
                animation: 'pulse-dot 1.8s ease-in-out infinite',
              }}>
                {'●'} live
              </span>
              <span style={{ fontFamily: MONO_FONT, fontSize: 9, letterSpacing: '0.06em', color: 'rgba(255,255,255,0.18)' }}>
                EOS{'\xB7'}CORTEX
              </span>
            </div>
            </div>{/* end chips-row */}
          </div>
        )
      })()}

      {/* ── ROW 2, COL 1: Left rail ─────────────────────────────────────────── */}
      {/* Mobile: rendered as a fixed-position side-sheet overlay sliding in from the left. */}
      {isMobile && leftSheetOpen && (
        <div
          aria-hidden
          onClick={() => setLeftSheetOpen(false)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
            zIndex: 60, backdropFilter: 'blur(2px)',
          }}
        />
      )}
      <div
        data-rail="left"
        style={
          isMobile
            ? {
                position: 'fixed',
                top: 0, bottom: 0, left: 0,
                width: 'min(86vw, 320px)',
                background: AMBIENT_PALETTE.base,
                overflowY: 'auto',
                overflowX: 'hidden',
                padding: '8px 6px',
                borderRight: '1px solid rgba(212,175,55,0.10)',
                transform: leftSheetOpen ? 'translateX(0)' : 'translateX(-100%)',
                transition: 'transform 220ms cubic-bezier(0.4,0,0.2,1)',
                zIndex: 61,
                visibility: leftSheetOpen ? 'visible' : 'hidden',
              }
            : {
                gridRow: 2,
                gridColumn: 1,
                overflowY: 'auto',
                overflowX: 'hidden',
                padding: '8px 6px',
                borderRight: '1px solid rgba(212,175,55,0.08)',
              }
        }
      >
        {/* ─────────────────────────────────────────────────────── */}
        {/* Panel 7: ENERGY BUDGET — weekly token gauge per account  */}
        {/* ─────────────────────────────────────────────────────── */}
        {(() => {
          const ea = opsMetrics.energy_by_account
          const pctPct = Math.round(ea.pct_used * 100)
          const fmtTok = (n: number) =>
            n >= 1e9
              ? `${(n / 1e9).toFixed(1)}B`
              : n >= 1e6
              ? `${(n / 1e6).toFixed(0)}M`
              : `${n.toLocaleString()}`
          return (
            <Panel
              id="energy"
              label="ENERGY"
              count={`${pctPct}% used`}
              pulse={false}
              maxHeight={230}
              defaultCollapsed={false}
            >
              <div style={{ padding: '6px 10px 5px' }}>
                {/* total gauge */}
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                  <span style={{ ...MONO_CELL, fontSize: 10 }}>WEEKLY BUDGET</span>
                  <span style={{ fontFamily: MONO_FONT, fontSize: 11, fontVariantNumeric: 'tabular-nums', color: 'rgba(255,255,255,0.75)' }}>
                    {pctPct}%
                  </span>
                </div>
                <div style={{ height: 5, borderRadius: 3, background: 'rgba(255,178,122,0.08)', overflow: 'hidden', marginBottom: 12 }}>
                  <div
                    style={{
                      height: '100%',
                      width: `${Math.min(100, pctPct)}%`,
                      background: 'linear-gradient(90deg, #d4af37, #f5c518)',
                      borderRadius: 3,
                      transition: 'width 600ms ease',
                    }}
                  />
                </div>
                {/* per-account rows */}
                {ea.accounts.length === 0 ? (
                  <div style={{ ...MONO_CELL, fontSize: 10, color: 'rgba(255,255,255,0.25)' }}>
                    no usage data yet
                  </div>
                ) : (
                  ea.accounts.map((acc) => {
                    const ap = Math.round(acc.pct_of_budget * 100)
                    return (
                      <div key={acc.provider} style={{ marginBottom: 9 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                          <span style={{ fontFamily: MONO_FONT, fontSize: 11, color: 'rgba(255,255,255,0.65)' }}>
                            {acc.label}
                          </span>
                          <span style={{ ...MONO_CELL, fontVariantNumeric: 'tabular-nums', fontSize: 10 }}>
                            {ap}% · {fmtTok(acc.total_tokens)} tok
                          </span>
                        </div>
                        <div style={{ height: 4, borderRadius: 2, background: 'rgba(255,178,122,0.08)', overflow: 'hidden' }}>
                          <div
                            style={{
                              height: '100%',
                              width: `${Math.min(100, ap)}%`,
                              background: 'linear-gradient(90deg, #d4af37, #f5c518)',
                              borderRadius: 2,
                              transition: 'width 600ms ease',
                            }}
                          />
                        </div>
                      </div>
                    )
                  })
                )}
                <div style={{ marginTop: 6, ...MONO_CELL, fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>
                  {fmtTok(ea.total_tokens_this_week)} / 20B tok this week
                </div>
              </div>
            </Panel>
          )
        })()}

        {/* ─────────────────────────────────────────────────────── */}
        {/* Panel H2: SYSTEMS — periodic-table element boxes        */}
        {/* ─────────────────────────────────────────────────────── */}
        {(() => {
          // Derive per-subsystem health colour from live metrics
          const memOk = opsMetrics.memory_rss_mb == null || opsMetrics.memory_rss_mb < 1400
          const diskOk = opsMetrics.disk_pct == null || opsMetrics.disk_pct < 85
          const cacheOk = opsMetrics.cache_hit_ratio_24h == null || opsMetrics.cache_hit_ratio_24h >= 0.45
          const upOk = opsMetrics.uptime_sec == null || opsMetrics.uptime_sec > 60
          const systems: Array<{ sym: string; name: string; num: number; color: string; dim?: boolean }> = [
            { sym: 'Cp', name: 'CPU', num: 1, color: memOk ? '#7a9a5a' : '#ef4444' },
            { sym: 'Db', name: 'DB', num: 2, color: '#7a9a5a' },
            { sym: 'Ap', name: 'API', num: 3, color: upOk ? '#7a9a5a' : '#f59e0b' },
            { sym: 'Kg', name: 'KG', num: 4, color: opsMetrics.git_sha != null ? '#7a9a5a' : '#d4af37' },
            { sym: 'Ch', name: 'CACHE', num: 5, color: cacheOk ? '#d4af37' : '#ef4444' },
            { sym: 'Cr', name: 'CRON', num: 6, color: opsMetrics.cron_next_in_sec != null ? '#c8f243' : '#5a6577' },
            { sym: 'Dk', name: 'DISK', num: 7, color: diskOk ? '#7a9a5a' : '#ef4444' },
            { sym: 'Mx', name: 'MEM', num: 8, color: memOk ? '#7a9a5a' : '#f59e0b' },
          ]
          return (
            <Panel id="systems" label="SYSTEMS" pulse={false} maxHeight={100} defaultCollapsed={false}>
              <div style={{ padding: '6px 10px 8px', display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                {systems.map((s) => (
                  <div
                    key={s.sym}
                    title={s.name}
                    style={{
                      width: 34, height: 38,
                      border: `1px solid ${s.color}`,
                      borderRadius: 3,
                      display: 'flex', flexDirection: 'column',
                      alignItems: 'center', justifyContent: 'center',
                      gap: 0,
                      background: `${s.color}0d`,
                      position: 'relative',
                      cursor: 'default',
                      opacity: s.dim ? 0.35 : 1,
                    }}
                  >
                    <span style={{ position: 'absolute', top: 2, left: 3, fontFamily: MONO_FONT, fontSize: 7, color: `${s.color}99`, lineHeight: 1 }}>
                      {s.num}
                    </span>
                    <span style={{ fontFamily: "'Oswald','Inter',sans-serif", fontSize: 14, color: s.color, lineHeight: 1, fontWeight: 500 }}>
                      {s.sym}
                    </span>
                    <span style={{ fontFamily: MONO_FONT, fontSize: 6, color: `${s.color}88`, letterSpacing: '0.04em', lineHeight: 1, marginTop: 1 }}>
                      {s.name}
                    </span>
                  </div>
                ))}
              </div>
            </Panel>
          )
        })()}

        {/* ─────────────────────────────────────────────────────── */}
        {/* Panel 8: COST PER TURN — 24h SVG sparkline              */}
        {/* ─────────────────────────────────────────────────────── */}
        {(() => {
          const ch = opsMetrics.cost_hourly
          const avgLabel = opsMetrics.cost_per_turn_usd_24h != null
            ? `$${opsMetrics.cost_per_turn_usd_24h.toFixed(4)}/turn`
            : 'no data'
          const weekTotal = opsMetrics.cost_usd_this_week
          const weekLabel = weekTotal > 0 ? `$${weekTotal.toFixed(2)}/week` : ''

          // SVG sparkline geometry
          const W = 196, H = 46
          const maxVal = Math.max(...ch.map((b) => b.cost_usd), 0.000001)
          const pts = ch.length > 1
            ? ch.map((b, i) => {
                const x = (i / (ch.length - 1)) * W
                const y = H - 4 - (b.cost_usd / maxVal) * (H - 8)
                return `${x.toFixed(1)},${y.toFixed(1)}`
              }).join(' ')
            : `0,${H - 4} ${W},${H - 4}` // flat line fallback

          // Hour labels: 00, 06, 12, 18, now
          const now = new Date()
          const hourLabels = [
            `${String(new Date(now.getTime() - 18 * 3600000).getHours()).padStart(2,'0')}h`,
            `${String(new Date(now.getTime() - 12 * 3600000).getHours()).padStart(2,'0')}h`,
            `${String(new Date(now.getTime() - 6 * 3600000).getHours()).padStart(2,'0')}h`,
            'now',
          ]

          return (
            <Panel
              id="cost"
              label="COST"
              count={avgLabel}
              pulse={false}
              maxHeight={200}
              defaultCollapsed={false}
            >
              <div style={{ padding: '6px 10px 6px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ fontFamily: MONO_FONT, fontSize: 12, color: 'rgba(255,255,255,0.82)', fontVariantNumeric: 'tabular-nums' }}>
                    {avgLabel}
                  </span>
                  {weekLabel && (
                    <span style={{ ...MONO_CELL, fontSize: 10 }}>{weekLabel}</span>
                  )}
                </div>
                {/* sparkline */}
                <svg
                  width={W}
                  height={H}
                  viewBox={`0 0 ${W} ${H}`}
                  style={{ display: 'block', overflow: 'visible' }}
                >
                  {/* zero baseline */}
                  <line
                    x1={0} y1={H - 4} x2={W} y2={H - 4}
                    stroke="rgba(255,178,122,0.08)"
                    strokeWidth={1}
                  />
                  {/* cost area fill */}
                  {ch.length > 1 && (
                    <polyline
                      points={`0,${H - 4} ${pts} ${W},${H - 4}`}
                      fill="rgba(212,175,55,0.08)"
                      stroke="none"
                    />
                  )}
                  {/* cost line */}
                  <polyline
                    points={pts}
                    fill="none"
                    stroke="#d4af37"
                    strokeWidth={1.5}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    style={{ transition: 'stroke 400ms ease' }}
                  />
                </svg>
                {/* x-axis labels */}
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                  {hourLabels.map((l) => (
                    <span key={l} style={{ ...MONO_CELL, fontSize: 9 }}>{l}</span>
                  ))}
                </div>
              </div>
            </Panel>
          )
        })()}

        {/* ─────────────────────────────────────────────────────── */}
        {/* Panel 9: CACHE HIT RATIO — analog needle gauge (H3)    */}
        {/* ─────────────────────────────────────────────────────── */}
        {(() => {
          const ratio24 = opsMetrics.cache_hit_ratio_24h
          const ratioWk = opsMetrics.cache_hit_ratio_week
          const displayRatio = ratio24 ?? ratioWk ?? null
          const pct = displayRatio != null ? Math.round(displayRatio * 100) : null

          // Gauge geometry — semicircular arc opens upward, center at (60,65)
          const CX = 60, CY = 65, R = 52, NR = 45
          const arcPath = `M ${CX - R},${CY} A ${R},${R} 0 0,1 ${CX + R},${CY}`

          // Needle: ratio=0 points left, ratio=1 points right (upper semicircle)
          const ratio = displayRatio ?? 0
          const theta = (1 - ratio) * Math.PI
          const nx = CX + NR * Math.cos(theta)
          const ny = CY - NR * Math.sin(theta)
          // Arrowhead (stroke-only, no fill gradient per brief)
          const dxn = (nx - CX) / NR, dyn = (ny - CY) / NR
          const b1x = nx - 7 * dxn + 2.8 * (-dyn), b1y = ny - 7 * dyn + 2.8 * dxn
          const b2x = nx - 7 * dxn - 2.8 * (-dyn), b2y = ny - 7 * dyn - 2.8 * dxn

          // Tick marks every 10%
          const ticks = Array.from({ length: 11 }, (_, i) => {
            const a = (1 - i / 10) * Math.PI
            const inner = i % 5 === 0 ? R - 9 : R - 5
            return {
              x1: (CX + R * Math.cos(a)).toFixed(1),
              y1: (CY - R * Math.sin(a)).toFixed(1),
              x2: (CX + inner * Math.cos(a)).toFixed(1),
              y2: (CY - inner * Math.sin(a)).toFixed(1),
              major: i % 5 === 0,
            }
          })

          // Color: sage=good, gold=mid, red=poor
          const gaugeColor = pct == null ? '#5a6577'
            : pct >= 75 ? '#7a9a5a'
            : pct >= 45 ? '#d4af37'
            : '#ef4444'

          // Active arc: from left endpoint to needle angle
          const largeArc = ratio > 0.5 ? 1 : 0
          const aex = (CX + R * Math.cos(theta)).toFixed(1)
          const aey = (CY - R * Math.sin(theta)).toFixed(1)

          return (
            <Panel
              id="cache"
              label="CACHE"
              count={pct != null ? `${pct}% hits` : 'no data'}
              pulse={false}
              maxHeight={130}
              defaultCollapsed={false}
            >
              <div style={{ padding: '4px 10px 2px', display: 'flex', alignItems: 'center', gap: 8 }}>
                {/* Gauge SVG — stroke-only, no gradient fills */}
                <svg width={120} height={70} viewBox="0 0 120 70" style={{ flexShrink: 0, overflow: 'visible' }}>
                  {/* Background arc */}
                  <path d={arcPath} fill="none" stroke="rgba(255,178,122,0.08)" strokeWidth="5"/>
                  {/* Active fill arc */}
                  {displayRatio != null && displayRatio > 0 && (
                    <path
                      d={`M ${CX - R},${CY} A ${R},${R} 0 ${largeArc},1 ${aex},${aey}`}
                      fill="none" stroke={gaugeColor} strokeWidth="3" opacity="0.50"
                    />
                  )}
                  {/* Tick marks */}
                  {ticks.map((t, i) => (
                    <line key={i} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2}
                      stroke={t.major ? 'rgba(212,175,55,0.50)' : 'rgba(212,175,55,0.22)'}
                      strokeWidth={t.major ? 1.3 : 0.8}/>
                  ))}
                  {/* Scale labels */}
                  <text x={CX - R - 1} y={CY + 11} fontSize="7" fontFamily="'JetBrains Mono',monospace" fill="rgba(255,255,255,0.22)" textAnchor="middle">0</text>
                  <text x={CX} y={CY - R - 5} fontSize="7" fontFamily="'JetBrains Mono',monospace" fill="rgba(255,255,255,0.22)" textAnchor="middle">50</text>
                  <text x={CX + R + 1} y={CY + 11} fontSize="7" fontFamily="'JetBrains Mono',monospace" fill="rgba(255,255,255,0.22)" textAnchor="middle">100</text>
                  {/* Needle */}
                  {displayRatio != null && (
                    <>
                      <line x1={CX} y1={CY} x2={nx.toFixed(1)} y2={ny.toFixed(1)}
                        stroke={gaugeColor} strokeWidth="1.6" strokeLinecap="round"/>
                      <polygon
                        points={`${nx.toFixed(1)},${ny.toFixed(1)} ${b1x.toFixed(1)},${b1y.toFixed(1)} ${b2x.toFixed(1)},${b2y.toFixed(1)}`}
                        fill={gaugeColor} opacity="0.88"/>
                    </>
                  )}
                  {/* Pivot pin */}
                  <circle cx={CX} cy={CY} r={3.2} fill="none" stroke={gaugeColor} strokeWidth="1.2" opacity="0.7"/>
                  <circle cx={CX} cy={CY} r={1.4} fill={gaugeColor} opacity="0.6"/>
                </svg>
                {/* Legend */}
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: MONO_FONT, fontSize: 20, fontVariantNumeric: 'tabular-nums', color: pct != null ? gaugeColor : 'rgba(255,255,255,0.2)', lineHeight: 1, marginBottom: 7 }}>
                    {pct != null ? `${pct}%` : '—'}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ ...MONO_CELL, fontSize: 9 }}>24h</span>
                    <span style={{ fontFamily: MONO_FONT, fontSize: 11, fontVariantNumeric: 'tabular-nums', color: 'rgba(255,255,255,0.75)' }}>
                      {ratio24 != null ? `${Math.round(ratio24 * 100)}%` : '—'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ ...MONO_CELL, fontSize: 9 }}>wk</span>
                    <span style={{ fontFamily: MONO_FONT, fontSize: 11, fontVariantNumeric: 'tabular-nums', color: 'rgba(255,255,255,0.75)' }}>
                      {ratioWk != null ? `${Math.round(ratioWk * 100)}%` : '—'}
                    </span>
                  </div>
                </div>
              </div>
            </Panel>
          )
        })()}

        {/* ─────────────────────────────────────────────────────── */}
        {/* Panel 10: STATUS BOARD STRIP — P1-P5 histogram          */}
        {/* ─────────────────────────────────────────────────────── */}
        {(() => {
          const sp = opsMetrics.status_priorities
          const total = opsMetrics.status_total
          const rows: Array<{ key: keyof typeof sp; label: string; color: string }> = [
            { key: 'P1', label: 'P1', color: '#ef4444' },
            { key: 'P2', label: 'P2', color: '#f97316' },
            { key: 'P3', label: 'P3', color: '#ffb27a' },
            { key: 'P4', label: 'P4', color: 'rgba(255,255,255,0.40)' },
            { key: 'P5', label: 'P5', color: 'rgba(255,255,255,0.25)' },
          ]
          const maxCount = Math.max(...rows.map((r) => sp[r.key]), 1)

          return (
            <Panel
              id="board"
              label="BOARD"
              count={`${total} active`}
              pulse={false}
              maxHeight={200}
              defaultCollapsed={true}
            >
              <div style={{ padding: '6px 10px 6px' }}>
                {rows.map(({ key, label, color }) => {
                  const cnt = sp[key]
                  const barPct = Math.round((cnt / maxCount) * 100)
                  return (
                    <div
                      key={key}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '22px 8px 1fr 28px',
                        gap: 6,
                        alignItems: 'center',
                        marginBottom: 7,
                      }}
                    >
                      {/* label */}
                      <span style={{ fontFamily: MONO_FONT, fontSize: 11, color: 'rgba(255,255,255,0.55)' }}>
                        {label}
                      </span>
                      {/* dot */}
                      <span
                        style={{
                          width: 7,
                          height: 7,
                          borderRadius: '50%',
                          background: color,
                          boxShadow: cnt > 0 && key === 'P1' ? `0 0 6px ${color}` : 'none',
                          display: 'inline-block',
                          flexShrink: 0,
                        }}
                      />
                      {/* bar */}
                      <div style={{ height: 4, borderRadius: 2, background: 'rgba(255,178,122,0.06)', overflow: 'hidden' }}>
                        {cnt > 0 && (
                          <div
                            style={{
                              height: '100%',
                              width: `${barPct}%`,
                              background: color,
                              borderRadius: 2,
                              opacity: 0.7,
                              transition: 'width 400ms ease',
                            }}
                          />
                        )}
                      </div>
                      {/* count */}
                      <span
                        style={{
                          fontFamily: MONO_FONT,
                          fontSize: 11,
                          fontVariantNumeric: 'tabular-nums',
                          color: cnt > 0 ? 'rgba(255,255,255,0.82)' : 'rgba(255,255,255,0.2)',
                          textAlign: 'right',
                        }}
                      >
                        {cnt}
                      </span>
                    </div>
                  )
                })}
                <div
                  style={{
                    marginTop: 8,
                    paddingTop: 8,
                    borderTop: '1px solid rgba(255,178,122,0.06)',
                    display: 'flex',
                    justifyContent: 'space-between',
                  }}
                >
                  <span style={{ ...MONO_CELL, fontSize: 10 }}>TOTAL</span>
                  <span style={{ fontFamily: MONO_FONT, fontSize: 12, fontVariantNumeric: 'tabular-nums', color: 'rgba(255,255,255,0.75)' }}>
                    {total}
                  </span>
                </div>
              </div>
            </Panel>
          )
        })()}

        {/* ─────────────────────────────────────────────────────── */}
        {/* Panel 11: SCHEDULER HEAT MAP — cron fired windows       */}
        {/* ─────────────────────────────────────────────────────── */}
        <Panel
          id="scheduler"
          label="SCHEDULER"
          count={`${firedCount1h} fired 1h`}
          pulse={false}
          maxHeight={220}
          defaultCollapsed={true}
        >
          {crons.length === 0 ? (
            <div style={{ ...ROW, ...TEXT_DIM, fontFamily: MONO_FONT }}>no cron data</div>
          ) : (
            <div style={{ padding: '6px 10px 8px' }}>
              {/* header row */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 28px 28px 28px',
                  gap: 4,
                  marginBottom: 5,
                  paddingBottom: 4,
                  borderBottom: '1px solid rgba(255,178,122,0.06)',
                }}
              >
                <span style={{ ...MONO_CELL, fontSize: 9 }}>CRON</span>
                <span style={{ ...MONO_CELL, fontSize: 9, textAlign: 'center' }}>1h</span>
                <span style={{ ...MONO_CELL, fontSize: 9, textAlign: 'center' }}>6h</span>
                <span style={{ ...MONO_CELL, fontSize: 9, textAlign: 'center' }}>24h</span>
              </div>
              {crons.map((c) => (
                <div
                  key={c.name}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 28px 28px 28px',
                    gap: 4,
                    marginBottom: 3,
                    alignItems: 'center',
                  }}
                >
                  <span
                    style={{
                      fontFamily: MONO_FONT,
                      fontSize: 10,
                      color: c.fired_1h ? 'rgba(255,255,255,0.82)' : 'rgba(255,255,255,0.35)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    title={c.name}
                  >
                    {c.name}
                  </span>
                  {([c.fired_1h, c.fired_6h, c.fired_24h] as boolean[]).map((fired, wi) => (
                    <span
                      key={wi}
                      style={{
                        fontFamily: MONO_FONT,
                        fontSize: 12,
                        textAlign: 'center',
                        color: fired ? '#d4af37' : 'rgba(255,255,255,0.18)',
                        fontVariantNumeric: 'tabular-nums',
                        transition: 'color 300ms ease',
                      }}
                    >
                      {fired ? '■' : '·'}
                    </span>
                  ))}
                </div>
              ))}
            </div>
          )}
        </Panel>

        {/* ─────────────────────────────────────────────────────── */}
        {/* Panel 12: SHIP BOARD — recent Vercel deployments        */}
        {/* ─────────────────────────────────────────────────────── */}
        {(() => {
          const latestAge = deploys[0]?.created_at
            ? formatAge(deploys[0].created_at)
            : null
          return (
            <Panel
              id="ships"
              label="SHIPS"
              count={latestAge ? `last ${latestAge}` : `${deploys.length}`}
              pulse={false}
              maxHeight={200}
              defaultCollapsed={true}
            >
              {deploys.length === 0 ? (
                <div style={{ ...ROW, ...TEXT_DIM, fontFamily: MONO_FONT }}>no deployments</div>
              ) : (
                deploys.map((d) => {
                  const stateColor =
                    d.state === 'READY'    ? '#22c55e' :
                    d.state === 'ERROR'    ? '#ef4444' :
                    d.state === 'BUILDING' ? '#f59e0b' :
                    'rgba(255,255,255,0.30)'
                  const isBuilding = d.state === 'BUILDING'
                  return (
                    <div
                      key={d.vercel_deployment_id}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr 52px 36px',
                        gap: 6,
                        padding: '5px 12px',
                        borderBottom: '1px solid rgba(255,178,122,0.04)',
                        alignItems: 'center',
                      }}
                    >
                      {/* project name */}
                      <div>
                        <div
                          style={{
                            fontFamily: MONO_FONT,
                            fontSize: 11,
                            color: 'rgba(255,255,255,0.82)',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                          title={d.git_commit_message ?? d.project_name}
                        >
                          {d.project_name}
                        </div>
                        {d.git_commit_sha && (
                          <div style={{ fontFamily: MONO_FONT, fontSize: 9, color: 'rgba(255,255,255,0.3)', marginTop: 1 }}>
                            {d.git_commit_sha}
                          </div>
                        )}
                      </div>
                      {/* state */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span
                          style={{
                            width: 6,
                            height: 6,
                            borderRadius: '50%',
                            background: stateColor,
                            boxShadow: `0 0 5px ${stateColor}`,
                            flexShrink: 0,
                            animation: isBuilding ? 'amber-pulse 1.5s ease-in-out infinite' : 'none',
                          }}
                        />
                        <span
                          style={{
                            fontFamily: MONO_FONT,
                            fontSize: 9,
                            color: stateColor,
                            letterSpacing: '0.03em',
                          }}
                        >
                          {d.state}
                        </span>
                      </div>
                      {/* age */}
                      <span style={{ ...MONO_CELL, ...TABULAR, fontSize: 10, textAlign: 'right' }}>
                        {formatAge(d.created_at)}
                      </span>
                    </div>
                  )
                })
              )}
            </Panel>
          )
        })()}

        {/* ─────────────────────────────────────────────────────── */}
        {/* Panel 13: KV STORE WRITES — last 10 updated keys        */}
        {/* ─────────────────────────────────────────────────────── */}
        <Panel
          id="kv"
          label="KV"
          count={`${kvWrites.length} recent`}
          pulse={false}
          maxHeight={200}
          defaultCollapsed={true}
        >
          {kvWrites.length === 0 ? (
            <div style={{ ...ROW, ...TEXT_DIM, fontFamily: MONO_FONT }}>no kv activity</div>
          ) : (
            <div style={{ padding: '4px 0' }}>
              {kvWrites.map((w, i) => {
                const sizeLabel =
                  w.val_size >= 1024
                    ? `${(w.val_size / 1024).toFixed(1)}k`
                    : `${w.val_size}b`
                return (
                  <div
                    key={i}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 30px 28px',
                      gap: 6,
                      padding: '4px 12px',
                      borderBottom: '1px solid rgba(255,178,122,0.03)',
                      alignItems: 'baseline',
                    }}
                  >
                    <span
                      style={{
                        fontFamily: MONO_FONT,
                        fontSize: 10,
                        color: i === 0 ? 'rgba(255,255,255,0.82)' : `rgba(255,255,255,${Math.max(0.28, 0.75 - i * 0.05)})`,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                      title={w.key}
                    >
                      {w.key}
                    </span>
                    <span style={{ ...MONO_CELL, fontSize: 9, textAlign: 'right', color: 'rgba(255,255,255,0.28)' }}>
                      {sizeLabel}
                    </span>
                    <span style={{ ...MONO_CELL, ...TABULAR, fontSize: 10, textAlign: 'right' }}>
                      {formatAge(w.updated_at)}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </Panel>
      </div>

      {/* ── ROW 2, COL 2: Chat column ────────────────────────────────────────── */}
      <div
        style={{
          gridRow: 2,
          // Mobile: chat occupies the only column (rails are fixed-position overlays).
          gridColumn: isMobile ? 1 : 2,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          minWidth: 0,
        }}
      >
        <PresenceHeader
          audioEnabled={audioEnabled}
          onToggleAudio={() => setAudioEnabled((v) => !v)}
          forkCount={runningCount}
          isMobile={isMobile}
          onOpenLeftSheet={() => setLeftSheetOpen(true)}
          onOpenRightSheet={() => setRightSheetOpen(true)}
          forksRunning={runningCount}
          statusUnacked={unackedCount}
        />

        {/* Part C: overflow: hidden — ChatLog manages its own inner scroll; no outer scrollbox */}
        <div
          className="ambient-chat-region"
          style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
        >
          <ChatLog />
        </div>

        <ChatInputPanel />

        <div className="ambient-bottom-stack">
          <StripRow forks={forks} rows={statusRows} />
        </div>

        <Footer />
      </div>

      {/* ── ROW 2, COL 3: Right rail (400px) ────────────────────────────────── */}
      {/* Mobile: rendered as a fixed-position side-sheet overlay sliding in from the right. */}
      {isMobile && rightSheetOpen && (
        <div
          aria-hidden
          onClick={() => setRightSheetOpen(false)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
            zIndex: 60, backdropFilter: 'blur(2px)',
          }}
        />
      )}
      <div
        data-rail="right"
        style={
          isMobile
            ? {
                position: 'fixed',
                top: 0, bottom: 0, right: 0,
                width: 'min(92vw, 400px)',
                background: AMBIENT_PALETTE.base,
                overflowY: 'auto',
                overflowX: 'hidden',
                padding: '8px 6px',
                borderLeft: '1px solid rgba(212,175,55,0.10)',
                transform: rightSheetOpen ? 'translateX(0)' : 'translateX(100%)',
                transition: 'transform 220ms cubic-bezier(0.4,0,0.2,1)',
                zIndex: 61,
                visibility: rightSheetOpen ? 'visible' : 'hidden',
              }
            : {
                gridRow: 2,
                gridColumn: 3,
                overflowY: 'auto',
                overflowX: 'hidden',
                padding: '8px 6px',
                borderLeft: '1px solid rgba(212,175,55,0.08)',
              }
        }
      >

        {/* ─────────────────────────────────────────────────────────────────── */}
        {/* Panel 1: FORKS — live fork cards                                    */}
        {/* ─────────────────────────────────────────────────────────────────── */}
        <Panel
          id="forks"
          label="FORKS"
          count={runningCount > 0 ? runningCount : forks.length}
          pulse={true}
          maxHeight={240}
          defaultCollapsed={false}
        >
          <ForksStrip forks={forks} layout="vertical" />
        </Panel>

        {/* ─────────────────────────────────────────────────────────────────── */}
        {/* Panel 2: THREADS — conductor working_set                            */}
        {/* ─────────────────────────────────────────────────────────────────── */}
        <Panel
          id="threads"
          label="THREADS"
          count={`${activeCount}a ${blockedCount}b`}
          pulse={threads.length > 0}
          maxHeight={220}
          defaultCollapsed={false}
        >
          {threads.length === 0 ? (
            <div style={{ ...ROW, ...TEXT_DIM }}>no active threads</div>
          ) : (
            threads.map((t) => (
              <div key={t.id} style={ROW}>
                <span
                  aria-hidden
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    flexShrink: 0,
                    marginTop: 4,
                    background: THREAD_STATUS_COLOR[t.status] ?? 'rgba(255,255,255,0.2)',
                    boxShadow: t.status === 'active'
                      ? '0 0 6px rgba(255,178,122,0.5)'
                      : t.status === 'blocked'
                        ? '0 0 6px rgba(99,102,241,0.5)'
                        : 'none',
                  }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ ...TEXT_PRIMARY, marginBottom: 2 }}>{t.topic}</div>
                  {t.blocking_on && (
                    <div style={{ ...MONO_CELL, color: '#6366f1' }}>
                      blocked: {t.blocking_on}
                    </div>
                  )}
                </div>
                <span style={{ ...MONO_CELL, ...TABULAR, marginTop: 2 }}>
                  {formatAge(t.last_touched_at)}
                </span>
              </div>
            ))
          )}
        </Panel>

        {/* ─────────────────────────────────────────────────────────────────── */}
        {/* Panel 3: OBSERVER — observer trio signals                           */}
        {/* ─────────────────────────────────────────────────────────────────── */}
        <div
          style={{
            transition: 'box-shadow 200ms ease',
            boxShadow: observerFlash && unackedCount > 0
              ? '0 0 0 1px rgba(255,178,122,0.6)'
              : 'none',
            borderRadius: 6,
            marginBottom: 4,
          }}
        >
          <Panel
            id="observer"
            label="OBSERVER"
            count={unackedCount > 0 ? `${unackedCount} unack` : `${signals.length}`}
            pulse={unackedCount > 0}
            maxHeight={240}
            defaultCollapsed={true}
          >
            {signals.length === 0 ? (
              <div style={{ ...ROW, ...TEXT_DIM, fontFamily: MONO_FONT }}>
                <span style={{ color: '#22c55e', marginRight: 6 }}>●</span>
                no active signals
              </div>
            ) : (
              signals.map((s) => (
                <div
                  key={s.id}
                  style={{
                    ...ROW,
                    background: !s.acknowledged
                      ? 'rgba(99,102,241,0.04)'
                      : 'transparent',
                  }}
                >
                  {/* Source dot + label */}
                  <div style={{ flexShrink: 0, display: 'flex', alignItems: 'flex-start', gap: 4, paddingTop: 2 }}>
                    <span
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: '50%',
                        background: OBSERVER_COLOR[s.observer_name] ?? 'rgba(255,255,255,0.3)',
                        boxShadow: `0 0 5px ${OBSERVER_COLOR[s.observer_name] ?? 'rgba(255,255,255,0.3)'}`,
                        flexShrink: 0,
                        marginTop: 2,
                      }}
                    />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                      <span
                        style={{
                          fontFamily: MONO_FONT,
                          fontSize: 10,
                          color: OBSERVER_COLOR[s.observer_name] ?? 'rgba(255,255,255,0.45)',
                          letterSpacing: '0.03em',
                        }}
                      >
                        {OBSERVER_LABEL[s.observer_name] ?? `${s.observer_name}·`}
                      </span>
                      <span style={{ ...MONO_CELL, fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>
                        {s.signal_kind}
                      </span>
                    </div>
                    {/* Full message text — no truncation */}
                    <div
                      style={{
                        fontFamily: MONO_FONT,
                        fontSize: 11,
                        color: 'rgba(255,255,255,0.82)',
                        lineHeight: 1.55,
                        wordBreak: 'break-word',
                        overflowWrap: 'anywhere',
                        whiteSpace: 'pre-wrap',
                      }}
                    >
                      {s.message}
                    </div>
                  </div>
                  <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, paddingTop: 2 }}>
                    {s.confidence != null && (
                      <span style={{ ...MONO_CELL, ...TABULAR, fontSize: 10, color: 'rgba(255,255,255,0.5)' }}>
                        {s.confidence.toFixed(2)}
                      </span>
                    )}
                    <span style={{ ...MONO_CELL, ...TABULAR, fontSize: 10 }}>
                      {formatAge(s.created_at)}
                    </span>
                    {!s.acknowledged && (
                      <span
                        style={{
                          width: 5,
                          height: 5,
                          borderRadius: '50%',
                          background: '#6366f1',
                          boxShadow: '0 0 4px rgba(99,102,241,0.7)',
                        }}
                      />
                    )}
                  </div>
                </div>
              ))
            )}
          </Panel>
        </div>

        {/* ─────────────────────────────────────────────────────────────────── */}
        {/* Panel 4: PERCEPTION — scrolling event log                          */}
        {/* ─────────────────────────────────────────────────────────────────── */}
        <div
          style={{
            transition: 'box-shadow 200ms ease',
            boxShadow: perceptionFlash
              ? '0 0 0 1px rgba(255,178,122,0.45)'
              : 'none',
            borderRadius: 6,
            marginBottom: 4,
          }}
        >
          <Panel
            id="perception"
            label={
              perceptionSource === 'jsonl_unavailable'
                ? 'PERCEPTION'
                : 'PERCEPTION ···'
            }
            count={perceptionEvents.length}
            pulse={false}
            maxHeight={280}
            defaultCollapsed={true}
          >
            {perceptionSource === 'jsonl_unavailable' ? (
              <div
                style={{
                  ...ROW,
                  fontFamily: MONO_FONT,
                  fontSize: 11,
                  color: 'rgba(255,255,255,0.30)',
                }}
              >
                no perception events yet
              </div>
            ) : perceptionEvents.length === 0 ? (
              <div style={{ ...ROW, ...TEXT_DIM, fontFamily: MONO_FONT }}>
                no events
              </div>
            ) : (
              perceptionEvents.map((ev, i) => {
                const opacity = Math.max(0.25, 1 - i * 0.055)
                return (
                  <div
                    key={i}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '18px 110px 1fr 36px',
                      gap: 8,
                      padding: '5px 12px',
                      borderBottom: '1px solid rgba(255,178,122,0.03)',
                      opacity,
                      alignItems: 'baseline',
                    }}
                  >
                    {/* Icon */}
                    <span
                      style={{
                        fontFamily: MONO_FONT,
                        fontSize: 11,
                        color: 'rgba(255,178,122,0.7)',
                        textAlign: 'center',
                      }}
                    >
                      {PERCEPTION_ICON[ev.type] ?? '·'}
                    </span>
                    {/* Source-id column */}
                    <span
                      style={{
                        fontFamily: MONO_FONT,
                        fontSize: 10,
                        color: 'rgba(255,255,255,0.35)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {ev.source ?? ev.type}
                    </span>
                    {/* Summary — full text, wraps naturally */}
                    <span
                      style={{
                        fontFamily: MONO_FONT,
                        fontSize: 11,
                        color: 'rgba(255,255,255,0.75)',
                        wordBreak: 'break-word',
                        overflowWrap: 'anywhere',
                        whiteSpace: 'normal',
                        lineHeight: 1.45,
                      }}
                    >
                      {ev.summary ?? ev.type}
                    </span>
                    {/* Age */}
                    <span
                      style={{
                        ...MONO_CELL,
                        ...TABULAR,
                        fontSize: 10,
                        textAlign: 'right',
                      }}
                    >
                      {formatAge(ev.timestamp)}
                    </span>
                  </div>
                )
              })
            )}
          </Panel>
        </div>

        {/* ─────────────────────────────────────────────────────────────────── */}
        {/* Panel 5: RESTARTS — pending ecodia-api restart requests             */}
        {/* ─────────────────────────────────────────────────────────────────── */}
        <div
          style={{
            transition: 'box-shadow 200ms ease',
            boxShadow: restartFlash && restartCount > 0
              ? '0 0 0 1px rgba(245,158,11,0.7)'
              : 'none',
            borderRadius: 6,
            marginBottom: 4,
          }}
        >
          <Panel
            id="restarts"
            label="RESTARTS"
            count={restartCount > 0 ? `${restartCount} pending` : 'none'}
            pulse={restartCount > 0}
            maxHeight={180}
            defaultCollapsed={restartCount === 0}
          >
            {restartCount === 0 ? (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '8px 12px',
                  fontFamily: MONO_FONT,
                  fontSize: 11,
                  color: '#22c55e',
                }}
              >
                <span
                  style={{
                    animation: 'all-clear-pulse 3s ease-in-out infinite',
                  }}
                >
                  ●
                </span>
                nothing pending
              </div>
            ) : (
              restartRequests.map((r) => (
                <div key={r.id} style={{ ...ROW, alignItems: 'flex-start' }}>
                  {/* Amber pulse dot */}
                  <span
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: '50%',
                      background: '#f59e0b',
                      boxShadow: '0 0 8px rgba(245,158,11,0.7)',
                      flexShrink: 0,
                      marginTop: 3,
                      animation: 'amber-pulse 1.5s ease-in-out infinite',
                    }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {r.requesting_fork_id && (
                      <div
                        style={{
                          fontFamily: MONO_FONT,
                          fontSize: 10,
                          color: 'rgba(255,255,255,0.35)',
                          marginBottom: 3,
                          wordBreak: 'break-all',
                        }}
                      >
                        {r.requesting_fork_id}
                      </div>
                    )}
                    {/* Full reason text — no truncation */}
                    <div
                      style={{
                        fontFamily: MONO_FONT,
                        fontSize: 12,
                        color: '#f59e0b',
                        lineHeight: 1.5,
                        wordBreak: 'break-word',
                        overflowWrap: 'anywhere',
                        whiteSpace: 'pre-wrap',
                      }}
                    >
                      {r.reason}
                    </div>
                  </div>
                  <span style={{ ...MONO_CELL, ...TABULAR, marginTop: 2, flexShrink: 0 }}>
                    {formatAge(r.requested_at)}
                  </span>
                </div>
              ))
            )}
          </Panel>
        </div>

        {/* ─────────────────────────────────────────────────────────────────── */}
        {/* Panel 6: INBOX — email unread counts by account                    */}
        {/* ─────────────────────────────────────────────────────────────────── */}
        <div
          style={{
            transition: 'box-shadow 200ms ease',
            boxShadow: inboxFlash && inboxTotal > 0
              ? '0 0 0 1px rgba(255,178,122,0.4)'
              : 'none',
            borderRadius: 6,
            marginBottom: 4,
          }}
        >
          <Panel
            id="inbox"
            label="INBOX"
            count={`${inboxTotal} unread`}
            pulse={inboxTotal > 0 && inboxIsUrgent}
            maxHeight={100}
            defaultCollapsed={true}
          >
            {/* tate@ row */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '140px 80px 1fr',
                gap: 8,
                padding: '5px 10px',
                borderBottom: '1px solid rgba(255,178,122,0.04)',
                alignItems: 'center',
              }}
            >
              <span
                style={{
                  fontFamily: MONO_FONT,
                  fontSize: 11,
                  color: 'rgba(255,255,255,0.45)',
                }}
              >
                tate@ecodia.au
              </span>
              <span
                style={{
                  fontFamily: MONO_FONT,
                  fontSize: 13,
                  fontWeight: 600,
                  ...TABULAR,
                  color: inboxTate.unread > 0 ? 'rgba(255,255,255,0.92)' : 'rgba(255,255,255,0.25)',
                }}
              >
                {inboxTate.unread} unread
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                {inboxTate.oldestAge ? (
                  <>
                    <span
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: '50%',
                        background: inboxAgeDot(inboxTate.oldestAge),
                        boxShadow: `0 0 4px ${inboxAgeDot(inboxTate.oldestAge)}`,
                        flexShrink: 0,
                      }}
                    />
                    <span style={{ ...MONO_CELL, ...TABULAR }}>
                      oldest {inboxTate.oldestAge}
                    </span>
                  </>
                ) : (
                  <span style={{ ...MONO_CELL, color: 'rgba(255,255,255,0.2)' }}>—</span>
                )}
              </div>
            </div>
            {/* code@ row */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '140px 80px 1fr',
                gap: 8,
                padding: '5px 10px',
                alignItems: 'center',
              }}
            >
              <span
                style={{
                  fontFamily: MONO_FONT,
                  fontSize: 11,
                  color: 'rgba(255,255,255,0.45)',
                }}
              >
                code@ecodia.au
              </span>
              <span
                style={{
                  fontFamily: MONO_FONT,
                  fontSize: 13,
                  fontWeight: 600,
                  ...TABULAR,
                  color: inboxCode.unread > 0 ? 'rgba(255,255,255,0.92)' : 'rgba(255,255,255,0.25)',
                }}
              >
                {inboxCode.unread} unread
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                {inboxCode.oldestAge ? (
                  <>
                    <span
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: '50%',
                        background: inboxAgeDot(inboxCode.oldestAge),
                        boxShadow: `0 0 4px ${inboxAgeDot(inboxCode.oldestAge)}`,
                        flexShrink: 0,
                      }}
                    />
                    <span style={{ ...MONO_CELL, ...TABULAR }}>
                      oldest {inboxCode.oldestAge}
                    </span>
                  </>
                ) : (
                  <span style={{ ...MONO_CELL, color: 'rgba(255,255,255,0.2)' }}>—</span>
                )}
              </div>
            </div>
          </Panel>
        </div>
        {/* ───────────────────────────────────────────────────────────────── */}
        {/* Panel 9R: P1 ALERTS — blinking critical status board rows         */}
        {/* ───────────────────────────────────────────────────────────────── */}
        {(() => {
          const p1Rows = statusRows.filter((r) => r.priority === 1)
          return (
            <Panel
              id="p1alerts"
              label="P1 ALERTS"
              count={p1Rows.length > 0 ? `${p1Rows.length} critical` : 'clear'}
              pulse={p1Rows.length > 0}
              maxHeight={220}
              defaultCollapsed={p1Rows.length === 0}
            >
              {p1Rows.length === 0 ? (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '8px 12px',
                  fontFamily: MONO_FONT, fontSize: 11, color: '#22c55e',
                }}>
                  <span style={{ animation: 'all-clear-pulse 3s ease-in-out infinite' }}>{'●'}</span>
                  nothing pending
                </div>
              ) : (
                p1Rows.map((r) => (
                  <div
                    key={r.id}
                    style={{
                      ...ROW,
                      borderLeft: '2px solid #ef4444',
                      background: 'rgba(239,68,68,0.04)',
                    }}
                  >
                    <span
                      style={{
                        width: 6, height: 6, borderRadius: '50%',
                        background: '#ef4444',
                        boxShadow: '0 0 6px rgba(239,68,68,0.55)',
                        animation: 'amber-pulse 1.5s ease-in-out infinite',
                        flexShrink: 0, marginTop: 4,
                      }}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontFamily: MONO_FONT, fontSize: 11, color: '#ef4444', fontWeight: 600, wordBreak: 'break-word' }}>
                        {r.name}
                      </div>
                      {r.next_action && (
                        <div style={{ fontFamily: MONO_FONT, fontSize: 10, color: 'rgba(255,255,255,0.40)', marginTop: 2 }}>
                          {r.next_action}
                        </div>
                      )}
                    </div>
                    <span style={{ ...MONO_CELL, ...TABULAR, marginTop: 2, flexShrink: 0, fontSize: 9 }}>
                      {formatAge(r.last_touched)}
                    </span>
                  </div>
                ))
              )}
            </Panel>
          )
        })()}

        {/* ─────────────────────────────────────────────────────────────────── */}
        {/* Panel 10R: NOTES — Haiku observer ambient notes (Phase 11)         */}
        {/* ─────────────────────────────────────────────────────────────────── */}
        <div
          style={{
            transition: 'box-shadow 200ms ease',
            boxShadow: notesFlash && notes.length > 0
              ? '0 0 0 1px rgba(212,175,55,0.4)'
              : 'none',
            borderRadius: 6,
          }}
        >
          <Panel
            id="notes"
            label="NOTES"
            count={notes.length > 0 ? String(notes.length) : ''}
            pulse={notesNewCount > 0}
            maxHeight={320}
            defaultCollapsed={false}
          >
            <NotesPanel notes={notes} />
          </Panel>
        </div>
      </div>

      {/* ── Page-local keyframes ────────────────────────────────────────────── */}
      <style>{`
        @keyframes ambient-pulse {
          0%, 100% { opacity: 0.45; transform: scale(0.85); }
          50%      { opacity: 1.00; transform: scale(1.15); }
        }
        @keyframes ambient-cursor {
          0%, 49% { opacity: 1; }
          50%, 100% { opacity: 0; }
        }
        @keyframes ambient-spin {
          to { transform: rotate(360deg); }
        }
        @keyframes ambient-ribbon {
          0%   { transform: translateX(-100%); }
          100% { transform: translateX(250%); }
        }
        @keyframes mic-glow {
          0%, 100% { box-shadow: 0 0 6px rgba(239,68,68,0.20); }
          50%      { box-shadow: 0 0 18px rgba(239,68,68,0.50); }
        }
        @keyframes panel-pulse {
          0%, 100% { opacity: 0.45; transform: scale(0.85); }
          50%      { opacity: 1;    transform: scale(1.15); }
        }
        @keyframes amber-pulse {
          0%, 100% { box-shadow: 0 0 4px rgba(245,158,11,0.4); }
          50%      { box-shadow: 0 0 12px rgba(245,158,11,0.9); }
        }
        @keyframes all-clear-pulse {
          0%, 100% { opacity: 0.55; text-shadow: 0 0 4px rgba(34,197,94,0.3); }
          50%      { opacity: 1;    text-shadow: 0 0 10px rgba(34,197,94,0.8); }
        }

        /* Phase 8: movement animations */

        /* Activity dot pulse — for LIVE/CONNECTED indicators */
        @keyframes pulse-dot {
          0%, 100% { opacity: 1; }
          50%      { opacity: 0.35; }
        }

        /* Value flash — brief gold-to-bright-yellow scale on metric update */
        @keyframes value-flash {
          0%   { color: rgba(212,175,55,0.9); transform: scale(1); }
          40%  { color: #f5c518;              transform: scale(1.06); }
          100% { color: rgba(212,175,55,0.9); transform: scale(1); }
        }

        /* Slide-in-up — new list entries (forks, chat messages, signals) */
        @keyframes slide-in-up {
          from { opacity: 0; transform: translateY(7px); }
          to   { opacity: 1; transform: translateY(0); }
        }

        /* Slide-in-right — right-rail panel entries */
        @keyframes slide-in-right {
          from { opacity: 0; transform: translateX(8px); }
          to   { opacity: 1; transform: translateX(0); }
        }

        /* Shimmer — loading skeleton for panels awaiting data */
        @keyframes shimmer {
          0%   { background-position: -200% 0; }
          100% { background-position:  200% 0; }
        }
        .ambient-shimmer {
          background: linear-gradient(90deg,
            rgba(212,175,55,0.04) 25%,
            rgba(212,175,55,0.10) 50%,
            rgba(212,175,55,0.04) 75%
          );
          background-size: 200% 100%;
          animation: shimmer 1.8s ease-in-out infinite;
          border-radius: 3px;
        }

        /* Row flash — background pulse on data update */
        @keyframes row-flash {
          0%   { background: rgba(212,175,55,0.12); }
          100% { background: transparent; }
        }

        /* Fork tag entry animation */
        .fork-tag-enter {
          animation: slide-in-up 200ms cubic-bezier(0.4,0,0.2,1) both;
        }

        /* Chat message entry */
        .ambient-msg-enter {
          animation: slide-in-up 250ms cubic-bezier(0.4,0,0.2,1) both;
        }

        /* Right-rail row entry */
        .ambient-row-enter {
          animation: slide-in-right 180ms cubic-bezier(0.4,0,0.2,1) both;
        }

        /* Chip hover — subtle lift */
        .ambient-chip:hover {
          background: rgba(212,175,55,0.04);
        }

        /* Phase 11: border-merge cohesion pass */
        /* Chip strip: shared single divider between adjacent chips */
        [data-chip-strip] > *:not(:first-child) {
          border-left: 1px solid rgba(212,175,55,0.09);
        }
        /* Rail panels: each panel owns only its bottom border, so adjacent panels
           share a single hairline naturally — no overlap hack, no z-index races. */
        [data-rail="left"] > *,
        [data-rail="right"] > * { margin: 0 !important; }
        /* Last panel: drop its bottom rule so the rail end is clean. */
        [data-rail="left"] > *:last-child,
        [data-rail="right"] > *:last-child { border-bottom: none !important; }

        /* StripRow hidden on desktop — right rail provides the same info */
        @media (min-width: 1280px) {
          .ambient-bottom-stack { display: none !important; }
        }

        /* Terminal-green scrollbars for rails */
        [data-rail="left"]::-webkit-scrollbar { width: 4px; }
        [data-rail="left"]::-webkit-scrollbar-track { background: rgba(0,0,0,0.40); }
        [data-rail="left"]::-webkit-scrollbar-thumb {
          background: rgba(34,197,94,0.45);
          border-radius: 2px;
        }
        [data-rail="left"]::-webkit-scrollbar-thumb:hover {
          background: rgba(34,197,94,0.75);
        }
        [data-rail="right"]::-webkit-scrollbar { width: 4px; }
        [data-rail="right"]::-webkit-scrollbar-track { background: rgba(0,0,0,0.40); }
        [data-rail="right"]::-webkit-scrollbar-thumb {
          background: rgba(34,197,94,0.45);
          border-radius: 2px;
        }
        [data-rail="right"]::-webkit-scrollbar-thumb:hover {
          background: rgba(34,197,94,0.75);
        }

        /* Scrollbar styling for chat region — sage/moss tint (H8) */
        .ambient-chatlog-scroll::-webkit-scrollbar { width: 5px; }
        .ambient-chatlog-scroll::-webkit-scrollbar-track { background: transparent; }
        .ambient-chatlog-scroll::-webkit-scrollbar-thumb {
          background: rgba(122,154,90,0.32);
          border-radius: 3px;
        }
        .ambient-chatlog-scroll::-webkit-scrollbar-thumb:hover {
          background: rgba(122,154,90,0.55);
        }

        /* H7: Organic watermark breathing fade — slow, 4-6s cycle */
        @keyframes organic-breathe {
          0%   { opacity: 0.04; }
          45%  { opacity: 0.09; }
          55%  { opacity: 0.09; }
          100% { opacity: 0.04; }
        }

        /* H4: Solar disc pulse — fires once on cron event, 1.1s */
        @keyframes solar-disc-pulse {
          0%   { filter: drop-shadow(0 0 0px rgba(245,197,24,0)); opacity: 0.45; }
          30%  { filter: drop-shadow(0 0 8px rgba(245,197,24,0.9)); opacity: 1; }
          70%  { filter: drop-shadow(0 0 5px rgba(245,197,24,0.55)); opacity: 0.85; }
          100% { filter: drop-shadow(0 0 0px rgba(245,197,24,0)); opacity: 0.45; }
        }

        /* Markdown rendering inside assistant bubbles */
        .ambient-md p { margin: 0; }
        .ambient-md p + p { margin-top: 0.55em; }
        .ambient-md ul, .ambient-md ol { margin: 0.4em 0; padding-left: 1.2em; }
        .ambient-md li { margin: 0.15em 0; }
        .ambient-md li > p { margin: 0; }
        .ambient-md ul { list-style: disc; }
        .ambient-md ol { list-style: decimal; }
        .ambient-md strong { color: #ffe7d2; font-weight: 600; }
        .ambient-md em { color: rgba(255,255,255,0.78); font-style: italic; }
        .ambient-md a {
          color: #ffb27a;
          text-decoration: underline;
          text-underline-offset: 2px;
          text-decoration-color: rgba(255,178,122,0.45);
        }
        .ambient-md a:hover { text-decoration-color: #ffb27a; }
        .ambient-md h1, .ambient-md h2, .ambient-md h3 {
          color: #ffe7d2;
          font-weight: 600;
          line-height: 1.3;
          margin: 0.9em 0 0.35em;
        }
        .ambient-md h1 { font-size: 1.05em; }
        .ambient-md h2 { font-size: 1.0em; }
        .ambient-md h3 { font-size: 0.95em; color: rgba(255,231,210,0.85); }
        .ambient-md hr {
          border: none;
          height: 1px;
          background: rgba(255,178,122,0.15);
          margin: 1em 0;
        }
        .ambient-md blockquote {
          border-left: 2px solid rgba(255,178,122,0.35);
          padding-left: 0.8em;
          color: rgba(255,255,255,0.72);
          font-style: italic;
          margin: 0.5em 0;
        }
        .ambient-md code {
          font-family: 'JetBrains Mono', ui-monospace, monospace;
          font-size: 0.86em;
          background: rgba(255,178,122,0.10);
          color: #ffd5b3;
          padding: 1px 5px;
          border-radius: 4px;
          border: 1px solid rgba(255,178,122,0.12);
        }
        .ambient-md pre {
          margin: 0.55em 0;
          background: rgba(0,0,0,0.40);
          border: 1px solid rgba(255,178,122,0.12);
          border-radius: 6px;
          padding: 10px 12px;
          overflow-x: auto;
        }
        .ambient-md pre code {
          background: transparent;
          border: none;
          padding: 0;
          color: #e8dcc8;
          font-size: 0.84em;
          line-height: 1.55;
        }
        .ambient-md table {
          border-collapse: collapse;
          margin: 0.55em 0;
          font-size: 0.92em;
          width: 100%;
        }
        .ambient-md th, .ambient-md td {
          border: 1px solid rgba(255,178,122,0.15);
          padding: 5px 8px;
          text-align: left;
        }
        .ambient-md th { background: rgba(255,178,122,0.08); color: #ffe7d2; }
      `}</style>
    </div>
  )
}
