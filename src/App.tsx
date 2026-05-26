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
import { useSensorsStore } from './store/useSensors';
import './App.css';

function App() {
  // Global Zustand Stores
  const {
    activeTab,
    setActiveTab,
    isOnboarded,
    setIsOnboarded,
    isMockActive,
    setIsMockActive,
    mockPitch,
    setMockPitch,
    mockVibration,
    setMockVibration,
    sessions,
    addSession,
    deleteSession,
    clearSessions,
    sensorRefreshRate,
    setSensorRefreshRate,
    cameraResolution,
    setCameraResolution,
    cameraFps,
    setCameraFps,
    // State machine additions:
    appState,
    setAppState,
    currentArrowNumber,
    setCurrentArrowNumber,
    preferredDistance,
    setPreferredDistance,
    tempSessionData,
    setTempSessionData,
    isCameraEnabled,
    setIsCameraEnabled
  } = useGlobal();

  const { logs, clearLogs } = useErrorLog();
  const mockIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [appVersion, setAppVersion] = useState<{ version: string; dateTime: string } | null>(null);
  const [showDownWarning, setShowDownWarning] = useState<'stopped' | 'blocked' | null>(null);
  const [clickCoord, setClickCoord] = useState<{ x: number; y: number; score: number } | null>(null);

  useEffect(() => {
    fetch('./version.json')
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
      if (activeTab === 'tracker' && camera.cameraActive) {
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
    useSensorsStore.getState().setTriggerState('ARMED');
    
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
        useSensorsStore.getState().setTriggerState('AIMING');
        
        // Start simulated auto-recording
        sensors.startRecording();
        if (activeTab === 'tracker') {
          camera.startVideoRecording();
        }
        
        // Simulate holding target for 6 seconds, then lowering bow
        setTimeout(() => {
          // Bow returns down
          setMockPitch(-65);
          useSensorsStore.getState().setTriggerState('ARMED');
          
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
              avgVibration: 12,
              maxVibration: 32,
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
        vibration: Math.max(3, Math.round(8 + Math.sin(i / 5) * 6 + (Math.random() * 4))),
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
  const currentVibration = isMockActive ? mockVibration : sensors.vibrationIndex;

  // Click handler for interactive FITA target face
  const handleTargetClick = (e: React.MouseEvent<SVGSVGElement, MouseEvent>) => {
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    
    // Coordinates relative to SVG center (110, 110)
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;
    
    const size = 220;
    const cx = size / 2;
    const cy = size / 2;
    const dx = clickX - cx;
    const dy = clickY - cy;
    
    const maxRadius = 100; // Radius of outer circle in SVG
    const dist = Math.sqrt(dx * dx + dy * dy);
    
    // Clamp coordinates to target boundaries
    let normX = dx;
    let normY = dy;
    if (dist > maxRadius) {
      const scale = maxRadius / dist;
      normX *= scale;
      normY *= scale;
    }
    
    // Calculate FITA target score (10 to 1) based on normalized distance
    const normDist = Math.sqrt(normX * normX + normY * normY);
    let calculatedScore = 0;
    if (normDist <= 10) calculatedScore = 10;
    else if (normDist <= 20) calculatedScore = 9;
    else if (normDist <= 30) calculatedScore = 8;
    else if (normDist <= 40) calculatedScore = 7;
    else if (normDist <= 50) calculatedScore = 6;
    else if (normDist <= 60) calculatedScore = 5;
    else if (normDist <= 70) calculatedScore = 4;
    else if (normDist <= 80) calculatedScore = 3;
    else if (normDist <= 90) calculatedScore = 2;
    else if (normDist <= 100) calculatedScore = 1;
    
    setClickCoord({
      x: Math.round(normX),
      y: Math.round(normY),
      score: calculatedScore
    });
  };

  const handleSavePostShot = () => {
    if (!tempSessionData) return;
    
    const finalSession: ArcherySession = {
      ...tempSessionData,
      arrowNumber: currentArrowNumber,
      distance: preferredDistance,
      score: clickCoord ? clickCoord.score : 0,
      arrowX: clickCoord ? clickCoord.x : 0,
      arrowY: clickCoord ? clickCoord.y : 0
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

      if (camera.cameraActive) {
        camera.stopVideoRecording();
      }

      setAppState('post_shot');
    } else {
      if (camera.cameraActive) {
        camera.startVideoRecording();
      }
      sensors.startRecording();
    }
  };

  // Manage camera lifecycles based on tab states and preference
  useEffect(() => {
    if (isOnboarded && !isMockActive) {
      if (activeTab === 'tracker' && isCameraEnabled) {
        camera.startCamera();
      } else {
        camera.stopCamera();
      }
    }
  }, [activeTab, isOnboarded, isMockActive, isCameraEnabled, camera]);

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

            {/* Down Position Card */}
            <div className="glass-card" style={{
              textAlign: 'left',
              padding: '16px',
              borderLeft: sensors.calibration.downPitch !== -65 ? '4px solid var(--steady)' : '4px solid rgba(255,255,255,0.1)',
              marginBottom: '14px'
            }}>
              <h3 style={{ fontSize: '15px', color: '#fff', marginBottom: '4px' }}>1. Bow Resting Position</h3>
              <p style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '12px' }}>
                Point your bow down to the ground. (Current Pitch: <strong style={{ color: 'var(--gold)' }}>{Math.round(currentPitch)}°</strong>)
              </p>
              <button
                className="btn-secondary"
                style={{ width: '100%', padding: '10px', borderRadius: '8px', fontSize: '13px' }}
                onClick={() => sensors.calibratePosition('DOWN')}
              >
                {sensors.calibration.downPitch !== -65 ? `✓ Resting Calibrated (${sensors.calibration.downPitch}°)` : "🏹 Set Resting Angle"}
              </button>
            </div>

            {/* Aim Position Card */}
            <div className="glass-card" style={{
              textAlign: 'left',
              padding: '16px',
              borderLeft: sensors.calibration.aimPitch !== 0 ? '4px solid var(--steady)' : '4px solid rgba(255,255,255,0.1)',
              marginBottom: '24px'
            }}>
              <h3 style={{ fontSize: '15px', color: '#fff', marginBottom: '4px' }}>2. Bow Aiming Position</h3>
              <p style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '12px' }}>
                Hold your bow straight up at a target. (Current Pitch: <strong style={{ color: 'var(--blue)' }}>{Math.round(currentPitch)}°</strong>)
              </p>
              <button
                className="btn-secondary"
                style={{ width: '100%', padding: '10px', borderRadius: '8px', fontSize: '13px', borderColor: 'var(--gold)' }}
                onClick={() => sensors.calibratePosition('AIM')}
              >
                {sensors.calibration.aimPitch !== 0 ? `✓ Aiming Calibrated (${sensors.calibration.aimPitch}°)` : "🎯 Set Aiming Angle"}
              </button>
            </div>

            {/* Proceed button */}
            <button
              className="btn-primary"
              style={{
                width: '100%',
                padding: '14px',
                fontSize: '14px',
                borderRadius: '12px',
                background: sensors.calibration.downPitch !== -65 && sensors.calibration.aimPitch !== 0 ? 'linear-gradient(135deg, var(--steady), #2196f3)' : 'rgba(255,255,255,0.05)',
                color: sensors.calibration.downPitch !== -65 && sensors.calibration.aimPitch !== 0 ? '#fff' : 'var(--text-secondary)',
                boxShadow: sensors.calibration.downPitch !== -65 && sensors.calibration.aimPitch !== 0 ? '0 4px 15px rgba(46, 204, 113, 0.3)' : 'none',
                cursor: sensors.calibration.downPitch !== -65 && sensors.calibration.aimPitch !== 0 ? 'pointer' : 'not-allowed'
              }}
              disabled={sensors.calibration.downPitch === -65 || sensors.calibration.aimPitch === 0}
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
        <div className="scrollable" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', minHeight: '100%', padding: '16px', boxSizing: 'border-box', background: 'rgba(5, 5, 8, 0.98)' }}>
          <div className="glass-panel" style={{ padding: '20px', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <h2 className="header-title" style={{ fontSize: '22px', marginBottom: '4px' }}>🎯 Record Arrow Release</h2>
              <p style={{ color: 'var(--text-secondary)', fontSize: '12px' }}>Tap the target face below to plot your arrow landing location.</p>
            </div>

            {/* Target Canvas Board */}
            <div style={{ display: 'flex', justifyContent: 'center', margin: '8px 0' }}>
              <div style={{ position: 'relative', background: 'rgba(0,0,0,0.5)', padding: '8px', borderRadius: '16px', border: '1px solid var(--border-glass)', boxShadow: '0 8px 30px rgba(0,0,0,0.6)' }}>
                <svg
                  width="220"
                  height="220"
                  viewBox="0 0 220 220"
                  onClick={handleTargetClick}
                  style={{ display: 'block', cursor: 'crosshair', pointerEvents: 'auto' }}
                >
                  {/* White rings */}
                  <circle cx="110" cy="110" r="100" fill="#ffffff" stroke="#e0e0e0" strokeWidth="1" />
                  <circle cx="110" cy="110" r="80" fill="#ffffff" stroke="#e0e0e0" strokeWidth="1" />
                  {/* Black rings */}
                  <circle cx="110" cy="110" r="64" fill="#1c1c1e" stroke="#333336" strokeWidth="1" />
                  <circle cx="110" cy="110" r="48" fill="#1c1c1e" stroke="#333336" strokeWidth="1" />
                  {/* Blue rings */}
                  <circle cx="110" cy="110" r="36" fill="#30a3ff" stroke="#0071cc" strokeWidth="1" />
                  <circle cx="110" cy="110" r="26" fill="#30a3ff" stroke="#0071cc" strokeWidth="1" />
                  {/* Red rings */}
                  <circle cx="110" cy="110" r="18" fill="#ff453a" stroke="#b3150b" strokeWidth="1" />
                  <circle cx="110" cy="110" r="12" fill="#ff453a" stroke="#b3150b" strokeWidth="1" />
                  {/* Gold rings */}
                  <circle cx="110" cy="110" r="7" fill="#ffd60a" stroke="#b39200" strokeWidth="1" />
                  <circle cx="110" cy="110" r="3.5" fill="#ffd60a" stroke="#b39200" strokeWidth="1" />
                  {/* Center Cross */}
                  <circle cx="110" cy="110" r="0.5" fill="#333" />
                  
                  {/* Clicked arrow marker */}
                  {clickCoord && (
                    <g>
                      <circle cx={110 + clickCoord.x} cy={110 + clickCoord.y} r="8" fill="var(--steady)" opacity="0.6" className="pulsing" />
                      <circle cx={110 + clickCoord.x} cy={110 + clickCoord.y} r="3.5" fill="#fff" stroke="var(--steady)" strokeWidth="1.5" />
                    </g>
                  )}
                </svg>
              </div>
            </div>

            {/* Score HUD display */}
            <div style={{
              background: clickCoord ? 'rgba(46, 204, 113, 0.1)' : 'rgba(255,255,255,0.02)',
              border: clickCoord ? '1px solid rgba(46, 204, 113, 0.2)' : '1px solid var(--border-glass)',
              borderRadius: '12px',
              padding: '12px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
              <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Current Arrow Score:</span>
              <strong style={{ fontSize: '18px', color: clickCoord ? 'var(--steady)' : '#fff' }}>
                {clickCoord ? `${clickCoord.score} Points ${clickCoord.score >= 9 ? '🎯' : ''}` : 'Select landing point'}
              </strong>
            </div>

            {/* Selectors grid */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', textAlign: 'left' }}>
              <div>
                <label style={{ fontSize: '11px', color: 'var(--text-secondary)', display: 'block', marginBottom: '6px' }}>Arrow Number</label>
                <input
                  type="number"
                  min="1"
                  value={currentArrowNumber}
                  onChange={(e) => setCurrentArrowNumber(parseInt(e.target.value) || 1)}
                  style={{
                    width: '100%',
                    background: 'rgba(0,0,0,0.5)',
                    border: '1px solid var(--border-glass)',
                    borderRadius: '8px',
                    color: '#fff',
                    padding: '10px',
                    fontSize: '14px',
                    boxSizing: 'border-box'
                  }}
                />
              </div>

              <div>
                <label style={{ fontSize: '11px', color: 'var(--text-secondary)', display: 'block', marginBottom: '6px' }}>Distance (Meters)</label>
                <select
                  value={preferredDistance}
                  onChange={(e) => setPreferredDistance(parseInt(e.target.value) || 70)}
                  style={{
                    width: '100%',
                    background: 'rgba(0,0,0,0.5)',
                    border: '1px solid var(--border-glass)',
                    borderRadius: '8px',
                    color: '#fff',
                    padding: '10px',
                    fontSize: '14px',
                    boxSizing: 'border-box'
                  }}
                >
                  {[18, 30, 50, 60, 70, 90].map((dist) => (
                    <option key={dist} value={dist}>{dist}m</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '8px' }}>
              <button
                className="btn-primary"
                style={{
                  width: '100%',
                  padding: '14px',
                  fontSize: '14px',
                  borderRadius: '10px',
                  background: clickCoord ? 'linear-gradient(135deg, var(--steady), #2ecc71)' : 'rgba(255,255,255,0.05)',
                  color: clickCoord ? '#fff' : 'var(--text-secondary)',
                  cursor: clickCoord ? 'pointer' : 'not-allowed',
                  boxShadow: clickCoord ? '0 4px 15px rgba(46,204,113,0.3)' : 'none'
                }}
                disabled={!clickCoord}
                onClick={handleSavePostShot}
              >
                💾 Save Arrow Release
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
            
            {/* Tab 1: Tracker & Recorder Unified View */}
            {activeTab === 'tracker' && (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>
                
                {/* Main Viewport: Live Camera Feed & Interactive reticle */}
                <div style={{ flex: 1, position: 'relative', overflow: 'hidden', minHeight: '320px' }}>
                  
                  {/* Live overlay HUD */}
                  <HUDOverlay
                    pitch={currentPitch}
                    roll={currentRoll}
                    heading={currentHeading}
                    vibration={currentVibration}
                    triggerState={sensors.triggerState}
                    isRecording={sensors.isRecording || camera.isRecordingVideo}
                    calibration={sensors.calibration}
                    onStopRecording={handleManualRecordToggle}
                  />

                  {/* Back Camera Live Stream or Simulated Mock Background */}
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
                        Camera feedback is disabled. Real-time telemetry, leveling, and bow stability are active.
                      </p>
                    </div>
                  ) : isMockActive ? (
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
                      left: 0
                    }}>
                      <span style={{ fontSize: '32px' }}>📷</span>
                      <span style={{ fontSize: '13px', marginTop: '10px', opacity: 0.6 }}>Simulated Target Camera Feed</span>
                    </div>
                  ) : camera.stream ? (
                    <video
                      ref={(el) => {
                        if (el && camera.stream) el.srcObject = camera.stream;
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
                  ) : (
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
                      left: 0
                    }}>
                      <span>Camera is loading...</span>
                      {camera.cameraError && <p style={{ color: 'var(--unstable)', fontSize: '12px', marginTop: '10px' }}>{camera.cameraError}</p>}
                    </div>
                  )}

                  {/* Manual Record Floating Overlay Button */}
                  <div style={{
                    position: 'absolute',
                    bottom: '16px',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    zIndex: 11,
                    pointerEvents: 'auto'
                  }}>
                    {!sensors.isRecording && !camera.isRecordingVideo && (
                      <button
                        className="btn-primary"
                        style={{
                          padding: '10px 20px',
                          fontSize: '13px',
                          borderRadius: '24px',
                          boxShadow: '0 4px 15px rgba(0,0,0,0.5)',
                          background: 'linear-gradient(135deg, #ff3b30, #ff2d55)'
                        }}
                        onClick={handleManualRecordToggle}
                      >
                        🔴 Manual Record
                      </button>
                    )}
                  </div>

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
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <span style={{ fontSize: '11px', color: '#fff', fontWeight: 'bold' }}>Stability Telemetry Timeline</span>
                    <span style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>Aim Hold History</span>
                  </div>
                  <SensorChart rollingBufferRef={sensors.rollingBufferRef} height={85} showVibrationOnly={true} />
                </div>

              </div>
            )}

            {/* Tab 3: Session Library View */}
            {activeTab === 'sessions' && (
              <SessionLibrary sessions={sessions} onDeleteSession={deleteSession} onClearSessions={clearSessions} />
            )}

            {/* Tab 4: Calibration View */}
            {activeTab === 'calibration' && (
              <div className="scrollable">
                <div style={{ marginBottom: '20px' }}>
                  <h2 className="header-title">Trigger Calibration</h2>
                  <p className="subtitle">Tailor the Auto-Record trigger to your mounting angle.</p>
                </div>

                <div className="glass-panel" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  
                  {/* Real-time Angle Feedback */}
                  <div className="glass-card" style={{ margin: 0, padding: '12px', background: 'rgba(255, 255, 255, 0.03)' }}>
                    <span style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>LIVE PHONE PITCH</span>
                    <h3 style={{ color: 'var(--gold)', fontSize: '24px', fontWeight: 800 }}>
                      {Math.round(currentPitch)}°
                    </h3>
                  </div>

                  {/* Calibration position clickers */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                    <button
                      className="btn-secondary"
                      style={{ padding: '12px 10px', fontSize: '13px', borderRadius: '12px' }}
                      onClick={() => sensors.calibratePosition('DOWN')}
                    >
                      🏹 Set Bow Down<br />({sensors.calibration.downPitch}°)
                    </button>
                    <button
                      className="btn-secondary"
                      style={{ padding: '12px 10px', fontSize: '13px', borderRadius: '12px', borderColor: 'var(--gold)' }}
                      onClick={() => sensors.calibratePosition('AIM')}
                    >
                      🎯 Set Aim Angle<br />({sensors.calibration.aimPitch}°)
                    </button>
                  </div>

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
                              useSensorsStore.getState().setTriggerState('ARMED');
                            } else if (Math.abs(p - sensors.calibration.aimPitch) < sensors.calibration.pitchTolerance) {
                              if (sensors.triggerState === 'ARMED') {
                                useSensorsStore.getState().setTriggerState('AIMING');
                                autoRecordStartRef.current();
                              }
                            }
                          }}
                          style={{ width: '100%' }}
                        />
                      </div>

                      <div>
                        <label style={{ fontSize: '11px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
                          Simulated Shakiness index: {mockVibration}%
                        </label>
                        <input
                          type="range"
                          min="0"
                          max="100"
                          value={mockVibration}
                          onChange={(e) => setMockVibration(parseInt(e.target.value))}
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
