import { create } from 'zustand';
import type { SensorDataPoint, CalibrationConfig } from '../hooks/useSensors';
import { useErrorLog } from './useErrorLog';

interface SensorsState {
  isSupported: boolean;
  permissionGranted: boolean | null;
  
  // Throttled HUD state
  orientation: { alpha: number; beta: number; gamma: number; heading: number };
  vibrationIndex: number;
  rawAccel: { x: number; y: number; z: number };
  triggerState: 'IDLE' | 'ARMED' | 'AIMING';
  isRecording: boolean;
  
  calibration: CalibrationConfig;
  sensorHistory: SensorDataPoint[];
  
  setPermissionGranted: (granted: boolean | null) => void;
  setCalibration: (config: Partial<CalibrationConfig>) => void;
  setTriggerState: (state: SensorsState['triggerState']) => void;
  setIsRecording: (recording: boolean) => void;
  
  requestPermissions: () => Promise<boolean>;
  calibratePosition: (type: 'DOWN' | 'AIM', currentBeta: number) => void;
  
  startRecording: () => void;
  stopRecording: () => SensorDataPoint[];
  
  // Real-time raw storage
  resetHistory: () => void;
  pushHistoryPoint: (point: SensorDataPoint) => void;
}

// Module-level refs to store high-frequency readings without triggering React state updates
export const latestOrientationRef = { current: { alpha: 0, beta: 0, gamma: 0, heading: 0 } };
export const latestVibrationRef = { current: 0 };
export const latestAccelRef = { current: { x: 0, y: 0, z: 0 } };
export const rollingBufferRef = { current: [] as SensorDataPoint[] };
export const recordingBufferRef = { current: [] as SensorDataPoint[] };

// Diagnostic haptic vibration utilities
export const triggerHapticSingle = () => {
  if (typeof navigator !== 'undefined' && navigator.vibrate) {
    navigator.vibrate(250);
  }
};

export const triggerHapticDouble = () => {
  if (typeof navigator !== 'undefined' && navigator.vibrate) {
    navigator.vibrate([120, 60, 120]);
  }
};

export const triggerHapticPulseShort = () => {
  if (typeof navigator !== 'undefined' && navigator.vibrate) {
    navigator.vibrate(50);
  }
};

export const useSensorsStore = create<SensorsState>((set, get) => ({
  isSupported: typeof window !== 'undefined' && 'DeviceOrientationEvent' in window && 'DeviceMotionEvent' in window,
  permissionGranted: null,
  
  orientation: { alpha: 0, beta: 0, gamma: 0, heading: 0 },
  vibrationIndex: 0,
  rawAccel: { x: 0, y: 0, z: 0 },
  triggerState: 'IDLE',
  isRecording: false,
  
  calibration: {
    downPitch: -55,
    aimPitch: 5,
    pitchTolerance: 15,
    minDownTimeMs: 1000
  },
  
  sensorHistory: [],
  
  setPermissionGranted: (permissionGranted) => set({ permissionGranted }),
  
  setCalibration: (config) => set((state) => ({
    calibration: { ...state.calibration, ...config }
  })),
  
  setTriggerState: (triggerState) => {
    useErrorLog.getState().addLog(`Trigger state changed to: ${triggerState}`);
    set({ triggerState });
  },
  
  setIsRecording: (isRecording) => set({ isRecording }),
  
  requestPermissions: async () => {
    if (typeof window === 'undefined') return false;
    
    useErrorLog.getState().addLog('Requesting motion and orientation permissions...');
    
    const deviceOrientationRequest = (DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> }).requestPermission;
    const deviceMotionRequest = (DeviceMotionEvent as unknown as { requestPermission?: () => Promise<string> }).requestPermission;
    
    try {
      let orientationGranted = false;
      let motionGranted = false;
      
      if (typeof deviceOrientationRequest === 'function') {
        const response = await deviceOrientationRequest();
        useErrorLog.getState().addLog(`iOS Orientation Permission: ${response}`);
        orientationGranted = response === 'granted';
      } else {
        useErrorLog.getState().addLog('Standard Orientation Permission: granted (default)');
        orientationGranted = true;
      }
      
      if (typeof deviceMotionRequest === 'function') {
        const response = await deviceMotionRequest();
        useErrorLog.getState().addLog(`iOS Motion Permission: ${response}`);
        motionGranted = response === 'granted';
      } else {
        useErrorLog.getState().addLog('Standard Motion Permission: granted (default)');
        motionGranted = true;
      }
      
      const allGranted = orientationGranted && motionGranted;
      set({ permissionGranted: allGranted });
      return allGranted;
    } catch (error) {
      useErrorLog.getState().addLog('Sensor permissions rejected or error raised', 'error', String(error));
      set({ permissionGranted: false });
      return false;
    }
  },
  
  calibratePosition: (type, currentBeta) => {
    const rounded = Math.round(currentBeta);
    if (type === 'DOWN') {
      get().setCalibration({ downPitch: rounded });
      useErrorLog.getState().addLog(`Calibrated BOW DOWN Pitch to: ${rounded}°`);
    } else {
      get().setCalibration({ aimPitch: rounded });
      useErrorLog.getState().addLog(`Calibrated AIMING Pitch to: ${rounded}°`);
    }
    triggerHapticPulseShort();
  },
  
  startRecording: () => {
    if (get().isRecording) return;
    
    useErrorLog.getState().addLog('Manual/Auto recording started.');
    recordingBufferRef.current = [];
    set({ isRecording: true });
    triggerHapticSingle();
  },
  
  stopRecording: () => {
    if (!get().isRecording) return [];
    
    useErrorLog.getState().addLog('Manual/Auto recording stopped.');
    set({ isRecording: false });
    triggerHapticDouble();
    
    const capturedData = [...recordingBufferRef.current];
    set({ sensorHistory: capturedData });
    return capturedData;
  },
  
  resetHistory: () => {
    set({ sensorHistory: [] });
  },
  
  pushHistoryPoint: (point) => {
    if (get().isRecording) {
      recordingBufferRef.current.push(point);
    }
  }
}));
