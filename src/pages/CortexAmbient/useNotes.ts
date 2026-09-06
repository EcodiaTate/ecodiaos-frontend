import { useState, useEffect, useRef } from 'react'
import api from '@/api/client'

export interface DashboardNote {
  id: string
  listener_name: string
  note_text: string
  related_entity: Record<string, unknown> | null
  created_at: string
}

const POLL_INTERVAL_MS = 30_000

export function useNotes(limit = 8): { notes: DashboardNote[]; newCount: number } {
  const [notes, setNotes] = useState<DashboardNote[]>([])
  const [newCount, setNewCount] = useState(0)
  const prevIdsRef = useRef<Set<string>>(new Set())
  const mountedRef = useRef(true)

  useEffect(() => {
    // limit=0 is a sentinel meaning "parent is supplying data, skip polling"
    if (limit === 0) return

    mountedRef.current = true

    const fetchNotes = async () => {
      try {
        const { data } = await api.get<DashboardNote[]>(`/ops/notes?limit=${limit}`)
        if (!mountedRef.current) return
        const incoming = data ?? []

        // Count genuinely new IDs for slide-in animation trigger
        const prevIds = prevIdsRef.current
        const freshCount = incoming.filter(n => !prevIds.has(n.id)).length
        if (freshCount > 0) setNewCount(c => c + freshCount)

        prevIdsRef.current = new Set(incoming.map(n => n.id))
        setNotes(incoming)
      } catch {
        // Graceful: table may not exist yet or network hiccup — keep last data
      }
    }

    fetchNotes()
    const handle = setInterval(fetchNotes, POLL_INTERVAL_MS)
    return () => {
      mountedRef.current = false
      clearInterval(handle)
    }
  }, [limit])

  return { notes, newCount }
}
