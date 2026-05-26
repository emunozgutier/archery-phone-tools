import { useEffect, useRef, useCallback } from 'react';
import { useGlobal } from '../store/useGlobal';
import { useErrorLog } from '../store/useErrorLog';
import {
  useSensorsStore,
  latestOrientationRef,
  latestVibrationRef,
  rollingBufferRef,
  triggerHapticSingle,
  triggerHapticDouble,
  triggerHapticPulseShort
} from '../store/useSensors';

export interface SensorDataPoint {
  timestamp: number;
  pitch: number;
  roll: number;
  heading: number;
  vibration: number;
}

export interface CalibrationConfig {
  downPitch: number;
  aimPitch: number;
  pitchTolerance: number;
  minDownTimeMs: number;
}

export const useSensors = (onAutoTriggerStart?: () => void, onAutoTriggerStop?: () => void) => {
  const store = useSensorsStore();
  const addLog = useErrorLog(s => s.addLog);
  const sensorRefreshRate = useGlobal(s => s.sensorRefreshRate);

  // Use refs for callbacks to avoid re-binding event listeners when callbacks change
  const callbacksRef = useRef({ onAutoTriggerStart, onAutoTriggerStop });
  useEffect(() => {
    callbacksRef.current = { onAutoTriggerStart, onAutoTriggerStop };
  }, [onAutoTriggerStart, onAutoTriggerStop]);

  // High-pass filter variables for accelerometer vibration tracking
  const prevAcc = useRef({ x: 0, y: 0, z: 0 });
  const vibrationFilter = useRef<number[]>([]);

  // Main listener for orientation and motion.
  // CRITICAL: Empty dependency array ensures this registers EXACTLY ONCE on mount,
  // preventing event bindings from rapidly re-registering and freezing Safari ProMotion.
  useEffect(() => {
    if (!store.permissionGranted) return;

    addLog("Motion sensor listeners registering...");

    // Ref-based state variables to prevent closures from holding stale values
    const triggerStateRef = { current: useSensorsStore.getState().triggerState };
    const calibrationRef = { current: useSensorsStore.getState().calibration };
    const isRecordingRef = { current: useSensorsStore.getState().isRecording };
    const lastDownTimeRef = { current: 0 };

    // Keep trigger values synced in refs for high-frequency access
    const unsubscribe = useSensorsStore.subscribe((state) => {
      triggerStateRef.current = state.triggerState;
      calibrationRef.current = state.calibration;
      isRecordingRef.current = state.isRecording;
    });

    const handleOrientation = (event: DeviceOrientationEvent) => {
      const heading = (event as unknown as { webkitCompassHeading?: number }).webkitCompassHeading || (360 - (event.alpha || 0));
      
      const newOrientation = {
        alpha: event.alpha || 0,
        beta: event.beta || 0,
        gamma: event.gamma || 0,
        heading: Math.round(heading)
      };
      
      // Update high-frequency global ref instantly
      latestOrientationRef.current = newOrientation;

      // --- AUTO-TRIGGER DETECTOR ENGINE ---
      const now = Date.now();
      const currentPitch = newOrientation.beta;
      const config = calibrationRef.current;
      const currentTrigger = triggerStateRef.current;

      const isDown = Math.abs(currentPitch - config.downPitch) < config.pitchTolerance * 1.5;
      
      if (isDown) {
        if (currentTrigger !== 'ARMED' && currentTrigger !== 'IDLE') {
          // If aiming, but pointed bow down, stop recording
          if (isRecordingRef.current) {
            triggerHapticDouble();
            addLog("Auto-Record trigger: bow lowered (stop).");
            if (callbacksRef.current.onAutoTriggerStop) {
              callbacksRef.current.onAutoTriggerStop();
            }
          }
          useSensorsStore.getState().setTriggerState('ARMED');
          lastDownTimeRef.current = now;
        } else if (currentTrigger === 'IDLE') {
          if (lastDownTimeRef.current === 0) {
            lastDownTimeRef.current = now;
          } else if (now - lastDownTimeRef.current > config.minDownTimeMs) {
            useSensorsStore.getState().setTriggerState('ARMED');
            triggerHapticPulseShort();
            addLog("Auto-Record trigger: armed and ready.");
          }
        }
      } else {
        const isAiming = Math.abs(currentPitch - config.aimPitch) < config.pitchTolerance;

        if (isAiming) {
          if (currentTrigger === 'ARMED') {
            useSensorsStore.getState().setTriggerState('AIMING');
            triggerHapticSingle();
            addLog("Auto-Record trigger: bow raised to aiming level (start).");
            if (callbacksRef.current.onAutoTriggerStart) {
              callbacksRef.current.onAutoTriggerStart();
            }
          }
        } else {
          const isWayOff = Math.abs(currentPitch - config.aimPitch) > config.pitchTolerance * 2.2;
          if (isWayOff && currentTrigger === 'AIMING') {
            if (isRecordingRef.current) {
              triggerHapticDouble();
              addLog("Auto-Record trigger: bow lowered or offline (stop).");
              if (callbacksRef.current.onAutoTriggerStop) {
                callbacksRef.current.onAutoTriggerStop();
              }
            }
            useSensorsStore.getState().setTriggerState('IDLE');
            lastDownTimeRef.current = 0;
          }
        }
      }
    };

    const handleMotion = (event: DeviceMotionEvent) => {
      const acc = event.acceleration || { x: 0, y: 0, z: 0 };
      const rawX = acc.x || 0;
      const rawY = acc.y || 0;
      const rawZ = acc.z || 0;

      // Compute High-Frequency Vibration (High pass filtering)
      const diffX = rawX - prevAcc.current.x;
      const diffY = rawY - prevAcc.current.y;
      const diffZ = rawZ - prevAcc.current.z;
      
      prevAcc.current = { x: rawX, y: rawY, z: rawZ };

      const instantShake = Math.sqrt(diffX * diffX + diffY * diffY + diffZ * diffZ);
      
      vibrationFilter.current.push(instantShake);
      if (vibrationFilter.current.length > 10) {
        vibrationFilter.current.shift();
      }

      const avgShake = vibrationFilter.current.reduce((a, b) => a + b, 0) / vibrationFilter.current.length;
      const mappedVibration = Math.min(Math.round(avgShake * 22), 100);
      
      // Update high-frequency global ref instantly
      latestVibrationRef.current = mappedVibration;

      // Save real-time raw values in our 60fps rolling buffers
      const now = Date.now();
      const currentPoint: SensorDataPoint = {
        timestamp: now,
        pitch: Math.round(latestOrientationRef.current.beta),
        roll: Math.round(latestOrientationRef.current.gamma),
        heading: latestOrientationRef.current.heading,
        vibration: mappedVibration
      };

      rollingBufferRef.current.push(currentPoint);
      if (rollingBufferRef.current.length > 120) {
        rollingBufferRef.current.shift();
      }

      useSensorsStore.getState().pushHistoryPoint(currentPoint);
    };

    window.addEventListener('deviceorientation', handleOrientation);
    window.addEventListener('devicemotion', handleMotion);

    // --- VARIABLE DISPLAY THROTTLER TIMER ---
    // Only update standard React/Zustand state at the user-defined frequency to prevent mobile throttling.
    const throttleInterval = setInterval(() => {
      useSensorsStore.setState({
        orientation: { ...latestOrientationRef.current },
        vibrationIndex: latestVibrationRef.current
      });
    }, 1000 / sensorRefreshRate); // Dynamic refresh rate updates for HUD values

    return () => {
      addLog("Motion sensor listeners unregistering...");
      unsubscribe();
      window.removeEventListener('deviceorientation', handleOrientation);
      window.removeEventListener('devicemotion', handleMotion);
      clearInterval(throttleInterval);
    };
  }, [store.permissionGranted, addLog, sensorRefreshRate]);

  // Calibration and direct actions
  const calibratePosition = useCallback((type: 'DOWN' | 'AIM') => {
    store.calibratePosition(type, latestOrientationRef.current.beta);
  }, [store]);

  return {
    isSupported: store.isSupported,
    permissionGranted: store.permissionGranted,
    requestPermissions: store.requestPermissions,
    orientation: store.orientation,
    vibrationIndex: store.vibrationIndex,
    isRecording: store.isRecording,
    sensorHistory: store.sensorHistory,
    rollingBufferRef: rollingBufferRef,
    calibration: store.calibration,
    setCalibration: store.setCalibration,
    triggerState: store.triggerState,
    setTriggerState: store.setTriggerState,
    calibratePosition,
    startRecording: store.startRecording,
    stopRecording: store.stopRecording
  };
};
