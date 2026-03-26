import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { UserRole } from '@/types'

const TOKEN_KEY = 'LIGHTRAG-API-TOKEN'

interface AuthState {
  token: string | null
  isAuthenticated: boolean
  isGuest: boolean
  /** 'admin' | 'user' | 'guest' */
  role: UserRole
  username: string
  authMode: 'enabled' | 'disabled' | null
  coreVersion: string
  apiVersion: string
  webuiTitle: string
  webuiDescription: string

  /** Convenience getter: current user is an admin */
  isAdmin: () => boolean

  setToken: (token: string, isGuest?: boolean) => void
  setAuthInfo: (info: {
    token: string
    isGuest?: boolean
    role?: UserRole
    authMode?: 'enabled' | 'disabled'
    coreVersion?: string
    apiVersion?: string
    webuiTitle?: string
    webuiDescription?: string
    username?: string
  }) => void
  logout: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      token: null,
      isAuthenticated: false,
      isGuest: false,
      role: 'user' as UserRole,
      username: '',
      authMode: null,
      coreVersion: '',
      apiVersion: '',
      webuiTitle: 'LightRAG',
      webuiDescription: '',

      isAdmin: () => get().role === 'admin',

      setToken: (token, isGuest = false) => {
        set({ token, isAuthenticated: true, isGuest, role: isGuest ? 'guest' : 'user' })
      },

      setAuthInfo: (info) => {
        const isGuest = info.isGuest ?? false
        const role: UserRole = info.role ?? (isGuest ? 'guest' : 'user')
        set({
          token: info.token,
          isAuthenticated: true,
          isGuest,
          role,
          username: info.username ?? '',
          authMode: info.authMode ?? null,
          coreVersion: info.coreVersion ?? '',
          apiVersion: info.apiVersion ?? '',
          webuiTitle: info.webuiTitle ?? 'LightRAG',
          webuiDescription: info.webuiDescription ?? '',
        })
      },

      logout: () => {
        localStorage.removeItem(TOKEN_KEY)
        set({
          token: null,
          isAuthenticated: false,
          isGuest: false,
          role: 'user',
          username: '',
        })
      },
    }),
    {
      name: TOKEN_KEY,
      partialize: (state) => ({
        token: state.token,
        isAuthenticated: state.isAuthenticated,
        isGuest: state.isGuest,
        role: state.role,
        username: state.username,
        authMode: state.authMode,
        webuiTitle: state.webuiTitle,
        webuiDescription: state.webuiDescription,
      }),
    }
  )
)
