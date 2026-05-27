import { useEffect, useRef, useCallback } from 'react';
import { useGlobal } from '../store/useGlobal';
import { useErrorLog } from '../store/useErrorLog';
import {
  useSensorsStore,
  latestOrientationRef,
  latestVibrationRef,
  latestAccelRef,
  latestMagnetRef,
  rollingBufferRef,
  triggerHapticSingle,
  triggerHapticPulseShort
} from '../store/useSensors';
import { useStateStore } from '../store/useState';
import type { TrackerState } from '../store/useState';

export interface SensorDataPoint {
  timestamp: number;
  pitch: number;
  roll: number;
  heading: number;
  vibration: number;
  accX: number;
  accY: number;
  accZ: number;
  magX: number;
  magY: number;
  magZ: number;
}

export interface CalibrationConfig {
  downPitch: number;
  aimPitch: number;
  pitchTolerance: number;
  minDownTimeMs: number;
  restingGravity: { x: number; y: number; z: number } | null;
  aimingGravity: { x: number; y: number; z: number } | null;
  restingMagnet: { x: number; y: number; z: number } | null;
  aimingMagnet: { x: number; y: number; z: number } | null;
  gravityDominantAxis: 'x' | 'y' | 'z' | null;
  magnetDominantAxis: 'x' | 'y' | 'z' | null;
}

export const useSensors = (onAutoTriggerStart?: () => void, onAutoTriggerStop?: () => void) => {
  const store = useSensorsStore();
  const stateStore = useStateStore();
  const addLog = useErrorLog(s => s.addLog);
  const sensorRefreshRate = useGlobal(s => s.sensorRefreshRate);

  // Use refs for callbacks to avoid re-binding event listeners when callbacks change
  const callbacksRef = useRef({ onAutoTriggerStart, onAutoTriggerStop });
  useEffect(() => {
    callbacksRef.current = { onAutoTriggerStart, onAutoTriggerStop };
  }, [onAutoTriggerStart, onAutoTriggerStop]);

  // Stability measuring is completely disabled


  // Main listener for orientation and motion.
  // CRITICAL: Empty dependency array ensures this registers EXACTLY ONCE on mount,
  // preventing event bindings from rapidly re-registering and freezing Safari ProMotion.
  useEffect(() => {
    if (!store.permissionGranted) return;

    addLog("Motion sensor listeners registering...");

    // Ref-based state variables to prevent closures from holding stale values
    const triggerStateRef = { current: useStateStore.getState().triggerState };
    const trackerStateRef = { current: useStateStore.getState().trackerState };
    const stateTimestampRef = { current: Date.now() };
    const calibrationRef = { current: useSensorsStore.getState().calibration };
    const isRecordingRef = { current: useSensorsStore.getState().isRecording };

    // Keep trigger values synced in refs for high-frequency access
    const unsubscribe = useStateStore.subscribe((state) => {
      triggerStateRef.current = state.triggerState;
      trackerStateRef.current = state.trackerState;
    });
    const unsubscribeSensors = useSensorsStore.subscribe((state) => {
      calibrationRef.current = state.calibration;
      isRecordingRef.current = state.isRecording;
    });

    const transitionTo = (nextState: TrackerState) => {
      addLog(`Tracker transition: ${trackerStateRef.current} -> ${nextState}`);
      trackerStateRef.current = nextState;
      stateTimestampRef.current = Date.now();
      useStateStore.getState().setTrackerState(nextState);
    };

    const evaluateStateMachine = () => {
      const now = Date.now();
      const currentPitch = latestOrientationRef.current.beta;
      const config = calibrationRef.current;
      
      const isDown = Math.abs(currentPitch - config.downPitch) < config.pitchTolerance * 1.5;
      const isAiming = Math.abs(currentPitch - config.aimPitch) < config.pitchTolerance;

      const currentState = trackerStateRef.current;
      const elapsed = now - stateTimestampRef.current;

      switch (currentState) {
        case 'idle':
          if (isDown) {
            const { sessions, currentArrowNumber } = useGlobal.getState();
            const isAlreadyShot = sessions.some((s) => s.arrowNumber === currentArrowNumber);
            if (!isAlreadyShot) {
              transitionTo('enter_state_armed');
            }
          }
          break;

        case 'enter_state_armed':
          if (isDown) {
            if (elapsed >= 2000) {
              transitionTo('stable_state_armed');
              triggerHapticPulseShort();
            }
          } else {
            transitionTo('idle');
          }
          break;

        case 'stable_state_armed':
          if (!isDown) {
            transitionTo('moving_to_state_aim');
          }
          break;

        case 'moving_to_state_aim':
          if (isAiming) {
            transitionTo('enter_aiming_aim');
          } else if (elapsed > 3000) {
            transitionTo('idle'); // timeout, draw cycle aborted
          }
          break;

        case 'enter_aiming_aim':
          if (isAiming) {
            if (elapsed >= 1000) {
              transitionTo('stable_state_aim');
              triggerHapticSingle();
              addLog("Auto-Record: Peak aiming steady state reached (starting capture).");
              if (callbacksRef.current.onAutoTriggerStart) {
                callbacksRef.current.onAutoTriggerStart();
              }
            }
          } else {
            transitionTo('moving_to_state_aim');
          }
          break;

        case 'stable_state_aim':
          if (isDown) {
            transitionTo('exit_aiming_aim');
          }
          break;

        case 'exit_aiming_aim':
          if (elapsed >= 3000) {
            addLog("Auto-Record: Follow-through complete (stopping capture).");
            if (callbacksRef.current.onAutoTriggerStop) {
              callbacksRef.current.onAutoTriggerStop();
            }
            transitionTo('idle');
          }
          break;

        default:
          break;
      }
    };

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
      evaluateStateMachine();
    };

    const handleMotion = (event: DeviceMotionEvent) => {


      // Capture static acceleration including gravity to show exactly which physical axes are aligned with gravity
      const grav = event.accelerationIncludingGravity || { x: 0, y: 0, z: 0 };
      latestAccelRef.current = {
        x: Math.round((grav.x || 0) * 100) / 100,
        y: Math.round((grav.y || 0) * 100) / 100,
        z: Math.round((grav.z || 0) * 100) / 100
      };

      // Stability measuring is completely disabled
      const mappedVibration = 0;
      latestVibrationRef.current = 0;

      // Save real-time raw values in our 60fps rolling buffers
      const now = Date.now();
      
      // Calculate Magnetic North Local Device Projections (project Earth Y-magnetic vector to local frame)
      const alphaRad = (latestOrientationRef.current.alpha * Math.PI) / 180;
      const betaRad = (latestOrientationRef.current.beta * Math.PI) / 180;
      const gammaRad = (latestOrientationRef.current.gamma * Math.PI) / 180;
      
      const mX = Math.sin(alphaRad) * Math.cos(gammaRad);
      const mY = Math.cos(alphaRad) * Math.cos(betaRad);
      const mZ = -Math.sin(betaRad);

      latestMagnetRef.current = {
        x: Math.round(mX * 100) / 100,
        y: Math.round(mY * 100) / 100,
        z: Math.round(mZ * 100) / 100
      };

      const currentPoint: SensorDataPoint = {
        timestamp: now,
        pitch: Math.round(latestOrientationRef.current.beta),
        roll: Math.round(latestOrientationRef.current.gamma),
        heading: latestOrientationRef.current.heading,
        vibration: mappedVibration,
        accX: latestAccelRef.current.x,
        accY: latestAccelRef.current.y,
        accZ: latestAccelRef.current.z,
        magX: Math.round(mX * 100) / 100,
        magY: Math.round(mY * 100) / 100,
        magZ: Math.round(mZ * 100) / 100
      };

      rollingBufferRef.current.push(currentPoint);
      if (rollingBufferRef.current.length > 120) {
        rollingBufferRef.current.shift();
      }

      useSensorsStore.getState().pushHistoryPoint(currentPoint);
    };

    window.addEventListener('deviceorientation', handleOrientation);
    window.addEventListener('devicemotion', handleMotion);

    // Only update standard React/Zustand state at the user-defined frequency to prevent mobile throttling.
    const throttleInterval = setInterval(() => {
      evaluateStateMachine();
      useSensorsStore.setState({
        orientation: { ...latestOrientationRef.current },
        vibrationIndex: latestVibrationRef.current,
        rawAccel: { ...latestAccelRef.current },
        rawMagnet: { ...latestMagnetRef.current }
      });
    }, 1000 / sensorRefreshRate); // Dynamic refresh rate updates for HUD values

    return () => {
      addLog("Motion sensor listeners unregistering...");
      unsubscribe();
      unsubscribeSensors();
      window.removeEventListener('deviceorientation', handleOrientation);
      window.removeEventListener('devicemotion', handleMotion);
      clearInterval(throttleInterval);
    };
  }, [store.permissionGranted, addLog, sensorRefreshRate]);

  // Calibration and direct actions
  const calibratePosition = useCallback((type: 'DOWN' | 'AIM', pitchVal?: number, gravityVal?: { x: number; y: number; z: number }, magnetVal?: { x: number; y: number; z: number }) => {
    const p = pitchVal !== undefined ? pitchVal : latestOrientationRef.current.beta;
    const g = gravityVal || latestAccelRef.current;
    const m = magnetVal || latestMagnetRef.current;
    store.calibratePosition(type, p, g, m);
  }, [store]);

  return {
    isSupported: store.isSupported,
    permissionGranted: store.permissionGranted,
    requestPermissions: store.requestPermissions,
    orientation: store.orientation,
    vibrationIndex: store.vibrationIndex,
    rawAccel: store.rawAccel,
    rawMagnet: store.rawMagnet,
    isRecording: store.isRecording,
    sensorHistory: store.sensorHistory,
    rollingBufferRef: rollingBufferRef,
    calibration: store.calibration,
    setCalibration: store.setCalibration,
    triggerState: stateStore.triggerState,
    setTriggerState: (state: 'IDLE' | 'ARMED' | 'AIMING') => useStateStore.getState().setAppState(state === 'IDLE' ? 'permissions' : 'active'),
    trackerState: stateStore.trackerState,
    setTrackerState: stateStore.setTrackerState,
    calibratePosition,
    startRecording: store.startRecording,
    stopRecording: store.stopRecording
  };
};
