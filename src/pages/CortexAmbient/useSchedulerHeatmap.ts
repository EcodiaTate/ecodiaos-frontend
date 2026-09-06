/**
 * useSchedulerHeatmap — polls /api/scheduler/heatmap every 30s.
 *
 * Phase 4 (fork_mp3pkavh_12c438): left-rail Scheduler Heat Map panel.
 * Returns active cron tasks with 1h / 6h / 24h fired flags.
 */
import { useState, useEffect } from 'react'
import api from '@/api/client'

export interface CronHeatRow {
  name: string
  last_run_at: string | null
  next_run_at: string | null
  fired_1h: boolean
  fired_6h: boolean
  fired_24h: boolean
}

export function useSchedulerHeatmap(pollMs = 30_000) {
  const [crons, setCrons] = useState<CronHeatRow[]>([])

  useEffect(() => {
    let cancelled = false
    let timer: number | undefined

    const tick = async () => {
      try {
        const { data } = await api.get('/scheduler/heatmap')
        if (!cancelled) setCrons(data?.crons ?? [])
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

  const firedCount1h = crons.filter((c) => c.fired_1h).length
  return { crons, firedCount1h }
}
