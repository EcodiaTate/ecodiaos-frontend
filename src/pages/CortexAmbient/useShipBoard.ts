/**
 * useShipBoard — polls /api/vercel/recent every 120s.
 *
 * Phase 4 (fork_mp3pkavh_12c438): left-rail Ship Board panel.
 * Returns last 8 Vercel deployments across all projects.
 */
import { useState, useEffect } from 'react'
import api from '@/api/client'

export interface VercelDeploy {
  vercel_deployment_id: string
  project_name: string
  url: string | null
  state: string           // 'READY' | 'ERROR' | 'BUILDING' | 'QUEUED' | 'CANCELED' | 'UNKNOWN'
  created_at: string | null
  git_commit_sha: string | null
  git_commit_message: string | null
}

export function useShipBoard(pollMs = 120_000) {
  const [deploys, setDeploys] = useState<VercelDeploy[]>([])

  useEffect(() => {
    let cancelled = false
    let timer: number | undefined

    const tick = async () => {
      try {
        const { data } = await api.get('/vercel/recent')
        if (!cancelled) setDeploys(data?.deploys ?? [])
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

  return { deploys }
}
