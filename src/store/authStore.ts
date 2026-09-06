import { create } from 'zustand'

interface AuthStore {
  token: string | null
  refreshToken: string | null
  setToken: (token: string) => void
  login: (token: string, refreshToken: string) => void
  logout: () => void
}

export const useAuthStore = create<AuthStore>((set) => ({
  token: localStorage.getItem('ecodia_token'),
  refreshToken: localStorage.getItem('ecodia_refresh'),
  setToken: (token) => {
    localStorage.setItem('ecodia_token', token)
    set({ token })
  },
  login: (token, refreshToken) => {
    localStorage.setItem('ecodia_token', token)
    localStorage.setItem('ecodia_refresh', refreshToken)
    set({ token, refreshToken })
  },
  logout: () => {
    localStorage.removeItem('ecodia_token')
    localStorage.removeItem('ecodia_refresh')
    set({ token: null, refreshToken: null })
    window.location.href = '/'
  },
}))
