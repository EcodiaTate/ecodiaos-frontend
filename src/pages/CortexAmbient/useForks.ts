/**
 * useForks — frontend hook for the live forks rollup.
 *
 * Round-3, fork_mowtlsvo_95bffd (manager fork_mowtf5s4_82c7f4).
 *
 * Polls the canonical fork-list endpoint every 10s. Returns the live fork
 * snapshots in shape needed by ForksStrip + PresenceHeader. Survives empty
 * / error / 404 states gracefully (returns []).
 *
 * Endpoints tried in order — first one to return a valid array wins. Same
 * pattern as useStatusBoard.ts. Paths are relative to the api client
 * baseURL (which is already '/api'); do NOT prefix with '/api/'.
 *
 * Canonical (today) is `/os-session/forks` returning
 *   { live: ForkSnapshot[], hard_cap: number, energy_caps: ... }
 * but the hook tolerates `/forks`, `/cortex/forks`, plain arrays, and
 * `{forks: [...]}` shapes so a backend rename does not require a FE rev.
 */
import { useEffect, useState } from 'react'
import api from '@/api/client'

export type ForkStatus =
  | 'spawning'
  | 'running'
  | 'reporting'
  | 'done'
  | 'aborted'
  | 'error'

export interface ForkRow {
  fork_id: string
  parent_id: string | null
  parent_fork_id?: string | null
  brief: string | null
  context_mode?: string | null
  status: ForkStatus | string
  position?: string | null
  result?: string | null
  next_step?: string | null
  abort_reason?: string | null
  provider?: string | null
  tokens_input?: number
  tokens_output?: number
  tool_calls?: number
  current_tool?: string | null
  last_heartbeat?: string | null
  started_at?: string | null
  ended_at?: string | null
}

interface UseForksResult {
  forks: ForkRow[]
  runningCount: number
}

const ENDPOINTS = [
  '/os-session/forks',
  '/forks',
  '/forks/active',
  '/cortex/forks',
]

const RUNNING_STATUSES = new Set(['spawning', 'running', 'reporting'])

function extractRows(payload: unknown): ForkRow[] {
  if (Array.isArray(payload)) return payload as ForkRow[]
  if (payload && typeof payload === 'object') {
    const obj = payload as Record<string, unknown>
    if (Array.isArray(obj.live)) return obj.live as ForkRow[]
    if (Array.isArray(obj.forks)) return obj.forks as ForkRow[]
    if (Array.isArray(obj.rows)) return obj.rows as ForkRow[]
    if (Array.isArray(obj.items)) return obj.items as ForkRow[]
  }
  return []
}

async function tryFetch(): Promise<ForkRow[]> {
  for (const ep of ENDPOINTS) {
    try {
      const res = await api.get(ep)
      const rows = extractRows(res.data)
      if (Array.isArray(rows)) return rows
    } catch {
      // try next endpoint
    }
  }
  return []
}

export function useForks(pollMs = 10000): UseForksResult {
  const [forks, setForks] = useState<ForkRow[]>([])

  useEffect(() => {
    let cancelled = false
    let timer: number | undefined

    const tick = async () => {
      const next = await tryFetch()
      if (!cancelled) setForks(next)
      timer = window.setTimeout(tick, pollMs)
    }
    tick()
    return () => {
      cancelled = true
      if (timer) window.clearTimeout(timer)
    }
  }, [pollMs])

  const runningCount = forks.reduce(
    (n, f) => (RUNNING_STATUSES.has(String(f.status)) ? n + 1 : n),
    0,
  )

  return { forks, runningCount }
}
