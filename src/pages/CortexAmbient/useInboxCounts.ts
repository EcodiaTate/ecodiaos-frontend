/**
 * useInboxCounts — polls /api/triage/inbox-counts every 60s
 *
 * Phase 2 CortexAmbient right-rail INBOX panel. Slow poll — inbox
 * counts don't change second-to-second.
 * Origin: fork_mp3ndv83_63898a, 2026-05-13
 */
import { useState, useEffect, useRef } from 'react'
import api from '@/api/client'

export interface InboxAccount {
  unread: number
  oldestAge: string | null
}

interface InboxCountsState {
  tate: InboxAccount
  code: InboxAccount
  total: number
}

const EMPTY: InboxCountsState = {
  tate: { unread: 0, oldestAge: null },
  code: { unread: 0, oldestAge: null },
  total: 0,
}

export function useInboxCounts(): InboxCountsState {
  const [state, setState] = useState<InboxCountsState>(EMPTY)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    let cancelled = false

    const fetch_ = async () => {
      try {
        const { data } = await api.get('/triage/inbox-counts')
        if (!cancelled) setState(data)
      } catch {
        // keep last state
      }
    }

    fetch_()
    timerRef.current = setInterval(fetch_, 60000)

    return () => {
      cancelled = true
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [])

  return state
}
