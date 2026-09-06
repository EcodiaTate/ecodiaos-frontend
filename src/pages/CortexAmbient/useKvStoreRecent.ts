/**
 * useKvStoreRecent — polls /api/kv-store/recent every 30s.
 *
 * Phase 4 (fork_mp3pkavh_12c438): left-rail kv_store Writes panel.
 * Returns last 10 kv_store keys by updated_at (creds.* excluded at server).
 */
import { useState, useEffect } from 'react'
import api from '@/api/client'

export interface KvWrite {
  key: string
  val_size: number    // bytes (octet_length of the value text)
  updated_at: string | null
}

export function useKvStoreRecent(pollMs = 30_000) {
  const [writes, setWrites] = useState<KvWrite[]>([])

  useEffect(() => {
    let cancelled = false
    let timer: number | undefined

    const tick = async () => {
      try {
        const { data } = await api.get('/kv-store/recent')
        if (!cancelled) setWrites(data?.writes ?? [])
      } catch {
        // leave previous state intact on transient error
      }
      if (!cancelled) timer = window.setTimeout(tick, pollMs)
    }

    tick()
    return () => {
      cancelled = true
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [pollMs])

  return { writes }
}
