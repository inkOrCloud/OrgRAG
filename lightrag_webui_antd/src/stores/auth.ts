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
  authMode: 'enabled' | null
  coreVersion: string
  apiVersion: string
  webuiTitle: string
  webuiDescription: string
  /** Relative avatar path returned by the server, e.g. /avatars/xxx.png */
  avatarUrl: string
  /**
   * True when the server reports that initial setup has not been completed.
   * Starts as null (unknown) and is set after the first auth-status check.
   */
  setupRequired: boolean | null

  /** Convenience getter: current user is an admin */
  isAdmin: () => boolean

  setToken: (token: string) => void
  setAuthInfo: (info: {
    token: string
    role?: UserRole
    authMode?: 'enabled'
    coreVersion?: string
    apiVersion?: string
    webuiTitle?: string
    webuiDescription?: string
    username?: string
  }) => void
  setAvatarUrl: (url: string) => void
  setSetupRequired: (required: boolean) => void
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
      avatarUrl: '',
      setupRequired: null,

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

      setAvatarUrl: (url) => set({ avatarUrl: url }),

      setSetupRequired: (required) => {
        set({ setupRequired: required })
      },

      logout: () => {
        localStorage.removeItem(TOKEN_KEY)
        set({
          token: null,
          isAuthenticated: false,
          role: 'user',
          username: '',
          avatarUrl: '',
          setupRequired: null,
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
        avatarUrl: state.avatarUrl,
      }),
    }
  )
)
