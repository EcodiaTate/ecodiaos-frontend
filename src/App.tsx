import { lazy, Suspense, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useAuthStore } from './store/authStore'
import api from './api/client'
import toast from 'react-hot-toast'
import { SceneErrorBoundary } from './components/shared/SceneErrorBoundary'

// ── Code-split route pages ───────────────────────────────────────────────────
const DashboardPage = lazy(() => import('./pages/CortexAmbient'))
const MeetingPage   = lazy(() => import('./pages/Meeting'))
const MeetingsPage  = lazy(() => import('./pages/Meetings'))

/** Minimal loading pulse */
function SceneSuspense({ children }: { children: React.ReactNode }) {
  return (
    <Suspense
      fallback={
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex h-[50vh] items-center justify-center"
        >
          <motion.div
            animate={{ opacity: [0.15, 0.3, 0.15] }}
            transition={{ repeat: Infinity, duration: 2.4, ease: 'easeInOut' }}
            className="h-2 w-2 rounded-full bg-primary"
          />
        </motion.div>
      }
    >
      {children}
    </Suspense>
  )
}

/**
 * Inline login overlay — shown over the dashboard when no token is present.
 * No separate /login route needed.
 */
function LoginOverlay() {
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const login = useAuthStore((s) => s.login)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      const { data } = await api.post('/auth/login', { password })
      login(data.token, data.refreshToken)
    } catch {
      toast.error('Invalid password')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: '#000',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <motion.form
        onSubmit={handleSubmit}
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 80, damping: 20 }}
        style={{
          width: '100%', maxWidth: 280,
          padding: '2rem',
          border: '1px solid rgba(255,255,255,0.06)',
          borderRadius: 8,
        }}
      >
        <div style={{ marginBottom: '2rem' }}>
          <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.2em', color: 'rgba(255,255,255,0.35)' }}>
            Ecodia OS
          </span>
        </div>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={{
            width: '100%', background: 'transparent',
            border: 'none', borderBottom: '1px solid rgba(255,255,255,0.12)',
            padding: '0.5rem 0', color: '#e0e0e0', fontSize: 14, outline: 'none',
          }}
          autoFocus
        />
        <button
          type="submit"
          disabled={loading || !password}
          style={{
            marginTop: '1.5rem', width: '100%',
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.10)',
            borderRadius: 6, padding: '0.6rem 1rem',
            fontSize: 11, fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '0.1em',
            color: 'rgba(255,255,255,0.80)', cursor: 'pointer',
            opacity: (loading || !password) ? 0.2 : 1,
          }}
        >
          {loading ? '...' : 'Enter'}
        </button>
      </motion.form>
    </div>
  )
}

/** Wraps a protected page — shows inline login overlay if unauthenticated */
function AuthGate({ children }: { children: React.ReactNode }) {
  const token = useAuthStore((s) => s.token)
  if (!token) return <LoginOverlay />
  return <>{children}</>
}

export default function App() {
  return (
    <BrowserRouter>
      <SceneErrorBoundary>
        <Routes>
          {/* Root: EcodiaOS dashboard, auth-gated inline */}
          <Route
            path="/"
            element={
              <AuthGate>
                <SceneSuspense>
                  <DashboardPage />
                </SceneSuspense>
              </AuthGate>
            }
          />

          {/* Meeting recorder + viewer: no auth, mobile-accessible */}
          <Route path="/meeting"      element={<SceneSuspense><MeetingPage /></SceneSuspense>} />
          <Route path="/meetings"     element={<SceneSuspense><MeetingsPage /></SceneSuspense>} />
          <Route path="/meetings/:id" element={<SceneSuspense><MeetingsPage /></SceneSuspense>} />

          {/* Everything else: back to root */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </SceneErrorBoundary>
    </BrowserRouter>
  )
}
