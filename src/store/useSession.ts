import { create } from 'zustand';
import type { ArcherySession } from '../components/SessionLibrary';
import { useErrorLog } from './useErrorLog';

interface SessionState {
  sessions: ArcherySession[];
  addSession: (session: ArcherySession) => void;
  deleteSession: (id: string) => void;
  updateSession: (id: string, updates: Partial<ArcherySession>) => void;
  clearSessions: () => void;
}

export const useSession = create<SessionState>((set, get) => ({
  sessions: (() => {
    try {
      const saved = localStorage.getItem('archery_sessions');
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      console.error('Failed to load sessions from localStorage', e);
      return [];
    }
  })(),
  
  addSession: (session) => {
    useErrorLog.getState().addLog(`Saving new session: ${session.type} Mode, stability: ${100 - session.avgVibration}%`);
    set((state) => {
      const updated = [session, ...state.sessions];
      try {
        localStorage.setItem('archery_sessions', JSON.stringify(updated));
      } catch (e) {
        useErrorLog.getState().addLog('Failed to save session to localStorage', 'error', String(e));
      }
      return { sessions: updated };
    });
  },
  
  deleteSession: (id: string) => {
    useErrorLog.getState().addLog(`Deleting session: ${id}`);
    const session = get().sessions.find((s: ArcherySession) => s.id === id);
    if (session?.videoUrl) {
      try {
        URL.revokeObjectURL(session.videoUrl);
        useErrorLog.getState().addLog(`Revoked video URL for deleted session ${id}`);
      } catch (e) {
        useErrorLog.getState().addLog(`Failed to revoke video URL for session ${id}`, 'warn', String(e));
      }
    }
    set((state) => {
      const updated = state.sessions.filter((s: ArcherySession) => s.id !== id);
      try {
        localStorage.setItem('archery_sessions', JSON.stringify(updated));
      } catch (e) {
        useErrorLog.getState().addLog('Failed to update sessions in localStorage after delete', 'error', String(e));
      }
      return { sessions: updated };
    });
  },
  
  updateSession: (id: string, updates: Partial<ArcherySession>) => {
    useErrorLog.getState().addLog(`Updating session: ${id}`);
    set((state) => {
      const updated = state.sessions.map((s: ArcherySession) => s.id === id ? { ...s, ...updates } : s);
      try {
        localStorage.setItem('archery_sessions', JSON.stringify(updated));
      } catch (e) {
        useErrorLog.getState().addLog('Failed to update sessions in localStorage after update', 'error', String(e));
      }
      return { sessions: updated };
    });
  },
  
  clearSessions: () => {
    useErrorLog.getState().addLog('Clearing all saved sessions...');
    const { sessions } = get();
    sessions.forEach((session: ArcherySession) => {
      if (session.videoUrl) {
        try {
          URL.revokeObjectURL(session.videoUrl);
        } catch (e) {
          // ignore
        }
      }
    });
    try {
      localStorage.removeItem('archery_sessions');
    } catch (e) {
      useErrorLog.getState().addLog('Failed to clear sessions from localStorage', 'error', String(e));
    }
    set({ sessions: [] });
  }
}));
