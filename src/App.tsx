import { useState, useEffect, useRef, useCallback } from 'react';
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
    sensorRefreshRate,
    setSensorRefreshRate,
    cameraResolution,
    setCameraResolution,
    cameraFps,
    setCameraFps
  } = useGlobal();

  const { logs, clearLogs } = useErrorLog();
  const mockIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [appVersion, setAppVersion] = useState<{ version: string; dateTime: string } | null>(null);
  const [showDownWarning, setShowDownWarning] = useState<'stopped' | 'blocked' | null>(null);

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

  // Sync state fallback when saving a sensor-only session (no video compiled callback)
  const saveCapturedSession = useCallback((sensorPoints: SensorDataPoint[]) => {
    const isCameraRunning = camera.cameraActive && !isMockActive;
    if (activeTab === 'tracker' && sensorPoints.length > 0 && !isCameraRunning) {
      const newSession: ArcherySession = {
        id: Date.now().toString(),
        timestamp: Date.now(),
        type: 'sensor',
        duration: Math.round(sensorPoints.length / 50), // roughly 50-60hz
        avgVibration: Math.round(
          sensorPoints.reduce((acc, curr) => acc + curr.vibration, 0) / 
          sensorPoints.length
        ),
        maxVibration: Math.max(...sensorPoints.map((p) => p.vibration)),
        sensorData: sensorPoints
      };

      addSession(newSession);
    }
  }, [activeTab, addSession, camera.cameraActive, isMockActive]);

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
        setShowDownWarning('stopped');
      }
      if (camera.isRecordingVideo) {
        camera.stopVideoRecording();
      }
      setTimeout(() => {
        saveCapturedSession(capturedSensorPoints);
      }, 400); // Allow brief latency to compile final video blob
    };
  }, [camera, sensors, activeTab, saveCapturedSession]);

  // Watch for compilation of recorded video to pair and save with sensor data
  useEffect(() => {
    if (camera.recordedVideoUrl && sensors.sensorHistory.length > 0) {
      const isVideo = activeTab === 'tracker';
      const historyCopy = [...sensors.sensorHistory];
      const videoUrlCopy = camera.recordedVideoUrl;
      
      const newSession: ArcherySession = {
        id: Date.now().toString(),
        timestamp: Date.now(),
        type: isVideo ? 'video' : 'sensor',
        duration: Math.round(historyCopy.length / 60), // ~60 data points per second
        avgVibration: Math.round(
          historyCopy.reduce((acc, curr) => acc + curr.vibration, 0) / 
          historyCopy.length
        ),
        maxVibration: Math.max(...historyCopy.map((p) => p.vibration)),
        sensorData: historyCopy,
        videoUrl: isVideo ? videoUrlCopy : null
      };

      // Safely defer state updates out of effect body to avoid render cascade
      setTimeout(() => {
        addSession(newSession);
        camera.resetVideo();
      }, 0);
    }
  }, [camera, sensors.sensorHistory, activeTab, addSession]);

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
      log.push({
        timestamp: now - (300 - i) * 20,
        pitch: sensors.calibration.aimPitch + (Math.sin(i / 10) * 2),
        roll: Math.cos(i / 15) * 1.5,
        heading: 184,
        vibration: Math.max(3, Math.round(8 + Math.sin(i / 5) * 6 + (Math.random() * 4)))
      });
    }
    return log;
  };

  // Master Orientation readings (Mock overrides vs physical)
  const currentPitch = isMockActive ? mockPitch : sensors.orientation.beta;
  const currentRoll = isMockActive ? 2 : sensors.orientation.gamma;
  const currentHeading = isMockActive ? 184 : sensors.orientation.heading;
  const currentVibration = isMockActive ? mockVibration : sensors.vibrationIndex;

  // Toggle manual recording start/stop
  const handleManualRecordToggle = () => {
    // If phone is pointed down, block start and show popup
    if (!sensors.isRecording && currentPitch < -35) {
      setShowDownWarning('blocked');
      useErrorLog.getState().addLog('Blocked recording start: phone is pointed down', 'warn');
      return;
    }

    if (sensors.isRecording) {
      if (camera.cameraActive) {
        camera.stopVideoRecording();
      }
      const data = sensors.stopRecording();
      saveCapturedSession(data);
    } else {
      if (camera.cameraActive) {
        camera.startVideoRecording();
      }
      sensors.startRecording();
    }
  };

  // Manage camera lifecycles based on tab states
  useEffect(() => {
    if (isOnboarded && !isMockActive) {
      if (activeTab === 'tracker') {
        camera.startCamera();
      } else {
        camera.stopCamera();
      }
    }
  }, [activeTab, isOnboarded, isMockActive, camera]);

  // Show onboarding overlay if not yet accepted/skipped
  const showOnboarding = !isOnboarded && sensors.permissionGranted === null;

  return (
    <>
      {showOnboarding ? (
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
                  {isMockActive ? (
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
              <SessionLibrary sessions={sessions} onDeleteSession={deleteSession} />
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
