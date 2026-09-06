/**
 * usePerceptionBus — polls /api/perception/recent every 3s
 *
 * Phase 2 CortexAmbient right-rail PERCEPTION panel.
 * Origin: fork_mp3ndv83_63898a, 2026-05-13
 */
import { useState, useEffect, useRef } from 'react'
import api from '@/api/client'

export interface PerceptionEvent {
  type: string
  source?: string
  summary?: string
  timestamp: string
}

interface PerceptionBusState {
  events: PerceptionEvent[]
  source: string // 'jsonl' | 'jsonl_unavailable'
}

const EMPTY: PerceptionBusState = { events: [], source: 'jsonl_unavailable' }

export function usePerceptionBus(): PerceptionBusState {
  const [state, setState] = useState<PerceptionBusState>(EMPTY)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    let cancelled = false

    const fetch_ = async () => {
      try {
        const { data } = await api.get('/perception/recent')
        // cap to last 50 events client-side to bound memory
        if (data?.events && Array.isArray(data.events)) {
          data.events = data.events.slice(-50)
        }
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
