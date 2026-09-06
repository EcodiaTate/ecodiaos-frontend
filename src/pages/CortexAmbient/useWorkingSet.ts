/**
 * useWorkingSet — polls /api/working-set every 3s
 *
 * Phase 2 CortexAmbient right-rail THREADS panel.
 * Origin: fork_mp3ndv83_63898a, 2026-05-13
 */
import { useState, useEffect, useRef } from 'react'
import api from '@/api/client'

export interface WorkingSetThread {
  id: string
  topic: string
  status: string // 'active' | 'blocked' | 'parked'
  blocking_on: string | null
  opened_at: string
  last_touched_at: string
}

interface WorkingSetState {
  threads: WorkingSetThread[]
  activeCount: number
  blockedCount: number
  parkedCount: number
}

const EMPTY: WorkingSetState = { threads: [], activeCount: 0, blockedCount: 0, parkedCount: 0 }

export function useWorkingSet(): WorkingSetState {
  const [state, setState] = useState<WorkingSetState>(EMPTY)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    let cancelled = false

    const fetch_ = async () => {
      try {
        const { data } = await api.get('/working-set')
        if (!cancelled) setState(data)
      } catch {
        // Network error — keep last state
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
