import { useState, useEffect, useRef } from 'react';
import { useSensors } from './hooks/useSensors';
import type { SensorDataPoint } from './hooks/useSensors';
import type { ArcherySession } from './components/SessionLibrary';
import { useCameraRecorder } from './hooks/useCameraRecorder';
import { Onboarding } from './components/Onboarding';
import { SensorChart } from './components/SensorChart';
import { HUDOverlay } from './components/HUDOverlay';
import { SessionLibrary } from './components/SessionLibrary';
import { useGlobal } from './store/useGlobal';
import { useErrorLog } from './store/useErrorLog';
import { useStateStore } from './store/useState';
import './App.css';

function App() {
  // Global Zustand Stores
  const {
    isOnboarded,
    setIsOnboarded,
    isMockActive,
    setIsMockActive,
    mockPitch,
    setMockPitch,

    sessions,
    addSession,
    deleteSession,
    updateSession,
    clearSessions,
    sensorRefreshRate,
    setSensorRefreshRate,
    cameraResolution,
    setCameraResolution,
    cameraFps,
    setCameraFps,
    // State machine additions:
    currentArrowNumber,
    setCurrentArrowNumber,
    preferredDistance,
    tempSessionData,
    setTempSessionData,
    isCameraEnabled,
    setIsCameraEnabled
  } = useGlobal();

  const { appState, setAppState, activeTab, setActiveTab } = useStateStore();

  const { logs, clearLogs } = useErrorLog();
  const mockIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [appVersion, setAppVersion] = useState<{ version: string; dateTime: string } | null>(null);
  const [showDownWarning, setShowDownWarning] = useState<'stopped' | 'blocked' | null>(null);
  const [clickCoord, setClickCoord] = useState<{ x: number; y: number; score: number } | null>(null);

  useEffect(() => {
    fetch(import.meta.env.BASE_URL + 'version.json')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && data.version) {
          setAppVersion({ version: data.version, dateTime: data.dateTime });
        }
      })
      .catch(() => {});
  }, []);

  // Auto-dismiss the bow-down warning popup after 4 seconds
  useEffect(() => {
    if (showDownWarning) {
      const timer = setTimeout(() => {
        setShowDownWarning(null);
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [showDownWarning]);

  // Hook initializations
  const camera = useCameraRecorder();

  // Hoisted callback refs to avoid access-before-declaration and hoisting lint errors in useSensors hook
  const autoRecordStartRef = useRef<() => void>(() => {});
  const autoRecordStopRef = useRef<() => void>(() => {});

  // Hook initializations (sensors depends on callback refs)
  const sensors = useSensors(
    () => autoRecordStartRef.current(),
    () => autoRecordStopRef.current()
  );

  // Sync hoisted callback refs inside an effect body to keep the render phase pure and compliant with React 19 ref assignment rules
  useEffect(() => {
    autoRecordStartRef.current = () => {
      if (activeTab === 'tracker' && camera.cameraActive && !isMockActive && !camera.isRecordingVideo) {
        camera.startVideoRecording();
      }
      sensors.startRecording();
    };

    autoRecordStopRef.current = () => {
      let capturedSensorPoints: SensorDataPoint[] = [];
      if (sensors.isRecording) {
        capturedSensorPoints = sensors.stopRecording();
      }
      
      const isVideo = camera.cameraActive && !isMockActive;
      const tempData: Partial<ArcherySession> = {
        id: Date.now().toString(),
        timestamp: Date.now(),
        type: isVideo ? 'video' : 'sensor',
        duration: Math.round(capturedSensorPoints.length / 60) || 4,
        avgVibration: Math.round(
          capturedSensorPoints.reduce((acc, curr) => acc + curr.vibration, 0) / 
          (capturedSensorPoints.length || 1)
        ),
        maxVibration: Math.max(...capturedSensorPoints.map((p) => p.vibration), 0),
        sensorData: capturedSensorPoints,
        videoUrl: null
      };

      setTempSessionData(tempData);

      if (camera.isRecordingVideo) {
        camera.stopVideoRecording();
      }

      setAppState('post_shot');
      setShowDownWarning('stopped');
    };
  }, [camera, sensors, activeTab, isMockActive, setAppState, setTempSessionData]);

  // Watch for compilation of recorded video to pair and save with sensor data
  useEffect(() => {
    if (camera.recordedVideoUrl && tempSessionData) {
      const updatedTemp = {
        ...tempSessionData,
        videoUrl: camera.recordedVideoUrl
      };
      setTempSessionData(updatedTemp);
      camera.resetVideo();
    }
  }, [camera.recordedVideoUrl, tempSessionData, setTempSessionData, camera]);

  // Auto-unlock onboarding when both Motion and Camera permissions are granted
  useEffect(() => {
    if (appState === 'permissions' && sensors.permissionGranted === true && camera.cameraActive === true) {
      useErrorLog.getState().addLog('Auto-unlocking onboarding: Both Motion & Camera permissions are active.');
      setIsOnboarded(true);
    }
  }, [appState, sensors.permissionGranted, camera.cameraActive, setIsOnboarded]);

  // Toggle sensor simulation
  const handleToggleMock = () => {
    const nextMock = !isMockActive;
    setIsMockActive(nextMock);
    if (nextMock) {
      setIsOnboarded(true);
    }
  };

  // Run mock pitch draw simulator (Bow down -> lift -> aiming hold)
  const simulateDrawCycle = () => {
    if (mockIntervalRef.current) clearInterval(mockIntervalRef.current as unknown as number);
    
    // Set bow pointing straight down
    setMockPitch(-65);
    useStateStore.getState().setTrackerState('stable_state_armed');
    
    let currentP = -65;
    const targetP = sensors.calibration.aimPitch;
    const step = (targetP - currentP) / 30; // 30 steps
    let stepCount = 0;

    mockIntervalRef.current = setInterval(() => {
      if (stepCount < 30) {
        currentP += step;
        setMockPitch(Math.round(currentP));
        stepCount++;
      } else {
        if (mockIntervalRef.current) clearInterval(mockIntervalRef.current as unknown as number);
        setMockPitch(targetP);
        useStateStore.getState().setTrackerState('stable_state_aim');
        
        // Start simulated auto-recording
        sensors.startRecording();
        if (activeTab === 'tracker') {
          camera.startVideoRecording();
        }
        
        // Simulate holding target for 6 seconds, then lowering bow
        setTimeout(() => {
          // Bow returns down
          setMockPitch(-65);
          useStateStore.getState().setTrackerState('stable_state_armed');
          
          // Stop simulated recording and compile session
          const mockData = generateMockSensorLog();
          sensors.stopRecording();
          camera.stopVideoRecording();
          
          setTimeout(() => {
            const newSession: ArcherySession = {
              id: Date.now().toString(),
              timestamp: Date.now(),
              type: activeTab === 'tracker' ? 'video' : 'sensor',
              duration: 6,
              avgVibration: 0,
              maxVibration: 0,
              sensorData: mockData,
              videoUrl: activeTab === 'tracker' ? 'https://www.w3schools.com/html/mov_bbb.mp4' : null // generic placeholder video for desktop simulator
            };
            addSession(newSession);
          }, 500);

        }, 6000);
      }
    }, 50);
  };

  const generateMockSensorLog = (): SensorDataPoint[] => {
    const log: SensorDataPoint[] = [];
    const now = Date.now();
    for (let i = 0; i < 300; i++) {
      const aimP = sensors.calibration.aimPitch;
      const alphaRad = (184 * Math.PI) / 180;
      const betaRad = (aimP * Math.PI) / 180;
      const gammaRad = (1.5 * Math.PI) / 180;
      
      const mX = Math.sin(alphaRad) * Math.cos(gammaRad);
      const mY = Math.cos(alphaRad) * Math.cos(betaRad);
      const mZ = -Math.sin(betaRad);

      log.push({
        timestamp: now - (300 - i) * 20,
        pitch: aimP + (Math.sin(i / 10) * 2),
        roll: Math.cos(i / 15) * 1.5,
        heading: 184,
        vibration: 0,
        accX: Math.round((Math.sin(i / 8) * 0.4 + (Math.random() * 0.1)) * 100) / 100,
        accY: Math.round((Math.cos(i / 10) * 0.3 + (Math.random() * 0.1)) * 100) / 100,
        accZ: Math.round((Math.sin(i / 12) * 0.5 + (Math.random() * 0.1)) * 100) / 100,
        magX: Math.round(mX * 100) / 100,
        magY: Math.round(mY * 100) / 100,
        magZ: Math.round(mZ * 100) / 100
      });
    }
    return log;
  };

  // Master Orientation readings (Mock overrides vs physical)
  const currentPitch = isMockActive ? mockPitch : sensors.orientation.beta;
  const currentRoll = isMockActive ? 2 : sensors.orientation.gamma;
  const currentHeading = isMockActive ? 184 : sensors.orientation.heading;

  // Master Gravity & Magnet readings (Mock overrides vs physical)
  const currentGravity = isMockActive 
    ? {
        x: 0,
        y: Math.round(9.81 * Math.cos((currentPitch * Math.PI) / 180) * 100) / 100,
        z: Math.round(-9.81 * Math.sin((currentPitch * Math.PI) / 180) * 100) / 100
      }
    : sensors.rawAccel;

  const currentMagnet = isMockActive
    ? {
        x: Math.round(Math.sin((currentHeading * Math.PI) / 180) * Math.cos((currentRoll * Math.PI) / 180) * 100) / 100,
        y: Math.round(Math.cos((currentHeading * Math.PI) / 180) * Math.cos((currentPitch * Math.PI) / 180) * 100) / 100,
        z: Math.round(-Math.sin((currentPitch * Math.PI) / 180) * 100) / 100
      }
    : sensors.rawMagnet || { x: 0, y: 0, z: 0 };




  const handleSavePostShot = () => {
    if (!tempSessionData) return;
    
    const finalSession: ArcherySession = {
      ...tempSessionData,
      arrowNumber: currentArrowNumber,
      distance: preferredDistance,
      score: clickCoord ? clickCoord.score : 0,
      arrowX: clickCoord ? clickCoord.x : 0,
      arrowY: clickCoord ? clickCoord.y : 0,
      isScored: false
    } as ArcherySession;
    
    addSession(finalSession);
    
    useErrorLog.getState().addLog(`Shot Saved: Arrow #${currentArrowNumber}, Score: ${finalSession.score} Points, Dist: ${preferredDistance}m`);
    
    // Reset state parameters
    setTempSessionData(null);
    setClickCoord(null);
    setCurrentArrowNumber(currentArrowNumber + 1);
    setAppState('active');
  };

  const handleDiscardPostShot = () => {
    if (tempSessionData?.videoUrl) {
      try {
        URL.revokeObjectURL(tempSessionData.videoUrl);
        useErrorLog.getState().addLog('Revoked temporary video URL for discarded shot.');
      } catch (e) {
        // ignore
      }
    }
    setTempSessionData(null);
    setClickCoord(null);
    setAppState('active');
    useErrorLog.getState().addLog('Shot Discarded.');
  };

  // Toggle manual recording start/stop
  const handleManualRecordToggle = () => {
    // If phone is pointed down, block start and show popup
    if (!sensors.isRecording && currentPitch < -35) {
      setShowDownWarning('blocked');
      useErrorLog.getState().addLog('Blocked recording start: phone is pointed down', 'warn');
      return;
    }

    if (sensors.isRecording) {
      const data = sensors.stopRecording();
      const isVideo = camera.cameraActive && !isMockActive;
      const tempData: Partial<ArcherySession> = {
        id: Date.now().toString(),
        timestamp: Date.now(),
        type: isVideo ? 'video' : 'sensor',
        duration: Math.round(data.length / 50) || 3,
        avgVibration: Math.round(
          data.reduce((acc, curr) => acc + curr.vibration, 0) / 
          (data.length || 1)
        ),
        maxVibration: Math.max(...data.map((p) => p.vibration), 0),
        sensorData: data,
        videoUrl: null
      };

      setTempSessionData(tempData);

      if (camera.isRecordingVideo) {
        camera.stopVideoRecording();
      }

      setAppState('post_shot');
    } else {
      sensors.startRecording();
    }
  };

  // Manage camera lifecycles based on preference and onboarding status
  useEffect(() => {
    if (isOnboarded && !isMockActive) {
      if (isCameraEnabled) {
        camera.startCamera();
      } else {
        camera.stopCamera();
      }
    }
  }, [isOnboarded, isMockActive, isCameraEnabled, camera]);

  const renderCalibrationMatrix = () => {
    const c = sensors.calibration;
    
    const getDegrees = (vec: { x: number; y: number; z: number } | null | undefined, axis: 'x' | 'y' | 'z') => {
      if (!vec) return null;
      const norm = Math.sqrt(vec.x * vec.x + vec.y * vec.y + vec.z * vec.z) || 1;
      const val = vec[axis];
      const clamped = Math.max(-1, Math.min(1, val / norm));
      return Math.round(Math.acos(clamped) * (180 / Math.PI));
    };

    const renderCell = (vec: { x: number; y: number; z: number } | null | undefined, axis: 'x' | 'y' | 'z', dominant: 'x' | 'y' | 'z' | null, defaultColor: string, isLive: boolean) => {
      const degVal = getDegrees(vec, axis);
      if (degVal === null || degVal === undefined) {
        return (
          <div style={{
            display: 'inline-block',
            fontSize: '10px',
            padding: '4px 8px',
            borderRadius: '6px',
            background: 'rgba(255, 255, 255, 0.01)',
            border: '1px dashed rgba(255, 255, 255, 0.1)',
            color: 'var(--text-secondary)',
            opacity: 0.4,
            textAlign: 'center',
            minWidth: '55px'
          }}>
            —
          </div>
        );
      }
      
      const isDominant = dominant === axis;
      const bg = isDominant 
        ? 'rgba(56, 189, 248, 0.12)' 
        : (isLive ? 'rgba(255, 255, 255, 0.03)' : 'rgba(0, 0, 0, 0.15)');
      const border = isDominant 
        ? '1px solid rgba(56, 189, 248, 0.4)' 
        : '1px solid rgba(255, 255, 255, 0.04)';
      const textColor = isDominant ? '#38bdf8' : defaultColor;
      const shadow = isDominant ? '0 0 10px rgba(56, 189, 248, 0.15)' : 'none';
      
      return (
        <div style={{
          display: 'inline-block',
          fontFamily: 'var(--mono)',
          fontSize: '11px',
          fontWeight: isDominant ? '700' : '600',
          padding: '4px 8px',
          borderRadius: '6px',
          background: bg,
          border: border,
          color: textColor,
          textAlign: 'center',
          minWidth: '55px',
          boxShadow: shadow,
          transition: 'all 0.2s ease'
        }}>
          {degVal}°
        </div>
      );
    };

    return (
      <div className="glass-card" style={{ 
        margin: '20px 0', 
        padding: '18px', 
        background: 'linear-gradient(135deg, rgba(22, 24, 35, 0.8) 0%, rgba(15, 17, 26, 0.8) 100%)', 
        border: '1px solid rgba(255, 255, 255, 0.08)',
        borderRadius: '20px',
        boxShadow: '0 12px 40px rgba(0, 0, 0, 0.4)'
      }}>
        <h4 style={{ 
          fontSize: '13px', 
          fontWeight: '700',
          color: '#fff', 
          margin: '0 0 16px 0', 
          textAlign: 'left', 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'space-between',
          letterSpacing: '-0.2px'
        }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '16px' }}>📊</span> Sensor Vector Alignment Matrix
          </span>
          <span style={{ 
            fontSize: '9px', 
            background: 'rgba(52, 199, 89, 0.12)', 
            border: '1px solid rgba(52, 199, 89, 0.3)', 
            color: 'var(--steady)', 
            padding: '2px 8px', 
            borderRadius: '50px',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            fontWeight: 'bold',
            animation: 'pulse 2s infinite ease-in-out'
          }}>
            <span style={{ width: '5px', height: '5px', borderRadius: '50%', backgroundColor: 'var(--steady)', display: 'inline-block' }}></span>
            LIVE FEED
          </span>
        </h4>
        
        <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px', textAlign: 'left', minWidth: '300px' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', color: 'var(--text-secondary)' }}>
                <th style={{ padding: '8px 4px', fontWeight: '600' }}>Sensor / State</th>
                <th style={{ padding: '8px 4px', color: 'var(--gold)', fontWeight: '600', textAlign: 'center' }}>X (Pitch)</th>
                <th style={{ padding: '8px 4px', color: 'var(--blue)', fontWeight: '600', textAlign: 'center' }}>Y (Roll)</th>
                <th style={{ padding: '8px 4px', color: 'var(--steady)', fontWeight: '600', textAlign: 'center' }}>Z (Heading)</th>
              </tr>
            </thead>
            <tbody>
              {/* Live Measurements Header */}
               <tr>
                 <td colSpan={4} style={{ padding: '10px 4px 6px 4px', fontSize: '9px', color: 'var(--text-secondary)', fontWeight: '700', letterSpacing: '0.5px', textTransform: 'uppercase' }}>
                   Live Telemetry
                 </td>
               </tr>
              <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                <td style={{ padding: '6px 4px', color: '#f8fafc', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ color: 'var(--gold)', fontSize: '12px' }}>⚖️</span> Gravity
                </td>
                <td style={{ padding: '6px 4px', textAlign: 'center' }}>{renderCell(currentGravity, 'x', null, 'var(--gold)', true)}</td>
                <td style={{ padding: '6px 4px', textAlign: 'center' }}>{renderCell(currentGravity, 'y', null, 'var(--blue)', true)}</td>
                <td style={{ padding: '6px 4px', textAlign: 'center' }}>{renderCell(currentGravity, 'z', null, 'var(--steady)', true)}</td>
              </tr>
              <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                <td style={{ padding: '6px 4px', color: '#f8fafc', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ color: 'var(--steady)', fontSize: '12px' }}>🧲</span> Magnet
                </td>
                <td style={{ padding: '6px 4px', textAlign: 'center' }}>{renderCell(currentMagnet, 'x', null, 'var(--gold)', true)}</td>
                <td style={{ padding: '6px 4px', textAlign: 'center' }}>{renderCell(currentMagnet, 'y', null, 'var(--blue)', true)}</td>
                <td style={{ padding: '6px 4px', textAlign: 'center' }}>{renderCell(currentMagnet, 'z', null, 'var(--steady)', true)}</td>
              </tr>
              
              {/* Resting Position Header */}
               <tr>
                 <td colSpan={4} style={{ padding: '12px 4px 6px 4px' }}>
                   <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                     <span style={{ fontSize: '9px', color: 'var(--text-secondary)', fontWeight: '700', letterSpacing: '0.5px', textTransform: 'uppercase' }}>
                       Resting Profile (DOWN)
                     </span>
                     <button
                       onClick={() => sensors.calibratePosition('DOWN', currentPitch, currentGravity, currentMagnet)}
                       style={{
                         background: c.restingGravity !== null ? 'rgba(52, 199, 89, 0.15)' : 'rgba(255, 255, 255, 0.08)',
                         border: c.restingGravity !== null ? '1px solid rgba(52, 199, 89, 0.3)' : '1px solid rgba(255, 255, 255, 0.1)',
                         color: c.restingGravity !== null ? 'var(--steady)' : 'var(--text-primary)',
                         fontSize: '9px',
                         fontWeight: '700',
                         padding: '4px 10px',
                         borderRadius: '20px',
                         cursor: 'pointer',
                         display: 'flex',
                         alignItems: 'center',
                         gap: '4px',
                         transition: 'all 0.2s ease',
                         outline: 'none',
                         WebkitTapHighlightColor: 'transparent'
                       }}
                     >
                       {c.restingGravity !== null ? `✓ Calibrated (${c.downPitch}°)` : "🏹 Set Resting Angle"}
                     </button>
                   </div>
                 </td>
               </tr>
              <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                <td style={{ padding: '6px 4px', color: 'var(--text-secondary)', fontWeight: '500', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span>⚖️</span> Gravity DOWN
                </td>
                <td style={{ padding: '6px 4px', textAlign: 'center' }}>{renderCell(c.restingGravity, 'x', c.gravityDominantAxis, 'var(--gold)', false)}</td>
                <td style={{ padding: '6px 4px', textAlign: 'center' }}>{renderCell(c.restingGravity, 'y', c.gravityDominantAxis, 'var(--blue)', false)}</td>
                <td style={{ padding: '6px 4px', textAlign: 'center' }}>{renderCell(c.restingGravity, 'z', c.gravityDominantAxis, 'var(--steady)', false)}</td>
              </tr>
              <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                <td style={{ padding: '6px 4px', color: 'var(--text-secondary)', fontWeight: '500', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span>🧲</span> Magnet DOWN
                </td>
                <td style={{ padding: '6px 4px', textAlign: 'center' }}>{renderCell(c.restingMagnet, 'x', c.magnetDominantAxis, 'var(--gold)', false)}</td>
                <td style={{ padding: '6px 4px', textAlign: 'center' }}>{renderCell(c.restingMagnet, 'y', c.magnetDominantAxis, 'var(--blue)', false)}</td>
                <td style={{ padding: '6px 4px', textAlign: 'center' }}>{renderCell(c.restingMagnet, 'z', c.magnetDominantAxis, 'var(--steady)', false)}</td>
              </tr>
              
              {/* Aiming Position Header */}
               <tr>
                 <td colSpan={4} style={{ padding: '12px 4px 6px 4px' }}>
                   <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                     <span style={{ fontSize: '9px', color: 'var(--text-secondary)', fontWeight: '700', letterSpacing: '0.5px', textTransform: 'uppercase' }}>
                       Aiming Profile (AIM)
                     </span>
                     <button
                       onClick={() => sensors.calibratePosition('AIM', currentPitch, currentGravity, currentMagnet)}
                       style={{
                         background: c.aimingGravity !== null ? 'rgba(52, 199, 89, 0.15)' : 'rgba(255, 255, 255, 0.08)',
                         border: c.aimingGravity !== null ? '1px solid rgba(52, 199, 89, 0.3)' : '1px solid rgba(255, 255, 255, 0.1)',
                         color: c.aimingGravity !== null ? 'var(--steady)' : 'var(--text-primary)',
                         fontSize: '9px',
                         fontWeight: '700',
                         padding: '4px 10px',
                         borderRadius: '20px',
                         cursor: 'pointer',
                         display: 'flex',
                         alignItems: 'center',
                         gap: '4px',
                         transition: 'all 0.2s ease',
                         outline: 'none',
                         WebkitTapHighlightColor: 'transparent'
                       }}
                     >
                       {c.aimingGravity !== null ? `✓ Calibrated (${c.aimPitch}°)` : "🎯 Set Aiming Angle"}
                     </button>
                   </div>
                 </td>
               </tr>
              <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                <td style={{ padding: '6px 4px', color: 'var(--text-secondary)', fontWeight: '500', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span>⚖️</span> Gravity AIM
                </td>
                <td style={{ padding: '6px 4px', textAlign: 'center' }}>{renderCell(c.aimingGravity, 'x', c.gravityDominantAxis, 'var(--gold)', false)}</td>
                <td style={{ padding: '6px 4px', textAlign: 'center' }}>{renderCell(c.aimingGravity, 'y', c.gravityDominantAxis, 'var(--blue)', false)}</td>
                <td style={{ padding: '6px 4px', textAlign: 'center' }}>{renderCell(c.aimingGravity, 'z', c.gravityDominantAxis, 'var(--steady)', false)}</td>
              </tr>
              <tr>
                <td style={{ padding: '6px 4px', color: 'var(--text-secondary)', fontWeight: '500', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span>🧲</span> Magnet AIM
                </td>
                <td style={{ padding: '6px 4px', textAlign: 'center' }}>{renderCell(c.aimingMagnet, 'x', c.magnetDominantAxis, 'var(--gold)', false)}</td>
                <td style={{ padding: '6px 4px', textAlign: 'center' }}>{renderCell(c.aimingMagnet, 'y', c.magnetDominantAxis, 'var(--blue)', false)}</td>
                <td style={{ padding: '6px 4px', textAlign: 'center' }}>{renderCell(c.aimingMagnet, 'z', c.magnetDominantAxis, 'var(--steady)', false)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        
        {/* Dominant Axis Results Feedback */}
        {(c.gravityDominantAxis || c.magnetDominantAxis) && (
          <div style={{
            marginTop: '16px',
            padding: '12px 14px',
            borderRadius: '12px',
            background: 'rgba(56, 189, 248, 0.06)',
            border: '1px solid rgba(56, 189, 248, 0.15)',
            fontSize: '11px',
            color: '#e2e8f0',
            textAlign: 'left',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px'
          }}>
            <strong style={{ color: '#38bdf8', fontSize: '11.5px', display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '2px' }}>
              🔑 Calibration Diagnostics:
            </strong>
            {c.gravityDominantAxis && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>Gravity Axis with Most Change:</span>
                <span style={{ 
                  fontSize: '10px', 
                  background: 'rgba(255, 204, 0, 0.12)', 
                  border: '1px solid rgba(255, 204, 0, 0.3)', 
                  color: 'var(--gold)', 
                  padding: '2px 8px', 
                  borderRadius: '4px',
                  fontWeight: '700',
                  textTransform: 'uppercase'
                }}>
                  {c.gravityDominantAxis}-Axis
                </span>
              </div>
            )}
            {c.magnetDominantAxis && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>Magnet Axis with Most Change:</span>
                <span style={{ 
                  fontSize: '10px', 
                  background: 'rgba(52, 199, 89, 0.12)', 
                  border: '1px solid rgba(52, 199, 89, 0.3)', 
                  color: 'var(--steady)', 
                  padding: '2px 8px', 
                  borderRadius: '4px',
                  fontWeight: '700',
                  textTransform: 'uppercase'
                }}>
                  {c.magnetDominantAxis}-Axis
                </span>
              </div>
            )}
            <p style={{ fontSize: '9.5px', color: 'var(--text-secondary)', marginTop: '4px', fontStyle: 'italic', lineHeight: '1.3' }}>
              The system has automatically selected these axes because they exhibit the greatest absolute vector changes between your resting and aiming postures, providing optimal stability tracking.
            </p>
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      {appState === 'permissions' ? (
        <Onboarding
          isSupported={sensors.isSupported}
          permissionGranted={sensors.permissionGranted}
          onRequestPermissions={sensors.requestPermissions}
          cameraActive={camera.cameraActive}
          onRequestCamera={camera.startCamera}
          onMockSetup={handleToggleMock}
          isMockActive={isMockActive}
          appVersion={appVersion}
        />
      ) : appState === 'calibrating' ? (
        <div className="scrollable" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', minHeight: '80%', padding: '20px' }}>
          <div className="glass-panel" style={{ padding: '24px', textAlign: 'center' }}>
            <h1 className="header-title" style={{ fontSize: '24px', marginBottom: '8px' }}>
              🏹 Sensor Calibration Wizard
            </h1>
            <p style={{ color: 'var(--text-secondary)', fontSize: '13px', lineHeight: '1.5', marginBottom: '24px' }}>
              Let's calibrate the auto-trigger angles before you start shooting.
            </p>



            {/* Live 6-Axis Matrix Grid */}
            {renderCalibrationMatrix()}

            {/* Proceed button */}
            <button
              className="btn-primary"
              style={{
                width: '100%',
                padding: '14px',
                fontSize: '14px',
                borderRadius: '12px',
                background: sensors.calibration.restingGravity !== null && sensors.calibration.aimingGravity !== null ? 'linear-gradient(135deg, var(--steady), #2196f3)' : 'rgba(255,255,255,0.05)',
                color: sensors.calibration.restingGravity !== null && sensors.calibration.aimingGravity !== null ? '#fff' : 'var(--text-secondary)',
                boxShadow: sensors.calibration.restingGravity !== null && sensors.calibration.aimingGravity !== null ? '0 4px 15px rgba(46, 204, 113, 0.3)' : 'none',
                cursor: sensors.calibration.restingGravity !== null && sensors.calibration.aimingGravity !== null ? 'pointer' : 'not-allowed'
              }}
              disabled={sensors.calibration.restingGravity === null || sensors.calibration.aimingGravity === null}
              onClick={() => {
                setAppState('active');
                setActiveTab('tracker');
              }}
            >
              🚀 Finish Setup & Enter Dashboard
            </button>
          </div>
        </div>
      ) : appState === 'post_shot' ? (
        <div style={{ 
          display: 'flex', 
          flexDirection: 'column', 
          justifyContent: 'center', 
          alignItems: 'center', 
          minHeight: '100vh', 
          padding: '24px', 
          boxSizing: 'border-box', 
          background: 'radial-gradient(circle at center, #0e1017 0%, #050508 100%)' 
        }}>
          <div className="glass-panel" style={{ 
            padding: '30px', 
            textAlign: 'center', 
            display: 'flex', 
            flexDirection: 'column', 
            alignItems: 'center',
            gap: '20px',
            maxWidth: '380px',
            width: '100%',
            boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
            border: '1px solid var(--border-glass)',
            borderRadius: '24px'
          }}>
            {/* Animated Target/Archery Success Icon */}
            <div style={{
              width: '80px',
              height: '80px',
              borderRadius: '50%',
              background: 'rgba(46, 204, 113, 0.1)',
              border: '2px dashed var(--steady)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 0 20px rgba(46, 204, 113, 0.2)',
              marginBottom: '10px'
            }} className="pulsing">
              <span style={{ fontSize: '36px' }}>🏹</span>
            </div>

            <div>
              <h2 className="header-title" style={{ fontSize: '24px', marginBottom: '8px', color: '#fff' }}>Shot Captured!</h2>
              <p style={{ color: 'var(--text-secondary)', fontSize: '13px', lineHeight: '1.5' }}>
                High-fidelity telemetry timeline and video recording are successfully compiled.
              </p>
            </div>

            {/* Large Info Card */}
            <div style={{
              background: 'rgba(255,255,255,0.02)',
              border: '1px solid var(--border-glass)',
              borderRadius: '16px',
              padding: '16px',
              width: '100%',
              boxSizing: 'border-box'
            }}>
              <span style={{ fontSize: '11px', color: 'var(--text-secondary)', display: 'block', textTransform: 'uppercase', letterSpacing: '1px' }}>STATUS</span>
              <strong style={{ fontSize: '18px', color: 'var(--steady)', display: 'block', marginTop: '6px' }}>
                Arrow #{currentArrowNumber} Recorded
              </strong>
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', width: '100%', marginTop: '8px' }}>
              <button
                className="btn-primary"
                style={{
                  width: '100%',
                  padding: '14px',
                  fontSize: '14px',
                  borderRadius: '10px',
                  background: !(tempSessionData?.type === 'video' && !tempSessionData?.videoUrl)
                    ? 'linear-gradient(135deg, var(--steady), #2ecc71)'
                    : 'rgba(255,255,255,0.05)',
                  color: !(tempSessionData?.type === 'video' && !tempSessionData?.videoUrl)
                    ? '#fff'
                    : 'var(--text-secondary)',
                  cursor: !(tempSessionData?.type === 'video' && !tempSessionData?.videoUrl)
                    ? 'pointer'
                    : 'not-allowed',
                  boxShadow: !(tempSessionData?.type === 'video' && !tempSessionData?.videoUrl)
                    ? '0 4px 15px rgba(46,204,113,0.3)'
                    : 'none'
                }}
                disabled={tempSessionData?.type === 'video' && !tempSessionData?.videoUrl}
                onClick={handleSavePostShot}
              >
                {tempSessionData?.type === 'video' && !tempSessionData?.videoUrl
                  ? '⏳ Compiling video segment...'
                  : '🟢 Save & Continue'}
              </button>

              <button
                className="btn-secondary"
                style={{ width: '100%', padding: '12px', fontSize: '13px', borderRadius: '10px', color: 'var(--unstable)', borderColor: 'rgba(255, 59, 48, 0.2)' }}
                onClick={handleDiscardPostShot}
              >
                🗑️ Discard Shot
              </button>
            </div>

          </div>
        </div>
      ) : (
        <>
          {/* Viewport Render Area */}
          <div style={{ flex: 1, position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            
            {/* Share camera stream or mock background as the global viewport background! */}
            {isCameraEnabled && !isMockActive && camera.stream ? (
              <video
                ref={(el) => {
                  if (el && camera.stream && el.srcObject !== camera.stream) {
                    el.srcObject = camera.stream;
                  }
                }}
                autoPlay
                playsInline
                muted
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  zIndex: 1
                }}
              />
            ) : isCameraEnabled && isMockActive ? (
              <div style={{
                width: '100%',
                height: '100%',
                background: 'radial-gradient(circle, #1a1a24 20%, #0a0b10 90%)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--text-secondary)',
                position: 'absolute',
                top: 0,
                left: 0,
                zIndex: 1
              }}>
                <span style={{ fontSize: '32px' }}>📷</span>
                <span style={{ fontSize: '13px', marginTop: '10px', opacity: 0.6 }}>Simulated Target Camera Feed</span>
              </div>
            ) : null}

            {/* Tab 1: Tracker & Recorder Unified View */}
            {activeTab === 'tracker' && (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative', zIndex: 2 }}>
                
                {/* Main Viewport: Live Camera Feed & Interactive reticle */}
                <div style={{ flex: 1, position: 'relative', overflow: 'hidden', minHeight: '320px' }}>
                  
                  {/* Live overlay HUD */}
                  <HUDOverlay
                    pitch={currentPitch}
                    roll={currentRoll}
                    heading={currentHeading}
                    triggerState={sensors.triggerState}
                    trackerState={sensors.trackerState}
                    isRecording={sensors.isRecording || camera.isRecordingVideo}
                    calibration={sensors.calibration}
                    onStopRecording={handleManualRecordToggle}
                  />

                  {/* Fallback overlays when camera is disabled or loading */}
                  {!isCameraEnabled ? (
                    <div style={{
                      width: '100%',
                      height: '100%',
                      background: 'radial-gradient(circle at center, #13141f 0%, #08080c 100%)',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'var(--text-secondary)',
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      zIndex: 1
                    }}>
                      <div style={{
                        width: '120px',
                        height: '120px',
                        borderRadius: '50%',
                        background: 'rgba(255, 204, 0, 0.03)',
                        border: '1px solid rgba(255, 204, 0, 0.1)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        marginBottom: '16px',
                        boxShadow: 'inset 0 0 20px rgba(255, 204, 0, 0.05)'
                      }}>
                        <span style={{ fontSize: '36px', filter: 'drop-shadow(0 0 10px rgba(255, 204, 0, 0.2))' }}>📊</span>
                      </div>
                      <h3 style={{ color: '#fff', fontSize: '15px', fontWeight: 600, margin: '0 0 6px 0' }}>Sensor-Only Telemetry Mode</h3>
                      <p style={{ fontSize: '11px', color: 'var(--text-secondary)', margin: 0, opacity: 0.7, maxWidth: '240px', lineHeight: '1.4', padding: '0 20px' }}>
                        Camera feedback is disabled. Real-time alignment telemetry and leveling are active.
                      </p>
                    </div>
                  ) : !camera.stream && !isMockActive ? (
                    <div style={{
                      width: '100%',
                      height: '100%',
                      background: '#0a0b10',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'var(--text-secondary)',
                      padding: '20px',
                      textAlign: 'center',
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      zIndex: 1
                    }}>
                      <span>Camera is loading...</span>
                      {camera.cameraError && <p style={{ color: 'var(--unstable)', fontSize: '12px', marginTop: '10px' }}>{camera.cameraError}</p>}
                    </div>
                  ) : null}



                </div>

                {/* Bottom Sensor Telemetry Timeline: Translucent Glassmorphic Dock */}
                <div style={{
                  padding: '12px 16px',
                  background: 'rgba(10, 11, 16, 0.85)',
                  borderTop: '1px solid var(--border-glass)',
                  backdropFilter: 'blur(10px)',
                  WebkitBackdropFilter: 'blur(10px)',
                  zIndex: 2
                }}>
                  {/* Arrow Selector Grid (1-12) during idle / arming */}
                  {(sensors.trackerState === 'idle' || 
                    sensors.trackerState === 'enter_state_armed' || 
                    sensors.trackerState === 'stable_state_armed') && (
                    <div style={{ 
                      marginBottom: '12px',
                      background: 'rgba(255, 255, 255, 0.02)',
                      border: '1px solid rgba(255, 255, 255, 0.05)',
                      borderRadius: '12px',
                      padding: '10px 12px',
                      pointerEvents: 'auto'
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                        <span style={{ fontSize: '11px', color: '#fff', fontWeight: 'bold' }}>🏹 Target Arrow Number</span>
                        <span style={{ fontSize: '10px', color: 'var(--gold)', fontWeight: 'bold' }}>Arrow #{currentArrowNumber}</span>
                      </div>
                      <div style={{ 
                        display: 'grid', 
                        gridTemplateColumns: 'repeat(12, 1fr)', 
                        gap: '4px' 
                      }}>
                        {Array.from({ length: 12 }, (_, i) => i + 1).map((num) => {
                          const isActive = currentArrowNumber === num;
                          const isAlreadyShot = sessions.some((s) => s.arrowNumber === num);
                          return (
                            <button
                              key={num}
                              onClick={() => {
                                setCurrentArrowNumber(num);
                                useErrorLog.getState().addLog(`Active arrow set to: #${num}`);
                              }}
                              style={{
                                border: isActive 
                                  ? 'none' 
                                  : isAlreadyShot 
                                    ? '1px solid rgba(255, 214, 10, 0.4)' 
                                    : 'none',
                                background: isActive 
                                  ? 'linear-gradient(135deg, var(--steady), #2ecc71)' 
                                  : isAlreadyShot 
                                    ? 'rgba(255, 214, 10, 0.15)' 
                                    : 'rgba(255,255,255,0.05)',
                                color: isActive 
                                  ? '#fff' 
                                  : isAlreadyShot 
                                    ? '#ffd60a' 
                                    : 'var(--text-secondary)',
                                fontSize: '11px',
                                fontWeight: 'bold',
                                height: '24px',
                                borderRadius: '6px',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                transition: 'all 0.15s ease',
                                boxShadow: isActive 
                                  ? '0 0 8px rgba(46,204,113,0.4)' 
                                  : isAlreadyShot 
                                    ? 'inset 0 0 4px rgba(255, 214, 10, 0.1)' 
                                    : 'none'
                              }}
                            >
                              {num}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <span style={{ fontSize: '11px', color: '#fff', fontWeight: 'bold' }}>Alignment Telemetry Timeline</span>
                    <span style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>Aim Hold History</span>
                  </div>
                  <SensorChart
                    rollingBufferRef={sensors.rollingBufferRef}
                    height={85}
                    calibration={sensors.calibration}
                    triggerState={sensors.triggerState}
                  />
                </div>

              </div>
            )}

            {/* Tab 3: Session Library View */}
            {activeTab === 'sessions' && (
              <div style={{ flex: 1, overflow: 'hidden', position: 'relative', zIndex: 2 }}>
                <SessionLibrary sessions={sessions} onDeleteSession={deleteSession} onClearSessions={clearSessions} onUpdateSession={updateSession} />
              </div>
            )}

            {/* Tab 4: Calibration View */}
            {activeTab === 'calibration' && (
              <div className="scrollable" style={{ position: 'relative', zIndex: 2 }}>
                <div style={{ marginBottom: '20px' }}>
                  <h2 className="header-title">Trigger Calibration</h2>
                  <p className="subtitle">Tailor the Auto-Record trigger to your mounting angle.</p>
                </div>

                <div className="glass-panel" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  


                  {/* Live 6-Axis Matrix Grid */}
                  {renderCalibrationMatrix()}

                  {/* Tolerance adjuster */}
                  <div className="glass-card" style={{ margin: 0 }}>
                    <label style={{ fontSize: '12px', color: '#fff', display: 'block', marginBottom: '8px' }}>
                      Aim Angle Tolerance: ±{sensors.calibration.pitchTolerance}°
                    </label>
                    <input
                      type="range"
                      min="5"
                      max="30"
                      value={sensors.calibration.pitchTolerance}
                      onChange={(e) => sensors.setCalibration({ pitchTolerance: parseInt(e.target.value) })}
                      style={{ width: '100%' }}
                    />
                  </div>

                  {/* Trigger diagnostics */}
                  <div className="glass-card" style={{ margin: 0, background: 'rgba(0,0,0,0.3)', borderLeft: '4px solid var(--blue)' }}>
                    <h4 style={{ fontSize: '13px', color: '#fff', marginBottom: '4px' }}>Trigger diagnostics</h4>
                    <p style={{ fontSize: '11px', color: 'var(--text-secondary)', lineHeight: '1.4' }}>
                      1. Rest bow: point phone to ground ({sensors.calibration.downPitch}° pitch). Trigger arms.<br />
                      2. Lift bow: aim at targets ({sensors.calibration.aimPitch}° pitch). Auto-record starts.
                    </p>
                  </div>
                </div>

                {/* Performance Preferences Panel */}
                <div className="glass-panel" style={{ marginTop: '20px', padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <h3 style={{ color: '#fff', fontSize: '15px', textAlign: 'left' }}>⚙️ Performance Preferences</h3>
                  <p className="subtitle" style={{ marginTop: '-8px', fontSize: '11px', textAlign: 'left' }}>Lower refresh rates and camera details to prevent phone lockups.</p>
                  
                  {/* Camera Feedback Toggle Card */}
                  <div className="glass-card" style={{
                    margin: 0,
                    padding: '14px 16px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    background: 'rgba(255,255,255,0.02)',
                    border: '1px solid var(--border-glass)',
                    borderRadius: '12px'
                  }}>
                    <div style={{ textAlign: 'left' }}>
                      <h4 style={{ color: '#fff', fontSize: '13px', margin: '0 0 4px 0', fontWeight: 600 }}>Camera Video Feed</h4>
                      <p style={{ fontSize: '10px', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.4 }}>
                        Disable feed to save battery and run in sensor-only mode.
                      </p>
                    </div>
                    
                    <div style={{ position: 'relative', display: 'inline-block', width: '48px', height: '24px' }}>
                      <button
                        onClick={() => {
                          setIsCameraEnabled(!isCameraEnabled);
                        }}
                        style={{
                          width: '100%',
                          height: '100%',
                          borderRadius: '12px',
                          background: isCameraEnabled ? 'linear-gradient(135deg, var(--steady), #2196f3)' : 'rgba(255,255,255,0.1)',
                          border: 'none',
                          position: 'relative',
                          cursor: 'pointer',
                          transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                          padding: 0,
                          boxShadow: isCameraEnabled ? '0 0 10px rgba(46, 204, 113, 0.4)' : 'none'
                        }}
                      >
                        <span style={{
                          position: 'absolute',
                          top: '2px',
                          left: isCameraEnabled ? '26px' : '2px',
                          width: '20px',
                          height: '20px',
                          borderRadius: '50%',
                          background: '#fff',
                          boxShadow: '0 2px 4px rgba(0,0,0,0.3)',
                          transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
                        }} />
                      </button>
                    </div>
                  </div>

                  {/* Sensor Rate Selection */}
                  <div>
                    <label style={{ fontSize: '12px', color: '#fff', display: 'block', marginBottom: '8px', textAlign: 'left' }}>
                      Sensor Update Rate: <strong style={{ color: 'var(--gold)' }}>{sensorRefreshRate}Hz</strong>
                    </label>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px' }}>
                      {[10, 15, 30, 60].map((rate) => {
                        const isSel = sensorRefreshRate === rate;
                        let label = `${rate}Hz`;
                        if (rate === 10) label = "10Hz (Low)";
                        else if (rate === 15) label = "15Hz (Bal)";
                        else if (rate === 30) label = "30Hz (High)";
                        else if (rate === 60) label = "60Hz (Max)";
                        
                        return (
                          <button
                            key={rate}
                            className="btn-secondary"
                            style={{
                              padding: '8px 4px',
                              fontSize: '10px',
                              borderRadius: '8px',
                              borderColor: isSel ? 'var(--gold)' : 'var(--border-glass)',
                              background: isSel ? 'rgba(255,204,0,0.15)' : 'rgba(255,255,255,0.03)',
                              color: isSel ? 'var(--gold)' : 'var(--text-primary)',
                              height: 'auto'
                            }}
                            onClick={() => setSensorRefreshRate(rate)}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Camera Resolution Preset */}
                  <div>
                    <label style={{ fontSize: '12px', color: '#fff', display: 'block', marginBottom: '8px', textAlign: 'left' }}>
                      Camera Resolution: <strong style={{ color: 'var(--blue)' }}>{cameraResolution.toUpperCase()}</strong>
                    </label>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr 1fr', gap: '6px' }}>
                      {(['low', 'medium', 'high'] as const).map((res) => {
                        const isSel = cameraResolution === res;
                        let label = "Medium (720p)";
                        if (res === 'low') label = "Low (480p)";
                        else if (res === 'high') label = "High (1080p)";
                        
                        return (
                          <button
                            key={res}
                            className="btn-secondary"
                            style={{
                              padding: '8px 4px',
                              fontSize: '10px',
                              borderRadius: '8px',
                              borderColor: isSel ? 'var(--blue)' : 'var(--border-glass)',
                              background: isSel ? 'rgba(0,122,255,0.15)' : 'rgba(255,255,255,0.03)',
                              color: isSel ? 'var(--blue)' : 'var(--text-primary)',
                              height: 'auto'
                            }}
                            onClick={() => {
                              setCameraResolution(res);
                              if (camera.cameraActive) {
                                camera.stopCamera();
                                setTimeout(() => camera.startCamera(), 300);
                              }
                            }}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Camera Capture Frame Rate */}
                  <div>
                    <label style={{ fontSize: '12px', color: '#fff', display: 'block', marginBottom: '8px', textAlign: 'left' }}>
                      Camera Capture Rate: <strong style={{ color: 'var(--blue)' }}>{cameraFps} FPS</strong>
                    </label>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px' }}>
                      {[15, 24, 30].map((fps) => {
                        const isSel = cameraFps === fps;
                        let label = `${fps} FPS`;
                        if (fps === 15) label = "15 FPS (Eco)";
                        else if (fps === 24) label = "24 FPS (Film)";
                        else if (fps === 30) label = "30 FPS (Smooth)";
                        
                        return (
                          <button
                            key={fps}
                            className="btn-secondary"
                            style={{
                              padding: '8px 4px',
                              fontSize: '10px',
                              borderRadius: '8px',
                              borderColor: isSel ? 'var(--blue)' : 'var(--border-glass)',
                              background: isSel ? 'rgba(0,122,255,0.15)' : 'rgba(255,255,255,0.03)',
                              color: isSel ? 'var(--blue)' : 'var(--text-primary)',
                              height: 'auto'
                            }}
                            onClick={() => {
                              setCameraFps(fps);
                              if (camera.cameraActive) {
                                camera.stopCamera();
                                setTimeout(() => camera.startCamera(), 300);
                              }
                            }}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                </div>

                {/* Simulator controls card (If simulation mode) */}
                {isMockActive && (
                  <div className="glass-panel" style={{ marginTop: '20px', border: '1px dashed var(--gold)' }}>
                    <h3 style={{ color: 'var(--gold)', fontSize: '15px', marginBottom: '12px' }}>💻 Desktop Simulator Controls</h3>
                    
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                      <button
                        className="btn-primary"
                        style={{ width: '100%', fontSize: '13px', padding: '10px' }}
                        onClick={simulateDrawCycle}
                      >
                        🚀 Simulate Draw & Shot Cycle (6s)
                      </button>

                      <div>
                        <label style={{ fontSize: '11px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
                          Manual Pitch adjustment: {mockPitch}°
                        </label>
                        <input
                          type="range"
                          min="-90"
                          max="90"
                          value={mockPitch}
                          onChange={(e) => {
                            setMockPitch(parseInt(e.target.value));
                            // Manually simulate trigger checks
                            const p = parseInt(e.target.value);
                            if (Math.abs(p - sensors.calibration.downPitch) < sensors.calibration.pitchTolerance) {
                              useStateStore.getState().setTrackerState('stable_state_armed');
                            } else if (Math.abs(p - sensors.calibration.aimPitch) < sensors.calibration.pitchTolerance) {
                              if (sensors.triggerState === 'ARMED') {
                                useStateStore.getState().setTrackerState('stable_state_aim');
                                autoRecordStartRef.current();
                              }
                            }
                          }}
                          style={{ width: '100%' }}
                        />
                      </div>

                    </div>
                  </div>
                )}

                {/* Real-time Diagnostics Log Panel for iOS Debugging */}
                <div className="glass-panel" style={{ marginTop: '20px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                    <h3 style={{ color: '#fff', fontSize: '15px' }}>📱 iOS System Diagnostics</h3>
                    <button
                      className="btn-secondary"
                      style={{ padding: '4px 10px', fontSize: '11px', borderRadius: '4px', height: 'auto' }}
                      onClick={clearLogs}
                    >
                      Clear
                    </button>
                  </div>
                  
                  <div style={{
                    maxHeight: '180px',
                    overflowY: 'auto',
                    background: 'rgba(0,0,0,0.5)',
                    border: '1px solid var(--border-glass)',
                    borderRadius: '8px',
                    padding: '10px',
                    fontSize: '10px',
                    fontFamily: 'var(--mono)',
                    textAlign: 'left',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px'
                  }}>
                    {logs.length === 0 ? (
                      <span style={{ color: 'var(--text-secondary)' }}>No entries yet.</span>
                    ) : (
                      logs.map((log) => {
                        let color = 'var(--text-secondary)';
                        if (log.level === 'error') color = 'var(--unstable)';
                        else if (log.level === 'warn') color = 'var(--tremor)';
                        else if (log.level === 'sensor') color = 'var(--gold)';
                        
                        return (
                          <div key={log.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)', paddingBottom: '4px' }}>
                            <span style={{ color: 'rgba(255,255,255,0.3)', marginRight: '6px' }}>
                              {new Date(log.timestamp).toLocaleTimeString([], { hour12: false })}
                            </span>
                            <span style={{ color }}>{log.message}</span>
                            {log.details && (
                              <pre style={{ margin: '2px 0 0 10px', color: 'rgba(255,255,255,0.4)', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                                {log.details}
                              </pre>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>

                {/* Subtle, premium version footer */}
                <div style={{ textAlign: 'center', marginTop: '24px', paddingBottom: '16px', fontSize: '11px', color: 'var(--text-secondary)' }}>
                  <span>Archery Telemetry v{appVersion?.version || '2026.22.3'}</span>
                  {appVersion?.dateTime && (
                    <span style={{ display: 'block', fontSize: '9px', marginTop: '4px', opacity: 0.5 }}>
                      Build Time: {appVersion.dateTime}
                    </span>
                  )}
                </div>
                
              </div>
            )}

            {/* Simulated Desktop Overlay Banner */}
            {isMockActive && activeTab !== 'calibration' && (
              <div style={{
                background: 'rgba(255, 204, 0, 0.15)',
                borderBottom: '1px solid var(--gold)',
                padding: '6px 12px',
                fontSize: '11px',
                color: 'var(--gold)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                zIndex: 12
              }}>
                <span>💻 Desktop Simulator Active ({mockPitch}° pitch)</span>
                <button
                  style={{ background: 'var(--gold)', border: 'none', color: '#000', fontSize: '9px', fontWeight: 'bold', padding: '2px 8px', borderRadius: '4px', cursor: 'pointer' }}
                  onClick={simulateDrawCycle}
                >
                  SIMULATE DRAW
                </button>
              </div>
            )}

            {/* Centered Glassmorphic Bow-Down Warning Popup Overlay */}
            {showDownWarning && (
              <div style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                zIndex: 100,
                background: 'rgba(26, 26, 36, 0.95)',
                border: showDownWarning === 'blocked' ? '1px solid var(--tremor)' : '1px solid var(--unstable)',
                borderRadius: '16px',
                padding: '20px',
                width: '260px',
                textAlign: 'center',
                boxShadow: '0 8px 30px rgba(0,0,0,0.8)',
                backdropFilter: 'blur(10px)',
                WebkitBackdropFilter: 'blur(10px)',
                pointerEvents: 'auto',
                animation: 'pulse 3s infinite ease-in-out'
              }}>
                <div style={{ fontSize: '32px', marginBottom: '12px' }}>
                  {showDownWarning === 'blocked' ? '🚫' : '🛑'}
                </div>
                <h3 style={{ color: '#fff', fontSize: '15px', marginBottom: '8px' }}>
                  {showDownWarning === 'blocked' ? 'Cannot Start' : 'Recording Stopped'}
                </h3>
                <p style={{ color: 'var(--text-secondary)', fontSize: '12px', lineHeight: '1.4', marginBottom: '16px' }}>
                  {showDownWarning === 'blocked' 
                    ? 'Recording cannot be started while the bow is pointed down. Lift your bow to aiming level first.' 
                    : 'Recording was stopped and saved because the bow was pointed down.'}
                </p>
                <button
                  className="btn-primary"
                  style={{
                    width: '100%',
                    padding: '8px 16px',
                    fontSize: '12px',
                    borderRadius: '8px',
                    background: showDownWarning === 'blocked' ? 'var(--blue)' : 'var(--unstable)',
                    border: 'none',
                    color: '#fff',
                    fontWeight: 'bold',
                    cursor: 'pointer'
                  }}
                  onClick={() => setShowDownWarning(null)}
                >
                  Dismiss
                </button>
              </div>
            )}

          </div>

          {/* Bottom Tab Navigation Bar */}
          <div style={{
            height: '66px',
            borderTop: '1px solid var(--border-glass)',
            background: 'rgba(10, 11, 16, 0.9)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            alignItems: 'center',
            zIndex: 15
          }}>
            <button
              onClick={() => setActiveTab('tracker')}
              style={{
                background: 'none',
                border: 'none',
                color: activeTab === 'tracker' ? 'var(--gold)' : 'var(--text-secondary)',
                fontSize: '11px',
                fontWeight: activeTab === 'tracker' ? 'bold' : 'normal',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '4px',
                cursor: 'pointer'
              }}
            >
              <span style={{ fontSize: '20px' }}>🎯</span>
              <span>Tracker</span>
            </button>

            <button
              onClick={() => setActiveTab('sessions')}
              style={{
                background: 'none',
                border: 'none',
                color: activeTab === 'sessions' ? 'var(--gold)' : 'var(--text-secondary)',
                fontSize: '11px',
                fontWeight: activeTab === 'sessions' ? 'bold' : 'normal',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '4px',
                cursor: 'pointer'
              }}
            >
              <span style={{ fontSize: '20px' }}>📚</span>
              <span>Sessions</span>
            </button>

            <button
              onClick={() => setActiveTab('calibration')}
              style={{
                background: 'none',
                border: 'none',
                color: activeTab === 'calibration' ? 'var(--gold)' : 'var(--text-secondary)',
                fontSize: '11px',
                fontWeight: activeTab === 'calibration' ? 'bold' : 'normal',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '4px',
                cursor: 'pointer'
              }}
            >
              <span style={{ fontSize: '20px' }}>⚙️</span>
              <span>Calibrate</span>
            </button>
          </div>
        </>
      )}
    </>
  )
}

export default App;
