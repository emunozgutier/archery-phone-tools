import { useState, useEffect, useRef, useCallback } from 'react';

export interface SensorDataPoint {
  timestamp: number;
  pitch: number;
  roll: number;
  heading: number;
  vibration: number;
}

export interface CalibrationConfig {
  downPitch: number;  // The pitch when bow is pointing down
  aimPitch: number;   // The pitch when bow is level / aiming
  pitchTolerance: number; // How close to aiming pitch is considered "aiming" (default 12)
  minDownTimeMs: number; // Minimum time in down position to reset trigger (default 800)
}

export const useSensors = (onAutoTriggerStart?: () => void, onAutoTriggerStop?: () => void) => {
  const [permissionGranted, setPermissionGranted] = useState<boolean | null>(null);
  const [isSupported] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return 'DeviceOrientationEvent' in window && 'DeviceMotionEvent' in window;
  });
  const [orientation, setOrientation] = useState({ alpha: 0, beta: 0, gamma: 0, heading: 0 });
  const [acceleration, setAcceleration] = useState({ x: 0, y: 0, z: 0, total: 0 });
  
  // High-frequency vibration index (0-100)
  const [vibrationIndex, setVibrationIndex] = useState<number>(0);
  
  // Recording states
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [sensorHistory, setSensorHistory] = useState<SensorDataPoint[]>([]);
  const recordingBuffer = useRef<SensorDataPoint[]>([]);
  
  // Real-time rolling buffer for visual charts
  const rollingBuffer = useRef<SensorDataPoint[]>([]);
  
  // Auto-record trigger configuration & state
  const [calibration, setCalibration] = useState<CalibrationConfig>({
    downPitch: -55,        // Typical pointing-down beta angle (bow at rest)
    aimPitch: 5,           // Upright / aiming beta angle
    pitchTolerance: 15,    // Allowable deviation in aiming pitch
    minDownTimeMs: 1000,   // Min time in down position to arm the trigger
  });
  
  const [triggerState, setTriggerState] = useState<'IDLE' | 'ARMED' | 'AIMING'>('IDLE');
  
  const stateRef = useRef({
    isRecording: false,
    triggerState: 'IDLE' as 'IDLE' | 'ARMED' | 'AIMING',
    calibration: {
      downPitch: -55,
      aimPitch: 5,
      pitchTolerance: 15,
      minDownTimeMs: 1000,
    },
    lastDownTime: 0,
    aimEntryTime: 0,
  });

  // Haptic Feedback Utilities
  const triggerHapticSingle = () => {
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate(250); // Single long pulse
    }
  };

  const triggerHapticDouble = () => {
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate([120, 60, 120]); // Short-space-Short pulse
    }
  };

  const triggerHapticPulseShort = () => {
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate(50); // Super short tick
    }
  };

  // Keep ref in sync to avoid effect dependency re-triggers
  useEffect(() => {
    stateRef.current.isRecording = isRecording;
    stateRef.current.triggerState = triggerState;
    stateRef.current.calibration = calibration;
  }, [isRecording, triggerState, calibration]);

  // High-pass filter variables for accelerometer vibration tracking
  const prevAcc = useRef({ x: 0, y: 0, z: 0 });
  const vibrationFilter = useRef<number[]>([]); // Rolling window of recent filtered values

  // Dynamic axis correction based on mounting (e.g. Landscape vs Portrait)
  const [mountOrientation, setMountOrientation] = useState<'portrait' | 'landscape-left' | 'landscape-right'>('portrait');

  // Request permissions for iOS
  const requestPermissions = useCallback(async (): Promise<boolean> => {
    // Check if we are running in browser environment
    if (typeof window === 'undefined') return false;

    const deviceOrientationRequest = (DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> }).requestPermission;
    const deviceMotionRequest = (DeviceMotionEvent as unknown as { requestPermission?: () => Promise<string> }).requestPermission;

    try {
      let orientationGranted = false;
      let motionGranted = false;

      if (typeof deviceOrientationRequest === 'function') {
        const response = await deviceOrientationRequest();
        orientationGranted = response === 'granted';
      } else {
        orientationGranted = true; // Non-iOS browsers don't need explicit requestPermission
      }

      if (typeof deviceMotionRequest === 'function') {
        const response = await deviceMotionRequest();
        motionGranted = response === 'granted';
      } else {
        motionGranted = true;
      }

      const allGranted = orientationGranted && motionGranted;
      setPermissionGranted(allGranted);
      return allGranted;
    } catch (error) {
      console.error('Error requesting motion/orientation permissions:', error);
      setPermissionGranted(false);
      return false;
    }
  }, []);

  // Main listener for motion and orientation
  useEffect(() => {
    if (!permissionGranted) return;

    const handleOrientation = (event: DeviceOrientationEvent) => {
      // heading is webkitCompassHeading if available, otherwise relative alpha
      const heading = (event as unknown as { webkitCompassHeading?: number }).webkitCompassHeading || (360 - (event.alpha || 0));
      
      const newOrientation = {
        alpha: event.alpha || 0,
        beta: event.beta || 0,
        gamma: event.gamma || 0,
        heading: Math.round(heading),
      };
      
      setOrientation(newOrientation);

      // --- AUTO-TRIGGER DETECTOR ENGINE ---
      const now = Date.now();
      const currentPitch = newOrientation.beta; // pitch / tilt forward-back
      const config = stateRef.current.calibration;
      const currentTrigger = stateRef.current.triggerState;

      // 1. Detect Bow pointing DOWN
      // Pointer down means currentPitch is close to downPitch (e.g. within tolerance)
      const isDown = Math.abs(currentPitch - config.downPitch) < config.pitchTolerance * 1.5;
      
      if (isDown) {
        if (currentTrigger !== 'ARMED' && currentTrigger !== 'IDLE') {
          // If aiming, but pointed bow down, stop recording
          if (stateRef.current.isRecording) {
            triggerHapticDouble();
            if (onAutoTriggerStop) onAutoTriggerStop();
          }
          setTriggerState('ARMED');
          stateRef.current.lastDownTime = now;
        } else if (currentTrigger === 'IDLE') {
          // Down long enough arms the system
          if (stateRef.current.lastDownTime === 0) {
            stateRef.current.lastDownTime = now;
          } else if (now - stateRef.current.lastDownTime > config.minDownTimeMs) {
            setTriggerState('ARMED');
            triggerHapticPulseShort();
          }
        }
      } else {
        // 2. Detect transition to AIMING
        // Aiming means currentPitch is near aimPitch
        const isAiming = Math.abs(currentPitch - config.aimPitch) < config.pitchTolerance;

        if (isAiming) {
          if (currentTrigger === 'ARMED') {
            // Raised from DOWN to AIM!
            setTriggerState('AIMING');
            stateRef.current.aimEntryTime = now;
            
            // Pulse haptic engine to notify archer
            triggerHapticSingle();
            
            // Trigger automatic recording start callback
            if (onAutoTriggerStart) {
              onAutoTriggerStart();
            }
          }
        } else {
          // If we are aiming but drift way out of aiming bounds for too long, reset trigger
          const isWayOff = Math.abs(currentPitch - config.aimPitch) > config.pitchTolerance * 2.2;
          if (isWayOff && currentTrigger === 'AIMING') {
            // Archer put bow down or drew offline, stop recording
            if (stateRef.current.isRecording) {
              triggerHapticDouble();
              if (onAutoTriggerStop) onAutoTriggerStop();
            }
            setTriggerState('IDLE');
            stateRef.current.lastDownTime = 0;
          }
        }
      }
    };

    const handleMotion = (event: DeviceMotionEvent) => {
      const acc = event.acceleration || { x: 0, y: 0, z: 0 };
      const rawX = acc.x || 0;
      const rawY = acc.y || 0;
      const rawZ = acc.z || 0;
      
      // Calculate total instantaneous acceleration magnitude
      const total = Math.sqrt(rawX * rawX + rawY * rawY + rawZ * rawZ);
      setAcceleration({ x: rawX, y: rawY, z: rawZ, total });

      // Compute High-Frequency Vibration (High pass filtering)
      const diffX = rawX - prevAcc.current.x;
      const diffY = rawY - prevAcc.current.y;
      const diffZ = rawZ - prevAcc.current.z;
      
      prevAcc.current = { x: rawX, y: rawY, z: rawZ };

      const instantShake = Math.sqrt(diffX * diffX + diffY * diffY + diffZ * diffZ);
      
      // Keep a rolling buffer of 10 points for a moving average
      vibrationFilter.current.push(instantShake);
      if (vibrationFilter.current.length > 10) {
        vibrationFilter.current.shift();
      }

      const avgShake = vibrationFilter.current.reduce((a, b) => a + b, 0) / vibrationFilter.current.length;
      
      // Map to vibration scale (0 to 100). Baseline tremor is ~0.1 to 3.0 m/s^2
      // A typical fine-motor tremor is around 0.5 - 1.5, severe shake is 4.0+.
      const mappedVibration = Math.min(Math.round(avgShake * 22), 100);
      setVibrationIndex(mappedVibration);

      // Collect real-time rolling points for rendering
      const now = Date.now();
      const currentPoint: SensorDataPoint = {
        timestamp: now,
        pitch: Math.round(orientation.beta),
        roll: Math.round(orientation.gamma),
        heading: orientation.heading,
        vibration: mappedVibration,
      };

      rollingBuffer.current.push(currentPoint);
      if (rollingBuffer.current.length > 120) {
        rollingBuffer.current.shift(); // keep last 2 seconds at 60fps
      }

      // If active recording session, push to record buffer
      if (stateRef.current.isRecording) {
        recordingBuffer.current.push(currentPoint);
      }
    };

    window.addEventListener('deviceorientation', handleOrientation);
    window.addEventListener('devicemotion', handleMotion);

    return () => {
      window.removeEventListener('deviceorientation', handleOrientation);
      window.removeEventListener('devicemotion', handleMotion);
    };
  }, [permissionGranted, orientation.beta, orientation.gamma, orientation.heading, onAutoTriggerStart, onAutoTriggerStop]);

  // Start manual recording
  const startRecording = useCallback(() => {
    if (stateRef.current.isRecording) return;
    
    recordingBuffer.current = [];
    setIsRecording(true);
    triggerHapticSingle();
  }, []);

  // Stop manual recording
  const stopRecording = useCallback(() => {
    if (!stateRef.current.isRecording) return [];
    
    setIsRecording(false);
    triggerHapticDouble();
    
    const capturedData = [...recordingBuffer.current];
    setSensorHistory(capturedData);
    return capturedData;
  }, []);

  // Calibrate Pitch Angles
  const calibratePosition = useCallback((type: 'DOWN' | 'AIM') => {
    if (type === 'DOWN') {
      setCalibration(prev => ({
        ...prev,
        downPitch: Math.round(orientation.beta)
      }));
      triggerHapticPulseShort();
    } else {
      setCalibration(prev => ({
        ...prev,
        aimPitch: Math.round(orientation.beta)
      }));
      triggerHapticPulseShort();
    }
  }, [orientation.beta]);

  return {
    isSupported,
    permissionGranted,
    requestPermissions,
    orientation,
    acceleration,
    vibrationIndex,
    isRecording,
    sensorHistory,
    rollingBufferRef: rollingBuffer,
    calibration,
    setCalibration,
    triggerState,
    setTriggerState,
    calibratePosition,
    startRecording,
    stopRecording,
    mountOrientation,
    setMountOrientation
  };
};
