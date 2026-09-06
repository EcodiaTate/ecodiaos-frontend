/**
 * stripDoctrineNoise
 * ------------------
 * Removes doctrine/telemetry noise from assistant text BEFORE it renders to Tate.
 *
 * Removes two surface classes:
 *   1. LINE-PREFIX tag lines: [APPLIED], [NOT-APPLIED], [FORK-NUDGE], [BRIEF-CHECK WARN], etc.
 *      These are conductor-level acknowledgements meant for telemetry / hook scanning, not chat.
 *   2. XML-style continuity blocks: <now>...</now>, <doctrine_surface>...</doctrine_surface>, etc.
 *      These are SDK prompt continuity blocks that should never reach human-rendered surfaces.
 *
 * Code-block contents inside fenced ``` ``` blocks are PRESERVED so doctrine examples can be
 * quoted verbatim in chat without being filtered.
 *
 * Origin: 1 May 2026 - chat-pollution-audit-2026-04-30.md Option A.
 * See ~/ecodiaos/patterns/system-injection-blocks-must-not-render-in-director-chat.md
 *     ~/ecodiaos/patterns/cron-fire-responses-do-not-emit-applied-tags-as-chat-output.md
 */

// Match a tag-prefix line at start-of-line. Anchored: leading non-whitespace
// must be `[ALL-CAPS-NAME]` or `[ALL-CAPS-NAME: detail]`, followed by anything
// on the same line. Generalised so new backend tags are stripped without
// requiring a frontend deploy. Inline uses like "the [APPLIED] tag" are
// preserved because we require the bracket at line-start.
//
// Allow-list any tag families we WANT to surface to the user (currently none).
const TAG_LINE_RE =
  /^\s*\[[A-Z][A-Z0-9\-]*(?:\s+[A-Z0-9\-]+)*(?::[^\]\n]*)?\][^\n]*$/

// Continuity blocks: a closed enum kept in sync with backend SDK prompt
// continuity. Adding a new block name requires a frontend deploy — that's
// the trade we make to avoid stripping legitimate inline HTML like <i>,
// <details>, <summary>. Adding `now` (the time-of-day banner) makes this
// list non-purely-snake_case so we keep the OR alternation pattern.
const CONTINUITY_BLOCK_RE =
  /<(now|doctrine_surface|forks_rollup|recent_doctrine|relevant_memory|restart_recovery|recent_exchanges|last_turn_breadcrumb|skills_surface|perception_summary|observer_signals|observer_critical|status_board_surface)>[\s\S]*?<\/\1>/g

/**
 * Split text into segments alternating non-fence and fence ranges so we can
 * preserve fence content while filtering elsewhere.
 */
function splitByFences(text: string): Array<{ inFence: boolean; content: string }> {
  const segments: Array<{ inFence: boolean; content: string }> = []
  // Match triple-backtick fences anchored at line-start (with up to 3 leading
  // spaces per CommonMark). Lazy + multiline so each fence is its own segment;
  // inline `` `code` `` and stray ``` mid-prose don't open a phantom fence.
  const fenceRe = /(^|\n) {0,3}```[\s\S]*?\n {0,3}```/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = fenceRe.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ inFence: false, content: text.slice(lastIndex, match.index) })
    }
    segments.push({ inFence: true, content: match[0] })
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < text.length) {
    segments.push({ inFence: false, content: text.slice(lastIndex) })
  }
  return segments
}

/**
 * Strip doctrine noise from a non-fenced segment.
 */
function stripFromSegment(segment: string): string {
  // Remove XML continuity blocks first (multi-line strip)
  let out = segment.replace(CONTINUITY_BLOCK_RE, '')

  // Remove tag-prefix lines line-by-line.
  const lines = out.split('\n')
  const kept = lines.filter(line => !TAG_LINE_RE.test(line))
  out = kept.join('\n')

  // Collapse 3+ consecutive blank lines into 2 to avoid huge gaps left by stripped blocks.
  out = out.replace(/\n{3,}/g, '\n\n')

  return out
}

/**
 * Public API.
 *
 * @param text The raw assistant text (markdown ok).
 * @returns Same text with doctrine noise removed. Empty input returns empty string.
 */
export function stripDoctrineNoise(text: string): string {
  if (!text) return ''
  const segments = splitByFences(text)
  const cleaned = segments.map(seg => (seg.inFence ? seg.content : stripFromSegment(seg.content)))
  // Trim leading/trailing whitespace artefacts left by stripped opening/closing blocks.
  return cleaned.join('').replace(/^\s+|\s+$/g, '')
}

export default stripDoctrineNoise
