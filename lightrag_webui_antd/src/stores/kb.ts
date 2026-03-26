import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { KnowledgeBase } from '@/types'

interface KBState {
  /** All knowledge bases fetched from server */
  kbs: KnowledgeBase[]
  /** ID of the currently selected KB (sent as X-KB-ID header) */
  currentKBId: string | null
  /** Whether the KB list has been loaded at least once */
  loaded: boolean

  // ── Actions ───────────────────────────────────────────────────────────────
  setKBs: (kbs: KnowledgeBase[]) => void
  setCurrentKBId: (id: string) => void
  /** Return the KnowledgeBase object for currentKBId (or null) */
  currentKB: () => KnowledgeBase | null
  reset: () => void
}

export const useKBStore = create<KBState>()(
  persist(
    (set, get) => ({
      kbs: [],
      currentKBId: null,
      loaded: false,

      setKBs: (kbs) => {
        const state = get()
        // Auto-select default KB if nothing is selected yet, or selection gone
        const stillValid = kbs.some((kb) => kb.id === state.currentKBId)
        const defaultKB = kbs.find((kb) => kb.is_default) ?? kbs[0]
        set({
          kbs,
          loaded: true,
          currentKBId: stillValid ? state.currentKBId : (defaultKB?.id ?? null),
        })
      },

      setCurrentKBId: (id) => set({ currentKBId: id }),

      currentKB: () => {
        const { kbs, currentKBId } = get()
        return kbs.find((kb) => kb.id === currentKBId) ?? null
      },

      reset: () => set({ kbs: [], currentKBId: null, loaded: false }),
    }),
    {
      name: 'LIGHTRAG-KB-STATE',
      partialize: (state) => ({
        currentKBId: state.currentKBId,
      }),
    }
  )
)

