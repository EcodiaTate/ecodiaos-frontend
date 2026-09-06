/**
 * useRestartRequests — polls /api/restart-requests every 5s
 *
 * Phase 2 CortexAmbient right-rail RESTARTS panel.
 * Origin: fork_mp3ndv83_63898a, 2026-05-13
 */
import { useState, useEffect, useRef } from 'react'
import api from '@/api/client'

export interface RestartRequest {
  id: string
  requesting_fork_id?: string | null
  reason: string
  status: string
  requested_at: string
}

interface RestartRequestsState {
  requests: RestartRequest[]
  count: number
}

const EMPTY: RestartRequestsState = { requests: [], count: 0 }

export function useRestartRequests(): RestartRequestsState {
  const [state, setState] = useState<RestartRequestsState>(EMPTY)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    let cancelled = false

    const fetch_ = async () => {
      try {
        const { data } = await api.get('/restart-requests')
        if (!cancelled) setState(data)
      } catch {
        // keep last state
      }
    }

    fetch_()
    timerRef.current = setInterval(fetch_, 5000)

    return () => {
      cancelled = true
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [])

  return state
}
