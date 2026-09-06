import { describe, it, expect } from 'vitest'
import { stripDoctrineNoise } from '../stripDoctrineNoise'

describe('stripDoctrineNoise', () => {
  it('returns empty string for empty input', () => {
    expect(stripDoctrineNoise('')).toBe('')
  })

  it('passes through clean text untouched', () => {
    const input = 'Hello Tate, here is what I shipped today.'
    expect(stripDoctrineNoise(input)).toBe(input)
  })

  it('strips a leading [APPLIED] tag line', () => {
    const input = '[APPLIED] ~/ecodiaos/patterns/foo.md because reasons\n\nReal content here.'
    expect(stripDoctrineNoise(input)).toBe('Real content here.')
  })

  it('strips a leading [NOT-APPLIED] tag line', () => {
    const input = '[NOT-APPLIED] foo.md because reasons\nResponse text.'
    expect(stripDoctrineNoise(input)).toBe('Response text.')
  })

  it('strips [FORK-NUDGE] lines', () => {
    const input = '[FORK-NUDGE] Bash call carries forkable signals\n\nDoing work.'
    expect(stripDoctrineNoise(input)).toBe('Doing work.')
  })

  it('strips multiple tag-prefix line classes in one message', () => {
    const input = [
      '[APPLIED] foo.md because x',
      '[CONTEXT-SURFACE WARN] keyword=foo',
      '[CRED-SURFACE WARN] target=bar',
      '[FORCING WARN] tag missing',
      '[INFO] cross-ref to baz',
      'Actual response.',
    ].join('\n')
    expect(stripDoctrineNoise(input)).toBe('Actual response.')
  })

  it('strips XML continuity blocks like <now>...</now>', () => {
    const input = '<now>Fri, 1 May 2026, 17:30 AEST</now>\n\nReal reply.'
    expect(stripDoctrineNoise(input)).toBe('Real reply.')
  })

  it('strips multi-line continuity blocks', () => {
    const input =
      '<doctrine_surface>\n- pattern A\n- pattern B\n</doctrine_surface>\n\nVisible content.'
    expect(stripDoctrineNoise(input)).toBe('Visible content.')
  })

  it('strips multiple distinct continuity blocks', () => {
    const input =
      '<now>17:30</now>\n<forks_rollup>fork_x running</forks_rollup>\n<recent_doctrine>x</recent_doctrine>\n\nReply text.'
    expect(stripDoctrineNoise(input)).toBe('Reply text.')
  })

  it('preserves [APPLIED] mention inside a fenced code block (regression case)', () => {
    const input = 'Example:\n```python\n[APPLIED] should-not-strip\nprint("hi")\n```\nDone.'
    const out = stripDoctrineNoise(input)
    expect(out).toContain('[APPLIED] should-not-strip')
    expect(out).toContain('print("hi")')
    expect(out).toContain('Done.')
  })

  it('preserves <now>...</now> inside a fenced code block', () => {
    const input = '```\n<now>2026-05-01</now>\n```\nrest.'
    const out = stripDoctrineNoise(input)
    expect(out).toContain('<now>2026-05-01</now>')
    expect(out).toContain('rest.')
  })

  it('preserves inline mentions like the [APPLIED] tag in prose', () => {
    // Inline because the line starts with prose, not the tag.
    const input = 'The pattern is the [APPLIED] tag protocol works by scanning.'
    expect(stripDoctrineNoise(input)).toBe(input)
  })

  it('handles a tag-only message by returning empty string', () => {
    const input = '[APPLIED] foo.md because bar'
    expect(stripDoctrineNoise(input)).toBe('')
  })

  it('strips tag with leading whitespace', () => {
    const input = '   [APPLIED] foo.md because x\n\nKeep this.'
    expect(stripDoctrineNoise(input)).toBe('Keep this.')
  })

  it('collapses 3+ blank lines left by stripped blocks into 2', () => {
    const input = 'Line A.\n\n\n\n[APPLIED] foo because\n\n\n\nLine B.'
    const out = stripDoctrineNoise(input)
    expect(out).toBe('Line A.\n\nLine B.')
  })

  it('strips both tag lines and continuity blocks together', () => {
    const input = [
      '<now>17:30 AEST</now>',
      '[APPLIED] foo.md because x',
      '',
      'Hi Tate, deploy is live.',
      '[FORCING WARN] something',
    ].join('\n')
    expect(stripDoctrineNoise(input)).toBe('Hi Tate, deploy is live.')
  })

  it('returns empty for null-ish coerced empty', () => {
    expect(stripDoctrineNoise('   \n\n  ')).toBe('')
  })

  it('strips [SCHEDULED: name] header lines', () => {
    const input = '[SCHEDULED: morning-briefing]\n\nBriefing content.'
    expect(stripDoctrineNoise(input)).toBe('Briefing content.')
  })
})
