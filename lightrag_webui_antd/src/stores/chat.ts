import { create } from 'zustand'
import type { ChatSession } from '@/types'
import {
  listChatSessions,
  saveChatSession,
  deleteChatSession,
  clearChatSessions,
} from '@/api/client'

export type { ChatSession }

interface ChatState {
  sessions: ChatSession[]
  activeSessionId: string | null
  isLoading: boolean

  /** Load sessions from backend (optionally filtered by KB). */
  loadSessions: (kbId?: string | null) => Promise<void>

  /**
   * Optimistically update local state then persist to backend.
   * Fire-and-forget: errors are logged but do not affect UI state.
   */
  saveSession: (session: ChatSession) => void

  /** Optimistically remove from local state then delete on backend. */
  deleteSession: (id: string) => void

  setActiveSessionId: (id: string | null) => void

  /** Clear active session when switching to a different KB. */
  clearActiveSession: () => void

  /** Optimistically clear local state then delete on backend. */
  clearAll: (kbId?: string | null) => void
}

// Clear legacy localStorage data from the old persist-based store
try { localStorage.removeItem('lightrag-chat') } catch { /* ignore */ }

export const useChatStore = create<ChatState>()((set, get) => ({
  sessions: [],
  activeSessionId: null,
  isLoading: false,

  loadSessions: async (kbId) => {
    set({ isLoading: true })
    try {
      const res = await listChatSessions(kbId)
      set({ sessions: res.sessions })
    } catch (err) {
      console.error('[ChatStore] loadSessions failed:', err)
    } finally {
      set({ isLoading: false })
    }
  },

  saveSession: (session) => {
    // Optimistic update
    set((s) => ({
      sessions: [session, ...(s.sessions ?? []).filter((x) => x.id !== session.id)].slice(0, 100),
    }))
    // Background persist
    saveChatSession(session.id, {
      kb_id: session.kbId,
      messages: session.messages,
      preview: session.preview,
      mode: session.mode,
      timestamp: session.timestamp,
    }).catch((err) => console.error('[ChatStore] saveSession failed:', err))
  },

  deleteSession: (id) => {
    // Optimistic update
    set((s) => ({
      sessions: (s.sessions ?? []).filter((x) => x.id !== id),
      activeSessionId: s.activeSessionId === id ? null : s.activeSessionId,
    }))
    // Background delete
    deleteChatSession(id).catch((err) =>
      console.error('[ChatStore] deleteSession failed:', err)
    )
  },

  setActiveSessionId: (id) => set({ activeSessionId: id }),

  clearActiveSession: () => set({ activeSessionId: null }),

  clearAll: (kbId) => {
    // Optimistic update: only clear sessions that match the KB filter
    set((s) => ({
      sessions: kbId ? (s.sessions ?? []).filter((x) => x.kbId !== kbId) : [],
      activeSessionId: null,
    }))
    // Background clear
    clearChatSessions(kbId).catch((err) =>
      console.error('[ChatStore] clearAll failed:', err)
    )
  },
}))
