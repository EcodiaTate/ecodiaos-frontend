import { Component, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { AlertTriangle } from 'lucide-react'

interface Props {
  children: ReactNode
  sceneName?: string
}

interface State {
  hasError: boolean
  error: Error | null
}

/** Detect stale chunk errors from Vite code-split imports */
function isChunkLoadError(error: Error): boolean {
  const msg = error.message ?? ''
  return (
    msg.includes('Failed to fetch dynamically imported module') ||
    msg.includes('Loading chunk') ||
    msg.includes('Loading CSS chunk') ||
    msg.includes('error loading dynamically imported module')
  )
}

const RELOAD_KEY = 'ecodia_chunk_reload'

/**
 * Route-level error boundary with ambient glass treatment.
 * Catches render errors in page components without crashing
 * the entire shell (aurora, nav, constellation continue running).
 *
 * Auto-reloads once on stale chunk errors (post-deploy cache mismatch).
 */
export class SceneErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error) {
    if (isChunkLoadError(error)) {
      const last = sessionStorage.getItem(RELOAD_KEY)
      const now = Date.now()
      // Only auto-reload once per 30s to avoid loops
      if (!last || now - Number(last) > 30_000) {
        sessionStorage.setItem(RELOAD_KEY, String(now))
        window.location.reload()
        return
      }
    }
  }

  render() {
    if (this.state.hasError) {
      const isChunk = this.state.error ? isChunkLoadError(this.state.error) : false

      return (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 80, damping: 20 }}
          className="mx-auto flex max-w-md flex-col items-center pt-[20vh]"
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-tertiary/10">
            <AlertTriangle className="h-5 w-5 text-tertiary" strokeWidth={1.75} />
          </div>
          <p className="mt-6 text-center font-display text-sm font-medium text-on-surface">
            {isChunk
              ? 'New version available'
              : `${this.props.sceneName ?? 'This scene'} encountered an error`}
          </p>
          <p className="mt-2 text-center font-mono text-[10px] text-on-surface-muted/40 max-w-sm">
            {isChunk
              ? 'The app has been updated. Reload to get the latest.'
              : this.state.error?.message}
          </p>
          <button
            onClick={() => {
              if (isChunk) {
                window.location.reload()
              } else {
                this.setState({ hasError: false, error: null })
              }
            }}
            className="mt-8 rounded-2xl bg-white/40 px-6 py-2.5 text-sm font-medium text-on-surface-variant hover:bg-white/55"
          >
            {isChunk ? 'Reload' : 'Try again'}
          </button>
        </motion.div>
      )
    }

    return this.props.children
  }
}
