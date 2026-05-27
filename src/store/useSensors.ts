import { create } from 'zustand';
import type { SensorDataPoint, CalibrationConfig } from '../hooks/useSensors';
import { useErrorLog } from './useErrorLog';
import { useGlobal } from './useGlobal';

interface SensorsState {
  isSupported: boolean;
  permissionGranted: boolean | null;
  
  // Throttled HUD state
  orientation: { alpha: number; beta: number; gamma: number; heading: number };
  vibrationIndex: number;
  rawAccel: { x: number; y: number; z: number };
  rawMagnet: { x: number; y: number; z: number };
  isRecording: boolean;
  
  calibration: CalibrationConfig;
  sensorHistory: SensorDataPoint[];
  
  // Camera Recorder Merged State
  stream: MediaStream | null;
  cameraActive: boolean;
  cameraError: string | null;
  isRecordingVideo: boolean;
  recordedVideoUrl: string | null;
  
  setPermissionGranted: (granted: boolean | null) => void;
  setCalibration: (config: Partial<CalibrationConfig>) => void;
  setIsRecording: (recording: boolean) => void;
  
  requestPermissions: () => Promise<boolean>;
  calibratePosition: (
    type: 'DOWN' | 'AIM',
    currentBeta: number,
    gravity: { x: number; y: number; z: number },
    magnet: { x: number; y: number; z: number }
  ) => void;
  
  startRecording: () => void;
  stopRecording: () => SensorDataPoint[];
  
  // Real-time raw storage
  resetHistory: () => void;
  pushHistoryPoint: (point: SensorDataPoint) => void;
  
  // Camera Recorder Merged Actions
  startCamera: () => Promise<MediaStream | null>;
  stopCamera: () => void;
  startVideoRecording: () => Promise<void>;
  stopVideoRecording: () => void;
  resetVideo: () => void;
}

// Module-level refs to store high-frequency readings without triggering React state updates
export const latestOrientationRef = { current: { alpha: 0, beta: 0, gamma: 0, heading: 0 } };
export const latestVibrationRef = { current: 0 };
export const latestAccelRef = { current: { x: 0, y: 0, z: 0 } };
export const latestMagnetRef = { current: { x: 0, y: 0, z: 0 } };

function getDominantAxis(
  v1: { x: number; y: number; z: number },
  v2: { x: number; y: number; z: number }
): 'x' | 'y' | 'z' {
  const dx = Math.abs(v2.x - v1.x);
  const dy = Math.abs(v2.y - v1.y);
  const dz = Math.abs(v2.z - v1.z);
  
  if (dx >= dy && dx >= dz) return 'x';
  if (dy >= dx && dy >= dz) return 'y';
  return 'z';
}
export const rollingBufferRef = { current: [] as SensorDataPoint[] };
export const recordingBufferRef = { current: [] as SensorDataPoint[] };
export const mediaRecorderRef = { current: null as MediaRecorder | null };
export const videoChunksRef = { current: [] as Blob[] };

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

const loadCalibrationFromStorage = (): CalibrationConfig => {
  const defaultCalibration: CalibrationConfig = {
    downPitch: -55,
    aimPitch: 5,
    pitchTolerance: 15,
    minDownTimeMs: 1000,
    restingGravity: null,
    aimingGravity: null,
    restingMagnet: null,
    aimingMagnet: null,
    gravityDominantAxis: null,
    magnetDominantAxis: null
  };
  
  try {
    const saved = localStorage.getItem('archery_sensor_calibration');
    if (saved) {
      const parsed = JSON.parse(saved);
      return { ...defaultCalibration, ...parsed };
    }
  } catch (e) {
    // ignore
  }
  return defaultCalibration;
};

export const useSensorsStore = create<SensorsState>((set, get) => ({
  isSupported: typeof window !== 'undefined' && 'DeviceOrientationEvent' in window && 'DeviceMotionEvent' in window,
  permissionGranted: null,
  
  orientation: { alpha: 0, beta: 0, gamma: 0, heading: 0 },
  vibrationIndex: 0,
  rawAccel: { x: 0, y: 0, z: 0 },
  rawMagnet: { x: 0, y: 0, z: 0 },
  isRecording: false,
  
  calibration: loadCalibrationFromStorage(),
  
  sensorHistory: [],
  
  // Camera Recorder Merged State
  stream: null,
  cameraActive: false,
  cameraError: null,
  isRecordingVideo: false,
  recordedVideoUrl: null,
  
  setPermissionGranted: (permissionGranted) => set({ permissionGranted }),
  
  setCalibration: (config) => set((state) => {
    const updated = { ...state.calibration, ...config };
    try {
      localStorage.setItem('archery_sensor_calibration', JSON.stringify(updated));
    } catch (e) {
      // ignore
    }
    return { calibration: updated };
  }),
  
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
  
  calibratePosition: (type, currentBeta, gravity, magnet) => {
    const rounded = Math.round(currentBeta);
    if (type === 'DOWN') {
      const updates: Partial<CalibrationConfig> = {
        downPitch: rounded,
        restingGravity: { ...gravity },
        restingMagnet: { ...magnet }
      };
      
      // Calculate dominant axis if both aiming and resting are set
      const aimGrav = get().calibration.aimingGravity;
      const aimMag = get().calibration.aimingMagnet;
      if (aimGrav) {
        updates.gravityDominantAxis = getDominantAxis(gravity, aimGrav);
      }
      if (aimMag) {
        updates.magnetDominantAxis = getDominantAxis(magnet, aimMag);
      }
      
      get().setCalibration(updates);
      useErrorLog.getState().addLog(`Calibrated BOW DOWN: Pitch ${rounded}°, Gravity (${gravity.x}, ${gravity.y}, ${gravity.z}), Magnet (${magnet.x}, ${magnet.y}, ${magnet.z})`);
    } else {
      const updates: Partial<CalibrationConfig> = {
        aimPitch: rounded,
        aimingGravity: { ...gravity },
        aimingMagnet: { ...magnet }
      };
      
      // Calculate dominant axis if both aiming and resting are set
      const restGrav = get().calibration.restingGravity;
      const restMag = get().calibration.restingMagnet;
      if (restGrav) {
        updates.gravityDominantAxis = getDominantAxis(restGrav, gravity);
      }
      if (restMag) {
        updates.magnetDominantAxis = getDominantAxis(restMag, magnet);
      }
      
      get().setCalibration(updates);
      useErrorLog.getState().addLog(`Calibrated AIMING: Pitch ${rounded}°, Gravity (${gravity.x}, ${gravity.y}, ${gravity.z}), Magnet (${magnet.x}, ${magnet.y}, ${magnet.z})`);
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
  },
  
  // Camera Recorder Merged Actions
  startCamera: async () => {
    if (get().stream) return get().stream;
    
    const { cameraResolution, cameraFps } = useGlobal.getState();
    useErrorLog.getState().addLog(`Activating camera: Resolution Preset=${cameraResolution}, FPS Target=${cameraFps}`);
    set({ cameraError: null });
    
    let idealWidth = 1280;
    let idealHeight = 720;
    if (cameraResolution === 'low') {
      idealWidth = 640;
      idealHeight = 480;
    } else if (cameraResolution === 'high') {
      idealWidth = 1920;
      idealHeight = 1080;
    }
    
    try {
      const constraints: MediaStreamConstraints = {
        video: {
          facingMode: 'environment',
          width: { ideal: idealWidth },
          height: { ideal: idealHeight },
          frameRate: { ideal: cameraFps }
        },
        audio: false
      };
      
      const mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
      set({ stream: mediaStream, cameraActive: true });
      useErrorLog.getState().addLog('Camera feed active: environment lens.');
      return mediaStream;
    } catch (err: unknown) {
      useErrorLog.getState().addLog('Failed to open environment lens, trying fallback', 'warn', String(err));
      try {
        const fallbackStream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false
        });
        set({ stream: fallbackStream, cameraActive: true });
        useErrorLog.getState().addLog('Camera feed active: fallback default lens.');
        return fallbackStream;
      } catch (fallbackErr: unknown) {
        useErrorLog.getState().addLog('Camera access fully denied', 'error', String(fallbackErr));
        set({ cameraError: 'Camera access denied or unavailable.', cameraActive: false });
        return null;
      }
    }
  },
  
  stopCamera: () => {
    const { stream } = get();
    if (stream) {
      useErrorLog.getState().addLog('Stopping camera stream tracks...');
      stream.getTracks().forEach((track) => track.stop());
      set({ stream: null, cameraActive: false });
    }
  },
  
  startVideoRecording: async () => {
    let activeStream = get().stream;
    if (!activeStream) {
      activeStream = await get().startCamera();
    }
    
    if (!activeStream) {
      useErrorLog.getState().addLog('Cannot record: active stream is missing', 'error');
      return;
    }
    
    try {
      useErrorLog.getState().addLog('Starting media recorder...');
      videoChunksRef.current = [];
      const options = { mimeType: 'video/webm;codecs=vp8,opus' };
      let recorder: MediaRecorder;
      
      try {
        recorder = new MediaRecorder(activeStream, options);
      } catch {
        useErrorLog.getState().addLog('WebM codec unsupported on this browser, trying default H264...', 'warn');
        recorder = new MediaRecorder(activeStream);
      }
      
      mediaRecorderRef.current = recorder;
      
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          videoChunksRef.current.push(event.data);
        }
      };
      
      recorder.onstop = () => {
        const videoBlob = new Blob(videoChunksRef.current, {
          type: videoChunksRef.current[0]?.type || 'video/mp4'
        });
        const videoUrl = URL.createObjectURL(videoBlob);
        set({ recordedVideoUrl: videoUrl });
        useErrorLog.getState().addLog(`Compiled recorded video segment: size=${videoBlob.size} bytes`);
      };
      
      recorder.start(250);
      set({ isRecordingVideo: true });
      useErrorLog.getState().addLog('Media recorder running.');
    } catch (err) {
      useErrorLog.getState().addLog('Failed to start MediaRecorder', 'error', String(err));
    }
  },
  
  stopVideoRecording: () => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      useErrorLog.getState().addLog('Stopping media recorder...');
      recorder.stop();
      set({ isRecordingVideo: false });
    }
  },
  
  resetVideo: () => {
    set({ recordedVideoUrl: null });
    videoChunksRef.current = [];
  }
}));
