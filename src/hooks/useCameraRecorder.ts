import { useCameraRecorderStore } from '../store/useCameraRecorder';

export const useCameraRecorder = () => {
  const store = useCameraRecorderStore();

  return {
    stream: store.stream,
    cameraActive: store.cameraActive,
    cameraError: store.cameraError,
    isRecordingVideo: store.isRecordingVideo,
    recordedVideoUrl: store.recordedVideoUrl,
    startCamera: store.startCamera,
    stopCamera: store.stopCamera,
    startVideoRecording: store.startVideoRecording,
    stopVideoRecording: store.stopVideoRecording,
    resetVideo: store.resetVideo
  };
};
