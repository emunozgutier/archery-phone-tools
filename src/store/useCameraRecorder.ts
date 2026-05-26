import { create } from 'zustand';
import { useErrorLog } from './useErrorLog';
import { useGlobal } from './useGlobal';

interface CameraRecorderState {
  stream: MediaStream | null;
  cameraActive: boolean;
  cameraError: string | null;
  isRecordingVideo: boolean;
  recordedVideoUrl: string | null;
  
  startCamera: () => Promise<MediaStream | null>;
  stopCamera: () => void;
  startVideoRecording: () => Promise<void>;
  stopVideoRecording: () => void;
  resetVideo: () => void;
}

// Module-level references for MediaRecorder and chunks to prevent rendering side-effects
export const mediaRecorderRef = { current: null as MediaRecorder | null };
export const videoChunksRef = { current: [] as Blob[] };

export const useCameraRecorderStore = create<CameraRecorderState>((set, get) => ({
  stream: null,
  cameraActive: false,
  cameraError: null,
  isRecordingVideo: false,
  recordedVideoUrl: null,
  
  startCamera: async () => {
    if (get().stream) return get().stream;
    
    const { cameraResolution, cameraFps } = useGlobal.getState();
    useErrorLog.getState().addLog(`Activating camera: Resolution Preset=${cameraResolution}, FPS Target=${cameraFps}`);
    set({ cameraError: null });
    
    // Map human readable presets to ideal video width/height constraints
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
          facingMode: 'environment', // Rear-facing camera
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
      
      recorder.start(250); // slice chunks every 250ms
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
    const { recordedVideoUrl } = get();
    if (recordedVideoUrl) {
      URL.revokeObjectURL(recordedVideoUrl);
      set({ recordedVideoUrl: null });
    }
    videoChunksRef.current = [];
  }
}));
