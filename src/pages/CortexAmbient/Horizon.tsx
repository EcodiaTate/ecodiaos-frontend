/**
 * Horizon - the breathing oscilloscope band.
 *
 * Phase 4 upgrade (fork_mp3pkavh_12c438): multi-dimensional encoding.
 *   1. Color by mode — idle (ember), thinking (bright amber), streaming (hot orange)
 *   2. Secondary fork-density path — second polyline, opacity ∝ running fork count
 *   3. Event pips — SVG circles that spike briefly on fork-spawn / fork-done events
 *   4. Right-side counter overlay — "N forks · K tok · $cost/turn" (30s poll)
 *   5. CRT scan line — faint horizontal sweep every 4s (CSS keyframe, GPU composited)
 *
 * Round-3 baseline (fork_mowtxg3d_302865). Spec §D + §4 Panel 0.
 *
 * Implementation rules (per spec §8):
 *   - Single rAF loop drives both SVG paths. <1.2ms/frame total.
 *   - No filters, no gradient repaints, no per-pixel work.
 *   - Color changes via SVG attribute mutation (no style recalc).
 *   - Bails when document.hidden OR prefers-reduced-motion: reduce.
 *   - Secondary path: one extra polyline (120 samples), same rAF, negligible cost.
 *   - Event pips: React state array; each pip is one SVG circle + CSS keyframe.
 *     Pip lifetime: 1.2s. At most 8 pips alive simultaneously (queue drains oldest).
 *   - Counter overlay: React state, updated every 30s via setTimeout.
 *   - CRT scan line: absolutely-positioned div, CSS animation only (opacity 0.04).
 */
import { useEffect, useRef, useState, useCallback } from 'react'
import { useOSSessionStore } from '@/store/osSessionStore'
import { AMBIENT_PALETTE } from './palette'

// ── Constants ────────────────────────────────────────────────────────────────

const W       = 1440  // viewBox width (high-res for retina)
const H       = 60    // viewBox height
const MID     = H / 2
const SAMPLES = 240   // main path polyline resolution
const SEC_SAMPLES = 120  // secondary path (half res, adequate for blob shape)
const MAX_PIPS = 8

// ── Types ────────────────────────────────────────────────────────────────────

type HorizonMode = 'idle' | 'thinking' | 'streaming'

interface FrameState {
  mode: HorizonMode
  t0: number
  phase: number
}

interface Pip {
  id: number
  x: number          // 0-W
  type: 'spawn' | 'done'
  createdAt: number  // performance.now()
}

// ── Mode encoding ─────────────────────────────────────────────────────────────

function modeColor(mode: HorizonMode): string {
  switch (mode) {
    case 'streaming': return '#ff6a10'   // hot amber-orange
    case 'thinking':  return '#ff9a4a'   // bright ember
    case 'idle':      return '#ffb27a'   // soft ember (= AMBIENT_PALETTE.coreGlow)
  }
}

function modeAmplitude(mode: HorizonMode): number {
  switch (mode) {
    case 'streaming': return 18
    case 'thinking':  return 6
    case 'idle':      return 1.4
  }
}

function modeFreq(mode: HorizonMode): number {
  switch (mode) {
    case 'streaming': return 0.045
    case 'thinking':  return 0.022
    case 'idle':      return 0.014
  }
}

// ── ECG beat (idle only) ──────────────────────────────────────────────────────

function ecgBeat(elapsedSec: number): number {
  const period = 5.8
  const tau = elapsedSec % period
  if (tau > 0.9) return 0
  const beats: Array<[number, number, number]> = [
    [0.10,  0.5, 0.040],  // P
    [0.30, -1.6, 0.022],  // Q
    [0.36,  9.0, 0.014],  // R (spike)
    [0.42, -3.2, 0.025],  // S
    [0.66,  1.2, 0.060],  // T
  ]
  let v = 0
  for (const [centre, height, sigma] of beats) {
    const dt = tau - centre
    v += height * Math.exp(-(dt * dt) / (2 * sigma * sigma))
  }
  return v
}

// ── Path builders ─────────────────────────────────────────────────────────────

function buildMainPath(mode: HorizonMode, phase: number, elapsedSec: number): string {
  const amp      = modeAmplitude(mode)
  const freq     = modeFreq(mode)
  const idleBeat = mode === 'idle' ? ecgBeat(elapsedSec) : 0

  let d = ''
  for (let i = 0; i <= SAMPLES; i++) {
    const x    = (i / SAMPLES) * W
    const wave = Math.sin(i * freq + phase) * amp
      + (mode === 'streaming' ? Math.sin(i * freq * 2.7 + phase * 1.3) * amp * 0.35 : 0)
    const y    = MID - wave - idleBeat * 1.4
    d += i === 0 ? `M ${x.toFixed(1)} ${y.toFixed(1)}` : ` L ${x.toFixed(1)} ${y.toFixed(1)}`
  }
  return d
}

/** Secondary blob path: low amplitude wave offset 14px below midline,
 *  opacity driven by fork count in the parent. */
function buildSecondaryPath(phase: number, forks: number): string {
  const amp  = Math.min(4, 1 + forks * 0.9)   // 1px at 0 forks → 4px at 3+ forks
  const freq = 0.018
  const BASE = MID + 14

  let d = ''
  for (let i = 0; i <= SEC_SAMPLES; i++) {
    const x = (i / SEC_SAMPLES) * W
    const y = BASE - Math.sin(i * freq + phase * 0.7) * amp
    d += i === 0 ? `M ${x.toFixed(1)} ${y.toFixed(1)}` : ` L ${x.toFixed(1)} ${y.toFixed(1)}`
  }
  return d
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface HorizonProps {
  runningForks: number
  /** Override rendered height (default 30). Used when Horizon fills a merged header row. */
  height?: number
}

// ── Component ─────────────────────────────────────────────────────────────────

export function Horizon({ runningForks, height: renderHeight = 30 }: HorizonProps) {
  const mainPathRef = useRef<SVGPathElement | null>(null)
  const secPathRef  = useRef<SVGPathElement | null>(null)
  const stateRef    = useRef<FrameState>({
    mode:  'idle',
    t0:    typeof performance !== 'undefined' ? performance.now() : Date.now(),
    phase: 0,
  })
  const prevForksRef = useRef(runningForks)

  const status = useOSSessionStore((s) => s.status)

  // ── Pips state ──────────────────────────────────────────────────────────────
  const [pips, setPips] = useState<Pip[]>([])
  const pipIdRef = useRef(0)

  const addPip = useCallback((type: 'spawn' | 'done') => {
    const id = ++pipIdRef.current
    const x  = 80 + Math.random() * (W - 160)   // avoid edges
    setPips((prev) => {
      const next = [...prev, { id, x, type, createdAt: performance.now() }]
      return next.length > MAX_PIPS ? next.slice(next.length - MAX_PIPS) : next
    })
    // Auto-remove after animation (1.4s)
    setTimeout(() => {
      setPips((prev) => prev.filter((p) => p.id !== id))
    }, 1400)
  }, [])

  // Emit pips when fork count changes
  useEffect(() => {
    const prev = prevForksRef.current
    if (runningForks > prev) {
      for (let i = 0; i < runningForks - prev; i++) addPip('spawn')
    } else if (runningForks < prev) {
      for (let i = 0; i < prev - runningForks; i++) addPip('done')
    }
    prevForksRef.current = runningForks
  }, [runningForks, addPip])

  // ── Mode selection ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (status === 'streaming')   stateRef.current.mode = 'streaming'
    else if (runningForks > 0)    stateRef.current.mode = 'thinking'
    else                          stateRef.current.mode = 'idle'
  }, [status, runningForks])

  // ── rAF loop ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    const reducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

    if (reducedMotion) {
      mainPathRef.current?.setAttribute('d', `M 0 ${MID} L ${W} ${MID}`)
      return
    }

    let raf  = 0
    let lastT = performance.now()

    const tick = (now: number) => {
      raf = window.requestAnimationFrame(tick)
      if (document.hidden) return

      const dt = Math.min(64, now - lastT)
      lastT = now
      const s = stateRef.current

      const phaseSpeed = s.mode === 'streaming' ? 0.012 : s.mode === 'thinking' ? 0.006 : 0.0028
      s.phase += phaseSpeed * dt

      const elapsedSec = (now - s.t0) / 1000

      // Main path: update d attribute + stroke color
      if (mainPathRef.current) {
        mainPathRef.current.setAttribute('d', buildMainPath(s.mode, s.phase, elapsedSec))
        mainPathRef.current.setAttribute('stroke', modeColor(s.mode))
      }

      // Secondary path: update d attribute (opacity set via style prop, not here)
      if (secPathRef.current) {
        secPathRef.current.setAttribute('d', buildSecondaryPath(s.phase, runningForks))
      }
    }

    raf = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(raf)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])   // intentionally empty — stateRef.current is mutated, runningForks read live

  // ── Secondary path opacity ───────────────────────────────────────────────────
  const secOpacity = runningForks === 0 ? 0 : Math.min(0.45, 0.12 + runningForks * 0.11)

  return (
    <div
      aria-hidden
      className="ambient-horizon"
      style={{
        position: 'relative',
        height: renderHeight,
        background: 'transparent',
        overflow: 'hidden',
      }}
    >
      {/* ── SVG canvas ── */}
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        width="100%"
        height="100%"
        style={{ display: 'block' }}
      >
        {/* Secondary fork-density path */}
        <path
          ref={secPathRef}
          fill="none"
          stroke={AMBIENT_PALETTE.coreGlow}
          strokeWidth={1.0}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={secOpacity}
          style={{ transition: 'opacity 800ms ease' }}
          d={`M 0 ${MID + 14} L ${W} ${MID + 14}`}
        />

        {/* Main oscilloscope path */}
        <path
          ref={mainPathRef}
          fill="none"
          stroke={AMBIENT_PALETTE.coreGlow}
          strokeWidth={1.2}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={0.78}
          d={`M 0 ${MID} L ${W} ${MID}`}
        />

        {/* Event pip circles */}
        {pips.map((pip) => (
          <circle
            key={pip.id}
            cx={pip.x / (W / 100) + '%'}
            cy={MID}
            r={3}
            fill={pip.type === 'spawn' ? '#ff9a4a' : '#22c55e'}
            style={{
              animation: 'horizon-pip-decay 1.2s ease-out forwards',
            }}
          />
        ))}
      </svg>

      {/* Counter overlay removed — info now in header stat chips */}

      {/* ── CRT scan line ── */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          height: 1,
          background: 'rgba(255,255,255,0.04)',
          animation: 'horizon-crt-scan 4s linear infinite',
          pointerEvents: 'none',
          willChange: 'transform',
        }}
      />

      {/* ── Keyframes ── */}
      <style>{`
        @keyframes horizon-pip-decay {
          0%   { opacity: 0.9; r: 3; }
          40%  { opacity: 0.7; r: 5; }
          100% { opacity: 0;   r: 2; }
        }
        @keyframes horizon-crt-scan {
          0%   { top: -1px; }
          100% { top: ${renderHeight + 1}px; }
        }
      `}</style>
    </div>
  )
}
