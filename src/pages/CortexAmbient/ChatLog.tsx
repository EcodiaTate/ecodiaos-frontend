/**
 * ChatLog - the 2D readable chat overlay above the input panel.
 *
 * Round-4 polish, 2026-05-09, fork_moxykr7k_4cb6b2:
 *   - Bug 2 (auto-scroll yank): the previous round set the "stuck-to-bottom"
 *     threshold at 24px. That is too tight - any non-trivial scroll-up to
 *     re-read a streaming reply triggers the auto-scroll-to-bottom on every
 *     stream tick, yanking the viewport back down. Tate verbatim 16:18 AEST
 *     9 May 2026: "when you're spitting out text mid message, when I scroll
 *     back up it just yanks me back down to your latest stuff, so I can't
 *     properly read a message until it's finished".
 *   - Threshold relaxed to 80px ("follow mode"). Outside follow mode the
 *     viewport stays where the user put it; new tokens stream into the DOM
 *     but the scroll position is preserved.
 *   - "↓ N new" pill now shows a real count of new messages received while
 *     follow-mode was suspended. Tap to jump back to live + resume follow.
 *   - Pill design promoted to a more visible floating chip near bottom-right
 *     of the chat region (not the previous tiny -top-3 ember dot which was
 *     visually swallowed by the chat header).
 *   - Min-height on the scroll surface bumped so the empty state (Bug 1
 *     cramping) reserves visible space and the input + strip-row don't
 *     collapse upward on first paint. Mobile 40vh, desktop 50vh, capped.
 *
 * Round-3 bugfix, 2026-05-08, fork_mowu9a3g_f34229:
 *   - Markdown rendering: messages were being rendered as plain pre-wrapped
 *     text. Now wrapped in ReactMarkdown (remarkGfm only — no rehypeRaw to
 *     lists, code blocks, links, bold all render. Mirrors the canonical
 *     setup in src/pages/Cortex/blocks/TextBlock.tsx and CCStream.tsx.
 *   - Doctrine-noise + model-XML scaffold tags stripped before render via
 *     stripDoctrineNoise (handles <now>, <doctrine_surface>, <forks_rollup>,
 *     <recent_doctrine>, <relevant_memory>, <restart_recovery>,
 *     <recent_exchanges>, <last_turn_breadcrumb>, <perception_summary>,
 *     <skills_surface> AND [APPLIED]/[NOT-APPLIED]/[BRIEF-CHECK WARN]/etc
 *     tag-prefix lines) plus a local STRIP_TAGS regex for model scaffold
 *     tags (analysis, thinking, scratchpad, reasoning, reflection, summary,
 *     aside, plan, inner_monologue) per
 *     ~/ecodiaos/patterns/frontend-strip-model-xml-tags.md and
 *     ~/ecodiaos/patterns/system-injection-blocks-must-not-render-in-director-chat.md
 *
 * Round-2 polish, 2026-05-08, fork_mowe5tuh_f2ddd3.
 *
 * Round 1 rendered messages exclusively as 3D-Billboard text drifting up
 * a beam. That looks ambient but is functionally unreadable: you cannot
 * actually consume an assistant reply at length when the text is floating
 * in WebGL space. The 3D ChatBeam is preserved as ambience (recent message
 * cards drifting up the conductor's beam) but THIS panel is the lead
 * readable surface.
 *
 * Design rules:
 *   - Coexists with the 3D scene without occluding the conductor presence.
 *   - Top-edge fades into the scene (no hard rectangle border).
 *   - Auto-scrolls to the bottom on new messages, UNLESS the user has
 *     scrolled up - in which case a "new" pill appears so they can jump
 *     back to live.
 *   - Streams the live assistant turn token-by-token in the assistant
 *     slot when status === 'streaming'.
 *   - Newest at bottom (chat convention). Inverted-stack from the 3D beam
 *     (which renders newest at base, oldest at top) on purpose - the two
 *     surfaces serve different functions.
 *   - No emoji, no tagline, no wordmark. Typography carries the brand.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useOSSessionStore } from '@/store/osSessionStore'
import { stripDoctrineNoise } from '@/utils/stripDoctrineNoise'
import { safeUrl } from '@/utils/safeUrl'

const MAX_RENDERED = 80 // hard cap on what we render in this panel

// Model XML scaffold tags that occasionally leak into rendered text. Per
// ~/ecodiaos/patterns/frontend-strip-model-xml-tags.md - strip the tags but
// keep the inner content (the model's reasoning is sometimes load-bearing,
// just shouldn't show up as `<analysis>foo</analysis>` literal text).
const STRIP_TAGS = ['analysis', 'thinking', 'scratchpad', 'reasoning', 'reflection', 'summary', 'aside', 'plan', 'inner_monologue']
const STRIP_TAGS_RE = new RegExp(`</?(?:${STRIP_TAGS.join('|')})\\b[^>]*>`, 'gi')

function cleanForRender(raw: string): string {
  if (!raw) return ''
  // 1. system-injection blocks + tag-prefix lines (multi-line aware, fence-safe).
  const a = stripDoctrineNoise(raw)
  // 2. model-XML scaffold tags - strip only the tag pair, keep inner text.
  return a.replace(STRIP_TAGS_RE, '')
}

export function ChatLog() {
  const messages = useOSSessionStore((s) => s.messages)
  const status = useOSSessionStore((s) => s.status)
  const streamText = useOSSessionStore((s) => s.streamText)

  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [followMode, setFollowMode] = useState(true)
  // Count of new messages received while follow-mode was suspended.
  const [newCount, setNewCount] = useState(0)
  // Track the message-array length the user last "saw" at bottom so we can
  // compute newCount on subsequent length increases.
  const lastSeenLenRef = useRef(0)

  // Defensive frontend strip: observer interventions must never render as
  // chat bubbles. Backend was switched to a dedicated observer_signals
  // substrate 13 May 2026; this filter is the second line of defence in case
  // any legacy <observer source="..."> messages still flow through the
  // messages stream from older sessions.
  const recent = useMemo(
    () =>
      messages
        .filter((m) => !/^\s*<observer\s+source=/i.test(m.content || ''))
        .slice(-MAX_RENDERED),
    [messages]
  )

  // Mirror current recent.length into a ref so the onScroll handler (whose
  // deps are intentionally empty so it isn't recreated every render) reads
  // the live value instead of the stale closure value.
  const recentLenRef = useRef(0)
  useEffect(() => {
    recentLenRef.current = recent.length
  }, [recent.length])

  // Follow-resume requires being at the very bottom (16px slack for sub-pixel
  // rounding). Tate verbatim: "unless I go to the very bottom of the scroll
  // and leave it there".
  const FOLLOW_THRESHOLD_PX = 16
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onScroll = () => {
      const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
      const atBottom = distFromBottom < FOLLOW_THRESHOLD_PX
      setFollowMode(atBottom)
      if (atBottom) {
        setNewCount(0)
        lastSeenLenRef.current = recentLenRef.current
      }
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  // On message-array growth: scroll to bottom IF in follow mode; otherwise
  // bump the "N new" counter so the pill surfaces a real count.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    if (followMode) {
      el.scrollTop = el.scrollHeight
      lastSeenLenRef.current = recent.length
      setNewCount(0)
    } else {
      const delta = recent.length - lastSeenLenRef.current
      if (delta > 0) setNewCount(delta)
    }
  }, [recent.length, followMode])

  // Stream-tick: only auto-scroll if follow-mode is on. NEVER bump newCount
  // on stream tick (otherwise the pill would race up by hundreds during a
  // single assistant reply).
  useEffect(() => {
    const el = scrollRef.current
    if (!el || !followMode) return
    el.scrollTop = el.scrollHeight
  }, [streamText, followMode])

  const jumpToBottom = () => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
    setFollowMode(true)
    setNewCount(0)
    lastSeenLenRef.current = recent.length
  }

  const isStreaming = status === 'streaming'
  const isError = status === 'error'

  // If empty and idle, render nothing (the input panel carries the moment).
  if (recent.length === 0 && !isStreaming && !isError) return null

  return (
    <div className="ambient-chatlog relative w-full" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div className="relative" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', width: '100%' }}>
        {/* Scroll surface — fills the flex parent so the last message never
            disappears under the input panel. flex:1 + minHeight:0 is the
            canonical CSS pattern for a scrollable child inside a flex column.
            Full-bleed: no border or rounded corners — the rails (or screen edge
            on mobile) bound this region, and the chat input shares its top edge. */}
        <div
          ref={scrollRef}
          className="ambient-chatlog-scroll"
          role="log"
          aria-live="polite"
          aria-relevant="additions text"
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            // Smooth jump-to-bottom but doesn't smooth ordinary user scrolls.
            scrollBehavior: 'auto',
            background: 'linear-gradient(180deg, rgba(8,10,14,0.55) 0%, rgba(6,7,10,0.78) 100%)',
            scrollbarWidth: 'thin',
            scrollbarColor: 'rgba(212,175,55,0.28) transparent',
          }}
        >
          <div className="px-3 sm:px-5 pt-4 space-y-4" style={{ paddingBottom: 32 }}>
            {recent.map((m) => (
              <div key={m.id} className="ambient-msg-enter">
                <Bubble role={m.role} content={m.content} />
              </div>
            ))}
            {isStreaming && (
              <Bubble role="assistant" content={streamText} streaming />
            )}
            {isError && recent[recent.length - 1]?.role === 'user' && (
              <ErrorLine />
            )}
          </div>
        </div>

        {/* Floating "↓ N new" pill when user has scrolled up beyond
            FOLLOW_THRESHOLD_PX. Tap to jump back to live + resume follow.
            Positioned bottom-right of the chat region (not -top-3) so it's
            visible whether the user is mid-scroll or near the bottom edge. */}
        {!followMode && (
          <button
            type="button"
            onClick={jumpToBottom}
            aria-label={
              newCount > 0
                ? `${newCount} new ${newCount === 1 ? 'message' : 'messages'} - jump to bottom`
                : 'jump to bottom'
            }
            className="absolute right-3 bottom-3 rounded-full px-3 py-1.5 text-[10px] font-medium shadow-lg transition-transform hover:scale-105"
            style={{
              background: '#ffb27a',
              color: '#06070a',
              letterSpacing: '0.05em',
              fontFamily: "'JetBrains Mono', ui-monospace, monospace",
              boxShadow: '0 4px 16px rgba(255,178,122,0.45), 0 0 12px rgba(255,178,122,0.35)',
              border: '1px solid rgba(255,178,122,0.85)',
              zIndex: 5,
            }}
          >
            ↓ {newCount > 0 ? `${newCount} new` : 'jump to live'}
          </button>
        )}
      </div>
    </div>
  )
}

interface BubbleProps {
  role: 'user' | 'assistant'
  content: string
  streaming?: boolean
}

function Bubble({ role, content, streaming = false }: BubbleProps) {
  const isUser = role === 'user'
  const cleaned = useMemo(() => cleanForRender(content), [content])

  // User messages stay as plain text (mono, preserves whitespace) so pasted
  // logs / commands render verbatim. Assistant messages render markdown.
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <span
          className="text-[9px] uppercase tracking-[0.28em]"
          style={{ color: isUser ? '#f0a847' : '#ffb27a' }}
        >
          {isUser ? 'tate' : 'ecodiaos'}
        </span>
        {streaming && <StreamDot />}
      </div>
      {isUser ? (
        <div
          className="text-[13.5px] leading-[1.55] whitespace-pre-wrap break-words"
          style={{
            color: 'rgba(232,236,242,0.92)',
            fontFamily: "'JetBrains Mono', ui-monospace, monospace",
            overflowWrap: 'anywhere',
            wordBreak: 'break-word',
          }}
        >
          {cleaned}
          {streaming && <Cursor />}
        </div>
      ) : (
        <div
          className="ambient-md text-[13.5px] leading-[1.6] break-words"
          style={{
            color: 'rgba(255,255,255,0.97)',
            fontFamily: "'Inter', system-ui, sans-serif",
            overflowWrap: 'anywhere',
            wordBreak: 'break-word',
          }}
        >
          {cleaned ? (
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              urlTransform={safeUrl}
            >
              {cleaned}
            </ReactMarkdown>
          ) : streaming ? (
            <Cursor />
          ) : null}
          {streaming && cleaned ? <Cursor /> : null}
        </div>
      )}
    </div>
  )
}

function StreamDot() {
  return (
    <span
      className="inline-block h-1.5 w-1.5 rounded-full"
      style={{
        background: '#ffb27a',
        boxShadow: '0 0 6px rgba(255,178,122,0.85)',
        animation: 'ambient-pulse 1.1s ease-in-out infinite',
      }}
    />
  )
}

function Cursor() {
  return (
    <span
      className="inline-block align-middle"
      style={{
        width: '2px',
        height: '0.95em',
        marginLeft: '1px',
        background: '#ffb27a',
        boxShadow: '0 0 5px rgba(255,178,122,0.8)',
        animation: 'ambient-cursor 0.95s steps(2) infinite',
        verticalAlign: '-2px',
      }}
    />
  )
}

function ErrorLine() {
  return (
    <div className="text-[12px] uppercase tracking-[0.18em] text-[#e85a5a]">
      stream interrupted - retry the message
    </div>
  )
}
