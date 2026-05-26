import { useState, useEffect, useRef, useCallback } from 'react';

export const useCameraRecorder = () => {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isRecordingVideo, setIsRecordingVideo] = useState<boolean>(false);
  const [recordedVideoUrl, setRecordedVideoUrl] = useState<string | null>(null);
  const [cameraActive, setCameraActive] = useState<boolean>(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const videoChunksRef = useRef<Blob[]>([]);

  // Turn on the camera
  const startCamera = useCallback(async () => {
    if (stream) return stream;

    setCameraError(null);
    try {
      const constraints: MediaStreamConstraints = {
        video: {
          facingMode: 'environment', // Rear camera for looking downrange
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 }
        },
        audio: true // Record bow snap and arrow impact sounds
      };

      const mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
      setStream(mediaStream);
      setCameraActive(true);
      return mediaStream;
    } catch (err: unknown) {
      console.warn("Failed to open rear environment camera, falling back to any video device:", err);
      try {
        // Fallback for laptops / desktop debugging
        const fallbackStream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true
        });
        setStream(fallbackStream);
        setCameraActive(true);
        return fallbackStream;
      } catch (fallbackErr: unknown) {
        console.error("Camera permissions fully denied or unavailable:", fallbackErr);
        setCameraError("Camera access denied or device has no camera.");
        return null;
      }
    }
  }, [stream]);

  // Turn off the camera
  const stopCamera = useCallback(() => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
    }
    setCameraActive(false);
  }, [stream]);

  // Start recording video
  const startVideoRecording = useCallback(async () => {
    // Ensure camera is active
    let activeStream = stream;
    if (!activeStream) {
      activeStream = await startCamera();
    }

    if (!activeStream) {
      console.error("Cannot start video recording without an active stream");
      return;
    }

    try {
      videoChunksRef.current = [];
      const options = { mimeType: 'video/webm;codecs=vp8,opus' };
      let recorder: MediaRecorder;
      
      try {
        recorder = new MediaRecorder(activeStream, options);
      } catch {
        // Safari/iOS does not support webm, try mp4/H.264
        console.warn("WebM recording unsupported, trying Safari default format...");
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
        setRecordedVideoUrl(videoUrl);
      };

      recorder.start(250); // Slice data every 250ms
      setIsRecordingVideo(true);
    } catch (err) {
      console.error("Error starting video recording:", err);
      setCameraError("Could not start video recording: " + err);
    }
  }, [stream, startCamera]);

  // Stop recording video
  const stopVideoRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
      setIsRecordingVideo(false);
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, [stream]);

  const resetVideo = useCallback(() => {
    if (recordedVideoUrl) {
      URL.revokeObjectURL(recordedVideoUrl);
      setRecordedVideoUrl(null);
    }
    videoChunksRef.current = [];
  }, [recordedVideoUrl]);

  return {
    stream,
    cameraActive,
    cameraError,
    isRecordingVideo,
    recordedVideoUrl,
    startCamera,
    stopCamera,
    startVideoRecording,
    stopVideoRecording,
    resetVideo
  };
};
