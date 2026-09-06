/**
 * Panel — collapsible named panel for the dashboard rails.
 *
 * Phase 1 (fork_mp3mmr0r_cf0ea6). Shared by left and right rails.
 *
 * Features:
 *  - Collapse/expand with localStorage persistence (key: panel-collapsed:<id>)
 *  - Cmd+click or Shift+click on header mass-toggles all panels in the same rail
 *  - Optional live pulse dot when pulse=true
 *  - Smooth max-height/opacity transition
 */
import { useState, useEffect, useRef } from 'react'

interface PanelProps {
  id: string
  label: string
  count?: number | string
  children: React.ReactNode
  maxHeight?: number
  defaultCollapsed?: boolean
  pulse?: boolean
}

export function Panel({
  id,
  label,
  count,
  children,
  maxHeight = 240,
  defaultCollapsed = false,
  pulse = false,
}: PanelProps) {
  const lsKey = `panel-collapsed:${id}`
  const rootRef = useRef<HTMLDivElement>(null)

  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem(lsKey)
      if (stored !== null) return stored === 'true'
    } catch {}
    return defaultCollapsed
  })

  // Listen for mass-toggle events dispatched by sibling panels in the same rail
  useEffect(() => {
    const handler = (e: Event) => {
      const custom = e as CustomEvent<{ ids: string[]; collapsed: boolean }>
      if (custom.detail.ids.includes(id)) {
        setCollapsed(custom.detail.collapsed)
        try {
          localStorage.setItem(lsKey, String(custom.detail.collapsed))
        } catch {}
      }
    }
    window.addEventListener('panel-mass-toggle', handler)
    return () => window.removeEventListener('panel-mass-toggle', handler)
  }, [id, lsKey])

  const handleHeaderClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.metaKey || e.shiftKey) {
      // Walk up from the panel root to find the ancestor with data-rail
      let el: HTMLElement | null = rootRef.current?.parentElement ?? null
      while (el && !el.dataset.rail) {
        el = el.parentElement
      }
      if (el) {
        const siblings = Array.from(el.querySelectorAll<HTMLElement>('[data-panel-id]'))
        const ids = siblings.map((s) => s.dataset.panelId!).filter(Boolean)
        const newCollapsed = !collapsed
        ids.forEach((pid) => {
          try {
            localStorage.setItem(`panel-collapsed:${pid}`, String(newCollapsed))
          } catch {}
        })
        window.dispatchEvent(
          new CustomEvent('panel-mass-toggle', {
            detail: { ids, collapsed: newCollapsed },
          })
        )
        return
      }
    }
    // Single toggle
    const newCollapsed = !collapsed
    setCollapsed(newCollapsed)
    try {
      localStorage.setItem(lsKey, String(newCollapsed))
    } catch {}
  }

  return (
    <div
      ref={rootRef}
      data-panel-id={id}
      style={{
        // Single shared hairline between rail panels — no outer box, no overlap hack.
        // Rail container supplies left/right edges; we only contribute the bottom rule.
        borderBottom: '1px solid rgba(212,175,55,0.10)',
        position: 'relative',
        transition: 'background 200ms ease',
      }}
      onMouseEnter={(e) => {
        const el = e.currentTarget as HTMLDivElement
        el.style.background = 'rgba(212,175,55,0.025)'
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget as HTMLDivElement
        el.style.background = 'transparent'
      }}
    >
      {/* Header */}
      <div
        onClick={handleHeaderClick}
        role="button"
        tabIndex={0}
        aria-expanded={!collapsed}
        aria-controls={`panel-body-${id}`}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setCollapsed((v) => {
              const next = !v
              try { localStorage.setItem(lsKey, String(next)) } catch {}
              return next
            })
          }
        }}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '5px 8px',
          cursor: 'pointer',
          background: 'rgba(212,175,55,0.03)',
          userSelect: 'none',
          transition: 'background 150ms ease',
        }}
      >
        {/* Live pulse dot */}
        {pulse && (
          <span
            aria-hidden
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: '#d4af37',
              flexShrink: 0,
              animation: 'panel-pulse 2s ease-in-out infinite',
            }}
          />
        )}

        {/* Section label */}
        <span
          style={{
            fontSize: 9,
            letterSpacing: '0.22em',
            textTransform: 'uppercase' as const,
            color: 'rgba(255,255,255,0.45)',
            fontFamily: "'Oswald', 'Inter', system-ui, sans-serif",
          }}
        >
          {label}
        </span>

        {/* Count badge */}
        {count !== undefined && (
          <span
            style={{
              fontSize: 9,
              fontFamily: "'JetBrains Mono', ui-monospace, monospace",
              color: 'rgba(255,255,255,0.35)',
              letterSpacing: '0.06em',
            }}
          >
            {count}
          </span>
        )}

        {/* Spacer */}
        <span style={{ flex: 1 }} />

        {/* Collapse chevron — rotates smoothly on expand/collapse */}
        <span
          aria-hidden
          style={{
            fontSize: 9,
            color: 'rgba(212,175,55,0.50)',
            lineHeight: 1,
            display: 'inline-block',
            transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
            transition: 'transform 200ms ease, color 150ms ease',
          }}
        >
          ▼
        </span>
      </div>

      {/* Body */}
      <div
        id={`panel-body-${id}`}
        className="ambient-panel-body"
        style={{
          overflowY: 'auto',
          maxHeight: collapsed ? 0 : maxHeight,
          opacity: collapsed ? 0 : 1,
          pointerEvents: collapsed ? 'none' : 'auto',
          transition: 'max-height 220ms cubic-bezier(0.4,0,0.2,1), opacity 180ms ease',
          scrollbarWidth: 'none',
        }}
      >
        {children}
      </div>
      <style>{`
        .ambient-panel-body::-webkit-scrollbar { width: 0; height: 0; }
      `}</style>
    </div>
  )
}
