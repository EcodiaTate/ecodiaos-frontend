/**
 * useObserverSignals — polls /api/observer-signals every 5s
 *
 * Phase 2 CortexAmbient right-rail OBSERVER panel.
 * Origin: fork_mp3ndv83_63898a, 2026-05-13
 */
import { useState, useEffect, useRef } from 'react'
import api from '@/api/client'

export interface ObserverSignal {
  id: number
  observer_name: string
  signal_kind: string
  message: string
  confidence: number | null
  acknowledged: boolean
  created_at: string
}

interface ObserverSignalsState {
  signals: ObserverSignal[]
  unackedCount: number
}

const EMPTY: ObserverSignalsState = { signals: [], unackedCount: 0 }

export function useObserverSignals(): ObserverSignalsState {
  const [state, setState] = useState<ObserverSignalsState>(EMPTY)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    let cancelled = false

    const fetch_ = async () => {
      try {
        const { data } = await api.get('/observer-signals')
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
