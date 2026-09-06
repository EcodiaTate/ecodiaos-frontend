/**
 * useStatusBoard - frontend hook for the status_board single source of truth.
 *
 * Polls /api/status-board/active every 30s. Returns active rows in the
 * shape needed by the constellation view. Survives empty/error states
 * gracefully (returns []).
 *
 * NB: paths here are relative to the api client baseURL (which is already
 * '/api'). Do NOT prefix with '/api/' or every request 404s as /api/api/...
 *
 * If a richer store-backed projection is added later, swap this for a
 * zustand subscription. For now polling is enough at status_board scale
 * (typically <120 active rows).
 */
import { useEffect, useState } from 'react'
import api from '@/api/client'

export interface StatusRow {
  id: string
  entity_type: string
  entity_ref: string | null
  name: string
  status: string | null
  next_action: string | null
  next_action_by: string | null
  next_action_due: string | null
  priority: number | null
  archived_at: string | null
  last_touched: string | null
  context?: string | null
}

const ENDPOINTS = [
  '/status-board/active',
  '/status_board/active',
  '/status-board',
  '/cortex/status-board',
]

async function tryFetch(): Promise<StatusRow[]> {
  for (const ep of ENDPOINTS) {
    try {
      const res = await api.get(ep)
      const rows = Array.isArray(res.data) ? res.data : (res.data?.rows ?? res.data?.items ?? [])
      if (Array.isArray(rows)) return rows.filter((r: StatusRow) => !r.archived_at)
    } catch (e) {
      // try next endpoint
    }
  }
  return []
}

export function useStatusBoard(): StatusRow[] {
  const [rows, setRows] = useState<StatusRow[]>([])

  useEffect(() => {
    let cancelled = false
    let timer: number | undefined

    const tick = async () => {
      const next = await tryFetch()
      if (!cancelled) setRows(next)
      timer = window.setTimeout(tick, 30000)
    }
    tick()
    return () => {
      cancelled = true
      if (timer) window.clearTimeout(timer)
    }
  }, [])

  return rows
}
