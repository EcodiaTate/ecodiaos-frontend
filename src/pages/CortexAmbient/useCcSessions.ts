/**
 * useCcSessions — polls /api/factory/sessions every 30s.
 * Phase 5 (fork_mp3qmbg0_ceed6f): right-rail cc_sessions activity feed.
 * Returns last 10 sessions. Gracefully returns [] on 404 / network error.
 */
import { useState, useEffect } from 'react'
import api from '@/api/client'

export interface CcSessionRow {
  session_id: string
  status: string
  pipeline_stage: string | null
  confidence_score: number | null
  created_at: string | null
  codebase_name?: string | null
  prompt?: string | null
  files_changed?: number | null
}

// /api/cc/sessions is the canonical Factory session endpoint.
// Returns { sessions: [...], total: N } — sessions use id + started_at.
// Normalize to CcSessionRow shape (session_id + created_at) for the FE component.
const ENDPOINTS = [
  '/cc/sessions',
]

function normalizeRow(r: Record<string, unknown>): CcSessionRow {
  return {
    session_id: (r.cc_session_id as string | null) ?? (r.id as string) ?? '',
    status: (r.status as string) ?? 'unknown',
    pipeline_stage: (r.pipeline_stage as string | null) ?? null,
    confidence_score: r.confidence_score != null ? Number(r.confidence_score) : null,
    created_at: (r.started_at as string | null) ?? (r.created_at as string | null) ?? null,
    codebase_name: (r.codebase_name as string | null) ?? null,
    prompt: (r.initial_prompt as string | null) ?? null,
    files_changed: r.files_changed != null ? Number(r.files_changed) : null,
  }
}

async function tryFetch(): Promise<CcSessionRow[]> {
  for (const ep of ENDPOINTS) {
    try {
      const res = await api.get(ep, { params: { limit: 10 } })
      const d = res.data
      const raw: Record<string, unknown>[] = Array.isArray(d)
        ? d
        : Array.isArray(d?.sessions)
        ? d.sessions
        : Array.isArray(d?.rows)
        ? d.rows
        : []
      if (raw.length > 0) return raw.slice(0, 10).map(normalizeRow)
    } catch {
      // try next endpoint
    }
  }
  return []
}

export function useCcSessions(pollMs = 30_000) {
  const [sessions, setSessions] = useState<CcSessionRow[]>([])

  useEffect(() => {
    let cancelled = false
    let timer: number | undefined

    const tick = async () => {
      const rows = await tryFetch()
      if (!cancelled) setSessions(rows)
      if (!cancelled) timer = window.setTimeout(tick, pollMs)
    }

    tick()
    return () => {
      cancelled = true
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [pollMs])

  return { sessions }
}
