import { create } from 'zustand';
import type { ArcherySession } from '../components/SessionLibrary';
import { useErrorLog } from './useErrorLog';

interface GlobalState {
  activeTab: 'tracker' | 'recorder' | 'sessions' | 'calibration';
  isOnboarded: boolean;
  isMockActive: boolean;
  mockPitch: number;
  mockVibration: number;
  sessions: ArcherySession[];
  
  setActiveTab: (tab: GlobalState['activeTab']) => void;
  setIsOnboarded: (onboarded: boolean) => void;
  setIsMockActive: (active: boolean) => void;
  setMockPitch: (pitch: number) => void;
  setMockVibration: (vibration: number) => void;
  
  addSession: (session: ArcherySession) => void;
  deleteSession: (id: string) => void;
}

export const useGlobal = create<GlobalState>((set) => ({
  activeTab: 'tracker',
  isOnboarded: false,
  isMockActive: false,
  mockPitch: -60,
  mockVibration: 5,
  
  sessions: (() => {
    try {
      const saved = localStorage.getItem('archery_sessions');
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      console.error('Failed to load sessions from localStorage', e);
      return [];
    }
  })(),
  
  setActiveTab: (activeTab) => set({ activeTab }),
  
  setIsOnboarded: (isOnboarded) => {
    useErrorLog.getState().addLog(`Onboarding status changed to: ${isOnboarded}`);
    set({ isOnboarded });
  },
  
  setIsMockActive: (isMockActive) => {
    useErrorLog.getState().addLog(`Archery Simulator set to: ${isMockActive}`);
    set({ isMockActive });
  },
  
  setMockPitch: (mockPitch) => set({ mockPitch }),
  setMockVibration: (mockVibration) => set({ mockVibration }),
  
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
  
  deleteSession: (id) => {
    useErrorLog.getState().addLog(`Deleting session: ${id}`);
    set((state) => {
      const updated = state.sessions.filter((s) => s.id !== id);
      try {
        localStorage.setItem('archery_sessions', JSON.stringify(updated));
      } catch (e) {
        useErrorLog.getState().addLog('Failed to update sessions in localStorage after delete', 'error', String(e));
      }
      return { sessions: updated };
    });
  }
}));
