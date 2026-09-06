/**
 * NotesPanel — ambient Haiku observer notes for the right rail.
 *
 * Accepts notes data from parent (index.tsx already polls via useNotes)
 * to avoid double-polling. Falls back to its own internal useNotes if
 * called standalone.
 *
 * Renders the last 8 non-expired notes newest-first as minimal 2-line cards:
 *   - small-caps colored listener label + relative timestamp
 *   - note text in mono
 *
 * New notes slide in from the bottom with a breathing-fade.
 * Matches Phase 9+ solarpunk-hacker aesthetic.
 *
 * Origin: fork_mp3ziqzn_34ac39, Phase 11, 2026-05-13.
 */

import { useRef } from 'react'
import { useNotes, type DashboardNote } from './useNotes'

const MONO = "'JetBrains Mono', 'SF Mono', Consolas, ui-monospace, monospace"

const LISTENER_COLORS: Record<string, string> = {
  pattern:    '#d4af37',
  cadence:    '#5ad9c8',
  connection: '#a47cff',
  progress:   '#22c55e',
}

function listenerColor(name: string): string {
  return LISTENER_COLORS[name] ?? 'rgba(255,178,122,0.7)'
}

function formatAge(iso: string): string {
  const secs = (Date.now() - new Date(iso).getTime()) / 1000
  if (secs < 60) return `${Math.floor(secs)}s`
  if (secs < 3600) return `${Math.floor(secs / 60)}m`
  if (secs < 86400) return `${Math.floor(secs / 3600)}h`
  return `${Math.floor(secs / 86400)}d`
}

interface NotesPanelProps {
  /** Pass notes from parent to avoid double-polling. Falls back to internal hook if omitted. */
  notes?: DashboardNote[]
}

export function NotesPanel({ notes: notesProp }: NotesPanelProps) {
  // Only poll internally if parent didn't supply data
  const { notes: hookNotes } = useNotes(notesProp !== undefined ? 0 : 8)
  const notes = notesProp ?? hookNotes

  const seenRef = useRef<Set<string>>(new Set())

  return (
    <>
      <style>{`
        @keyframes note-slide-in {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes note-breathe {
          0%, 100% { opacity: 0.88; }
          50%       { opacity: 1; }
        }
      `}</style>

      {notes.length === 0 ? (
        <div
          style={{
            padding: '8px 12px',
            fontFamily: MONO,
            fontSize: 11,
            color: 'rgba(255,255,255,0.22)',
            letterSpacing: '0.04em',
          }}
        >
          no observer notes
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {notes.map((note, i) => {
            const isNew = !seenRef.current.has(note.id)
            if (isNew) seenRef.current.add(note.id)
            const color = listenerColor(note.listener_name)
            const isLast = i === notes.length - 1

            return (
              <div
                key={note.id}
                style={{
                  padding: '7px 12px 8px',
                  borderBottom: isLast ? 'none' : '1px solid rgba(255,178,122,0.04)',
                  animation: isNew
                    ? 'note-slide-in 350ms ease forwards'
                    : undefined,
                }}
              >
                {/* Label row */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    marginBottom: 4,
                  }}
                >
                  <span
                    style={{
                      fontFamily: MONO,
                      fontSize: 9,
                      fontVariant: 'small-caps',
                      letterSpacing: '0.1em',
                      color,
                      textTransform: 'uppercase',
                      flexShrink: 0,
                    }}
                  >
                    {note.listener_name}
                  </span>
                  <span
                    style={{
                      fontFamily: MONO,
                      fontSize: 9,
                      color: 'rgba(255,255,255,0.25)',
                      fontVariantNumeric: 'tabular-nums',
                      flexShrink: 0,
                    }}
                  >
                    {formatAge(note.created_at)} ago
                  </span>
                </div>

                {/* Note text */}
                <div
                  style={{
                    fontFamily: MONO,
                    fontSize: 11,
                    lineHeight: 1.55,
                    color: 'rgba(255,255,255,0.82)',
                    wordBreak: 'break-word',
                    overflowWrap: 'anywhere',
                    whiteSpace: 'normal',
                    animation: isNew ? 'note-breathe 2s ease-in-out 1' : undefined,
                  }}
                >
                  {note.note_text}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}
