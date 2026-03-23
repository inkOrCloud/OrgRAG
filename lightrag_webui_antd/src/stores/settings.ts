import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { QueryMode } from '@/types'

interface QuerySettings {
  mode: QueryMode
  topK: number
  chunkTopK: number
  maxEntityTokens: number
  maxRelationTokens: number
  maxTotalTokens: number
  stream: boolean
  enableRerank: boolean
  historyTurns: number
  responseType: string
}

interface SettingsState {
  isDark: boolean
  apiBaseUrl: string
  querySettings: QuerySettings
  sidebarCollapsed: boolean

  toggleDark: () => void
  setApiBaseUrl: (url: string) => void
  updateQuerySettings: (settings: Partial<QuerySettings>) => void
  setSidebarCollapsed: (collapsed: boolean) => void
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      isDark: false,
      apiBaseUrl: '',
      sidebarCollapsed: false,

      querySettings: {
        mode: 'hybrid',
        topK: 60,
        chunkTopK: 10,
        maxEntityTokens: 4000,
        maxRelationTokens: 4000,
        maxTotalTokens: 12000,
        stream: true,
        enableRerank: false,
        historyTurns: 3,
        responseType: 'Multiple Paragraphs',
      },

      toggleDark: () => set((s) => ({ isDark: !s.isDark })),
      setApiBaseUrl: (url) => set({ apiBaseUrl: url }),
      updateQuerySettings: (settings) =>
        set((s) => ({ querySettings: { ...s.querySettings, ...settings } })),
      setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
    }),
    {
      name: 'lightrag-settings',
    }
  )
)
