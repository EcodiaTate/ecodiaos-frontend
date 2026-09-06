/**
 * StripRow - the always-visible condensed forks + working-memory strip.
 *
 * Round-4 polish, 2026-05-09, fork_moxykr7k_4cb6b2.
 *
 * Authored to fix Bug 1 (cramping): on the empty state ChatLog had no
 * min-height so the input + the full ForksStrip + StatusThreads all
 * collapsed up under the presence header in a single jam. Once messages
 * arrived, the page-scroll buried the forks + status sections off the fold.
 *
 * This component is a SHORT condensed always-visible bar that sits in the
 * sticky-bottom region with the input. It shows:
 *   - "hands · N forks" with each running fork as a 4-6char tag
 *   - "·" separator
 *   - "working memory · M threads" with the top-1-priority row name
 *
 * Mobile: collapses to a single horizontal scrollable line so it never
 * eats vertical space.
 * Desktop (>=1024px): both halves render inline side-by-side with
 * generous breathing room.
 *
 * The full ForksStrip + StatusThreads sections still render below the
 * sticky region for users who scroll down past the chat - this strip is
 * an at-a-glance summary, not a replacement.
 */
import { type ForkRow } from './useForks'
import { type StatusRow } from './useStatusBoard'
import { AMBIENT_PALETTE, forkStatusColor, actionByColor } from './palette'

interface StripRowProps {
  forks: ForkRow[]
  rows: StatusRow[]
}

const RUNNING = new Set(['spawning', 'running', 'reporting'])

function shortId(id: string | null | undefined): string {
  if (!id) return '------'
  return String(id).slice(-6)
}

function topPriority(rows: StatusRow[]): StatusRow | null {
  if (rows.length === 0) return null
  return [...rows].sort((a, b) => {
    const pa = a.priority ?? 99
    const pb = b.priority ?? 99
    if (pa !== pb) return pa - pb
    const ta = new Date(a.last_touched || 0).getTime()
    const tb = new Date(b.last_touched || 0).getTime()
    return tb - ta
  })[0]
}

function priorityLabel(p: number | null | undefined): string {
  return `P${p ?? 5}`
}

export function StripRow({ forks, rows }: StripRowProps) {
  const running = forks.filter((f) => RUNNING.has(String(f.status)))
  const top = topPriority(rows)

  return (
    <div
      className="ambient-strip-row w-full px-4 pb-2 pt-1"
      style={{
        background:
          'linear-gradient(180deg, rgba(6,7,10,0.94) 0%, rgba(6,7,10,1) 100%)',
        borderTop: '1px solid rgba(255,178,122,0.10)',
        fontFamily: "'JetBrains Mono', ui-monospace, monospace",
      }}
    >
      <div
        className="mx-auto flex flex-nowrap items-center gap-3 overflow-x-auto lg:gap-5"
        style={{
          maxWidth: 1024,
          scrollbarWidth: 'none',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        {/* HANDS half */}
        <div className="flex flex-shrink-0 items-center gap-2 whitespace-nowrap">
          <span
            className="text-[9px] uppercase tracking-[0.22em]"
            style={{
              color: AMBIENT_PALETTE.textDim,
              opacity: running.length === 0 ? 0.55 : 0.85,
            }}
          >
            hands · {running.length}
          </span>
          {running.length === 0 ? (
            <span
              className="text-[10px]"
              style={{ color: AMBIENT_PALETTE.textDim, opacity: 0.55 }}
            >
              quiet
            </span>
          ) : (
            <div className="flex items-center gap-1.5">
              {running.slice(0, 5).map((f) => (
                <ForkTag key={f.fork_id} fork={f} />
              ))}
              {running.length > 5 ? (
                <span
                  className="text-[10px]"
                  style={{ color: AMBIENT_PALETTE.textDim }}
                >
                  +{running.length - 5}
                </span>
              ) : null}
            </div>
          )}
        </div>

        {/* separator */}
        <span
          aria-hidden
          className="hidden flex-shrink-0 lg:inline"
          style={{
            color: AMBIENT_PALETTE.textDim,
            opacity: 0.4,
          }}
        >
          ·
        </span>

        {/* WORKING MEMORY half */}
        <div
          className="flex min-w-0 flex-shrink items-center gap-2 whitespace-nowrap"
          style={{ flex: '1 1 auto' }}
        >
          <span
            className="text-[9px] uppercase tracking-[0.22em]"
            style={{
              color: AMBIENT_PALETTE.textDim,
              opacity: rows.length === 0 ? 0.55 : 0.85,
            }}
          >
            working memory · {rows.length}
          </span>
          {top ? (
            <span
              className="truncate text-[11px]"
              style={{
                color: actionByColor(top.next_action_by),
                opacity: 0.85,
                minWidth: 0,
                maxWidth: 280,
              }}
              title={top.name}
            >
              <span
                style={{
                  display: 'inline-block',
                  marginRight: 6,
                  padding: '0 4px',
                  borderRadius: 2,
                  background: 'rgba(255,178,122,0.10)',
                  color: AMBIENT_PALETTE.coreGlow,
                  fontSize: 9,
                  letterSpacing: '0.06em',
                }}
              >
                {priorityLabel(top.priority)}
              </span>
              {top.name}
            </span>
          ) : (
            <span
              className="text-[10px]"
              style={{ color: AMBIENT_PALETTE.textDim, opacity: 0.55 }}
            >
              nothing
            </span>
          )}
        </div>
      </div>

      <style>{`
        .ambient-strip-row > div::-webkit-scrollbar { display: none; }
      `}</style>
    </div>
  )
}

function ForkTag({ fork }: { fork: ForkRow }) {
  const { color } = forkStatusColor(String(fork.status))
  const isRunning = RUNNING.has(String(fork.status))
  return (
    <span
      className="inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[10px]"
      style={{
        background: 'rgba(255,178,122,0.06)',
        border: `1px solid ${isRunning ? 'rgba(255,178,122,0.28)' : 'rgba(255,255,255,0.06)'}`,
        color: AMBIENT_PALETTE.text,
        letterSpacing: '0.04em',
      }}
      title={fork.brief ? String(fork.brief).slice(0, 120) : ''}
    >
      <span
        aria-hidden
        style={{
          display: 'inline-block',
          width: 6,
          height: 6,
          borderRadius: 999,
          background: color,
          boxShadow: isRunning ? `0 0 4px ${color}` : 'none',
        }}
      />
      {shortId(fork.fork_id)}
    </span>
  )
}
