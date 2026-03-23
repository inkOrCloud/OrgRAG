import { create } from 'zustand'
import { persist } from 'zustand/middleware'

const TOKEN_KEY = 'LIGHTRAG-API-TOKEN'

interface AuthState {
  token: string | null
  isAuthenticated: boolean
  isGuest: boolean
  username: string
  authMode: 'enabled' | 'disabled' | null
  coreVersion: string
  apiVersion: string
  webuiTitle: string
  webuiDescription: string

  setToken: (token: string, isGuest?: boolean) => void
  setAuthInfo: (info: {
    token: string
    isGuest?: boolean
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
    (set) => ({
      token: null,
      isAuthenticated: false,
      isGuest: false,
      username: '',
      authMode: null,
      coreVersion: '',
      apiVersion: '',
      webuiTitle: 'LightRAG',
      webuiDescription: '',

      setToken: (token, isGuest = false) => {
        set({ token, isAuthenticated: true, isGuest })
      },

      setAuthInfo: (info) => {
        set({
          token: info.token,
          isAuthenticated: true,
          isGuest: info.isGuest ?? false,
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
        username: state.username,
        authMode: state.authMode,
        webuiTitle: state.webuiTitle,
        webuiDescription: state.webuiDescription,
      }),
    }
  )
)
