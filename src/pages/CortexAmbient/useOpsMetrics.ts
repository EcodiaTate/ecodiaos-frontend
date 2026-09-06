/**
 * useOpsMetrics — polls /api/ops/metrics every 60s.
 *
 * Phase 3 (fork_mp3p13lp_45faf5): left rail panels.
 * Returns structured data for Energy Budget, Cost Sparkline,
 * Cache Hit Ratio, and Status Board Strip panels.
 */
import { useEffect, useState } from 'react'
import api from '@/api/client'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface HourlyBucket {
  hour: string       // ISO timestamp
  cost_usd: number
}

export interface AccountEnergy {
  provider: string
  label: string      // 'tate@' | 'code@' | 'money@'
  input_tokens: number
  output_tokens: number
  total_tokens: number
  cost_usd: number
  pct_of_budget: number   // 0-1
}

export interface EnergyByAccount {
  accounts: AccountEnergy[]
  total_tokens_this_week: number
  weekly_budget: number
  pct_used: number        // 0-1
}

export interface StatusPriorities {
  P1: number
  P2: number
  P3: number
  P4: number
  P5: number
}

export interface OpsMetrics {
  // cache hit
  cache_hit_ratio_24h: number | null
  cache_hit_ratio_week: number | null
  // cost per turn
  cost_per_turn_usd_24h: number | null
  cost_per_turn_usd_week: number | null
  cost_usd_this_week: number
  cost_usd_24h: number
  // sparkline — 24 hourly buckets
  cost_hourly: HourlyBucket[]
  // energy / status
  energy_by_account: EnergyByAccount
  status_priorities: StatusPriorities
  status_total: number
  // process state
  uptime_sec: number | null
  memory_rss_mb: number | null   // Phase 8: MEM chip
  // Phase 8: git chip
  git_sha: string | null
  git_age_sec: number | null
  git_branch: string | null
  // Phase 8: disk chip
  disk_pct: number | null
  // Phase 8: cron chip
  cron_next_name: string | null
  cron_next_in_sec: number | null
  // client-measured API round-trip latency (ms)
  last_response_ms: number | null
}

const EMPTY: OpsMetrics = {
  cache_hit_ratio_24h: null,
  cache_hit_ratio_week: null,
  cost_per_turn_usd_24h: null,
  cost_per_turn_usd_week: null,
  cost_usd_this_week: 0,
  cost_usd_24h: 0,
  cost_hourly: [],
  energy_by_account: {
    accounts: [],
    total_tokens_this_week: 0,
    weekly_budget: 20_000_000_000,
    pct_used: 0,
  },
  status_priorities: { P1: 0, P2: 0, P3: 0, P4: 0, P5: 0 },
  status_total: 0,
  uptime_sec: null,
  memory_rss_mb: null,
  git_sha: null,
  git_age_sec: null,
  git_branch: null,
  disk_pct: null,
  cron_next_name: null,
  cron_next_in_sec: null,
  last_response_ms: null,
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useOpsMetrics(pollMs = 60_000): OpsMetrics {
  const [metrics, setMetrics] = useState<OpsMetrics>(EMPTY)

  useEffect(() => {
    let cancelled = false
    let timer: number | undefined

    const tick = async () => {
      try {
        const t0 = Date.now()
        const { data } = await api.get('/ops/metrics')
        const responseMs = Date.now() - t0
        if (cancelled) return

        const te = data?.turn_economics ?? {}
        const ea = data?.energy_by_account ?? {}
        const sp = data?.status_priorities ?? {}
        const ch: HourlyBucket[] = Array.isArray(data?.cost_hourly)
          ? data.cost_hourly.map((b: { hour: string; cost_usd: number }) => ({
              hour: b.hour,
              cost_usd: Number(b.cost_usd ?? 0),
            }))
          : []

        const p = sp as StatusPriorities
        const total = (p.P1 ?? 0) + (p.P2 ?? 0) + (p.P3 ?? 0) + (p.P4 ?? 0) + (p.P5 ?? 0)

        setMetrics({
          cache_hit_ratio_24h:
            te.cache_hit_ratio_24h != null ? Number(te.cache_hit_ratio_24h) : null,
          cache_hit_ratio_week:
            te.cache_hit_ratio_this_week != null ? Number(te.cache_hit_ratio_this_week) : null,
          cost_per_turn_usd_24h:
            te.cost_per_turn_usd_24h != null ? Number(te.cost_per_turn_usd_24h) : null,
          cost_per_turn_usd_week:
            te.cost_per_turn_usd_this_week != null
              ? Number(te.cost_per_turn_usd_this_week)
              : null,
          cost_usd_this_week: Number(te.cost_usd_this_week ?? 0),
          cost_usd_24h: Number(te.cost_usd_24h ?? 0),
          cost_hourly: ch,
          energy_by_account: {
            accounts: Array.isArray(ea.accounts)
              ? ea.accounts.map((a: AccountEnergy) => ({
                  provider: a.provider,
                  label: a.label,
                  input_tokens: Number(a.input_tokens ?? 0),
                  output_tokens: Number(a.output_tokens ?? 0),
                  total_tokens: Number(a.total_tokens ?? 0),
                  cost_usd: Number(a.cost_usd ?? 0),
                  pct_of_budget: Number(a.pct_of_budget ?? 0),
                }))
              : [],
            total_tokens_this_week: Number(ea.total_tokens_this_week ?? 0),
            weekly_budget: Number(ea.weekly_budget ?? 20_000_000_000),
            pct_used: Number(ea.pct_used ?? 0),
          },
          status_priorities: {
            P1: Number(p.P1 ?? 0),
            P2: Number(p.P2 ?? 0),
            P3: Number(p.P3 ?? 0),
            P4: Number(p.P4 ?? 0),
            P5: Number(p.P5 ?? 0),
          },
          status_total: total,
          uptime_sec: data?.state?.conductor_uptime_sec ?? null,
          memory_rss_mb: data?.state?.memory_rss_mb ?? null,
          git_sha: data?.state?.git?.sha ?? null,
          git_age_sec: data?.state?.git?.age_sec ?? null,
          git_branch: data?.state?.git?.branch ?? null,
          disk_pct: data?.state?.disk?.pct ?? null,
          cron_next_name: data?.next_cron?.name ?? null,
          cron_next_in_sec: data?.next_cron?.next_in_sec ?? null,
          last_response_ms: responseMs,
        })
      } catch {
        // leave previous state intact on transient error
      }
      if (!cancelled) {
        timer = window.setTimeout(tick, pollMs)
      }
    }

    tick()
    return () => {
      cancelled = true
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [pollMs])

  return metrics
}
