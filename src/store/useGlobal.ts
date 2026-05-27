import { create } from 'zustand';
import type { ArcherySession } from '../components/SessionLibrary';
import { useErrorLog } from './useErrorLog';
import { useStateStore } from './useState';

interface GlobalState {
  isOnboarded: boolean;
  isMockActive: boolean;
  mockPitch: number;
  mockVibration: number;
  sessions: ArcherySession[];
  
  // Performance and Refresh Settings
  sensorRefreshRate: number; // 10 | 15 | 30 | 60 Hz
  cameraResolution: 'low' | 'medium' | 'high';
  cameraFps: number; // 15 | 24 | 30 FPS
  
  // Arrow and Distance Tracking Settings
  currentArrowNumber: number;
  preferredDistance: number; // in meters (default 70)
  tempSessionData: Partial<ArcherySession> | null;
  isCameraEnabled: boolean;
  
  setIsOnboarded: (onboarded: boolean) => void;
  setIsMockActive: (active: boolean) => void;
  setMockPitch: (pitch: number) => void;
  setMockVibration: (vibration: number) => void;
  
  setSensorRefreshRate: (rate: number) => void;
  setCameraResolution: (res: GlobalState['cameraResolution']) => void;
  setCameraFps: (fps: number) => void;
  
  setCurrentArrowNumber: (num: number) => void;
  setPreferredDistance: (dist: number) => void;
  setTempSessionData: (data: Partial<ArcherySession> | null) => void;
  setIsCameraEnabled: (enabled: boolean) => void;
  
  addSession: (session: ArcherySession) => void;
  deleteSession: (id: string) => void;
  clearSessions: () => void;
}

export const useGlobal = create<GlobalState>((set) => ({
  isOnboarded: false,
  isMockActive: false,
  mockPitch: -60,
  mockVibration: 5,
  currentArrowNumber: 1,
  preferredDistance: 70,
  tempSessionData: null,
  isCameraEnabled: (() => {
    try {
      const saved = localStorage.getItem('archery_camera_enabled');
      return saved !== 'false';
    } catch {
      return true;
    }
  })(),
  
  sensorRefreshRate: (() => {
    try {
      const saved = localStorage.getItem('archery_sensor_rate');
      return saved ? parseInt(saved, 10) : 15;
    } catch {
      return 15;
    }
  })(),
  
  cameraResolution: (() => {
    try {
      const saved = localStorage.getItem('archery_cam_res');
      return (saved as unknown as GlobalState['cameraResolution']) || 'medium';
    } catch {
      return 'medium';
    }
  })(),
  
  cameraFps: (() => {
    try {
      const saved = localStorage.getItem('archery_cam_fps');
      return saved ? parseInt(saved, 10) : 30;
    } catch {
      return 30;
    }
  })(),
  
  sessions: (() => {
    try {
      const saved = localStorage.getItem('archery_sessions');
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      console.error('Failed to load sessions from localStorage', e);
      return [];
    }
  })(),
  
  
  setIsOnboarded: (isOnboarded) => {
    useErrorLog.getState().addLog(`Onboarding status changed to: ${isOnboarded}`);
    const nextState = isOnboarded ? 'calibrating' : 'permissions';
    set({ isOnboarded });
    useStateStore.getState().setAppState(nextState);
  },
  
  setIsMockActive: (isMockActive) => {
    useErrorLog.getState().addLog(`Archery Simulator set to: ${isMockActive}`);
    set({ isMockActive });
  },
  
  setMockPitch: (mockPitch) => set({ mockPitch }),
  setMockVibration: (mockVibration) => set({ mockVibration }),
  
  setSensorRefreshRate: (sensorRefreshRate) => {
    useErrorLog.getState().addLog(`Sensor refresh rate changed to: ${sensorRefreshRate}Hz`);
    try {
      localStorage.setItem('archery_sensor_rate', String(sensorRefreshRate));
    } catch (e) {
      console.warn('Failed to save sensor rate to localStorage', e);
    }
    set({ sensorRefreshRate });
  },
  
  setCameraResolution: (cameraResolution) => {
    useErrorLog.getState().addLog(`Camera resolution preset changed to: ${cameraResolution}`);
    try {
      localStorage.setItem('archery_cam_res', cameraResolution);
    } catch (e) {
      console.warn('Failed to save camera resolution to localStorage', e);
    }
    set({ cameraResolution });
  },
  
  setCameraFps: (cameraFps) => {
    useErrorLog.getState().addLog(`Camera capturing frame rate set to: ${cameraFps} FPS`);
    try {
      localStorage.setItem('archery_cam_fps', String(cameraFps));
    } catch (e) {
      console.warn('Failed to save camera FPS to localStorage', e);
    }
    set({ cameraFps });
  },
  
  setCurrentArrowNumber: (currentArrowNumber) => set({ currentArrowNumber }),
  setPreferredDistance: (preferredDistance) => set({ preferredDistance }),
  setTempSessionData: (tempSessionData) => set({ tempSessionData }),
  setIsCameraEnabled: (isCameraEnabled) => {
    useErrorLog.getState().addLog(`Camera feedback setting: ${isCameraEnabled ? 'Enabled' : 'Disabled'}`);
    try {
      localStorage.setItem('archery_camera_enabled', String(isCameraEnabled));
    } catch (e) {
      console.warn('Failed to save camera enabled preference to localStorage', e);
    }
    set({ isCameraEnabled });
  },
  
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
  },
  
  clearSessions: () => {
    useErrorLog.getState().addLog('Clearing all saved sessions...');
    try {
      localStorage.removeItem('archery_sessions');
    } catch (e) {
      useErrorLog.getState().addLog('Failed to clear sessions from localStorage', 'error', String(e));
    }
    set({ sessions: [] });
  }
}));
