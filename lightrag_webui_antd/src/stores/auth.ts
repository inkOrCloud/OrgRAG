import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { UserRole } from '@/types'

const TOKEN_KEY = 'LIGHTRAG-API-TOKEN'

interface AuthState {
  token: string | null
  isAuthenticated: boolean
  /** 'admin' | 'user' */
  role: UserRole
  username: string
  authMode: 'enabled' | 'disabled' | null
  coreVersion: string
  apiVersion: string
  webuiTitle: string
  webuiDescription: string

  /** Convenience getter: current user is an admin */
  isAdmin: () => boolean

  setToken: (token: string) => void
  setAuthInfo: (info: {
    token: string
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
      role: 'user' as UserRole,
      username: '',
      authMode: null,
      coreVersion: '',
      apiVersion: '',
      webuiTitle: 'LightRAG',
      webuiDescription: '',

      isAdmin: () => get().role === 'admin',

      setToken: (token) => {
        set({ token, isAuthenticated: true, role: 'user' })
      },

      setAuthInfo: (info) => {
        const role: UserRole = info.role ?? 'user'
        set({
          token: info.token,
          isAuthenticated: true,
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
        role: state.role,
        username: state.username,
        authMode: state.authMode,
        webuiTitle: state.webuiTitle,
        webuiDescription: state.webuiDescription,
      }),
    }
  )
)
