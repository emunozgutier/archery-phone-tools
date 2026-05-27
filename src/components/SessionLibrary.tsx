import React, { useState } from 'react';
import { SensorChart } from './SensorChart';
import type { SensorDataPoint } from '../hooks/useSensors';

export interface ArcherySession {
  id: string;
  timestamp: number;
  type: 'sensor' | 'video';
  duration: number;
  avgVibration: number;
  maxVibration: number;
  sensorData: SensorDataPoint[];
  videoUrl?: string | null;
  arrowNumber?: number;
  distance?: number;
  score?: number;
  arrowX?: number; // Normalized coordinate percentage from center (-100 to 100)
  arrowY?: number; // Normalized coordinate percentage from center (-100 to 100)
}

interface SessionLibraryProps {
  sessions: ArcherySession[];
  onDeleteSession: (id: string) => void;
  onClearSessions: () => void;
}

export const SessionLibrary: React.FC<SessionLibraryProps> = ({
  sessions,
  onDeleteSession,
  onClearSessions
}) => {
  const [selectedSession, setSelectedSession] = useState<ArcherySession | null>(null);
  const [currentTimeOffset, setCurrentTimeOffset] = useState<number | null>(null);

  const getDegrees = (vec: { x: number; y: number; z: number } | null | undefined, axis: 'x' | 'y' | 'z') => {
    if (!vec) return 0;
    const norm = Math.sqrt(vec.x * vec.x + vec.y * vec.y + vec.z * vec.z) || 1;
    const val = vec[axis];
    const clamped = Math.max(-1, Math.min(1, val / norm));
    return Math.round(Math.acos(clamped) * (180 / Math.PI));
  };

  const getSyncedTelemetryPoint = (): SensorDataPoint | null => {
    if (!selectedSession || !selectedSession.sensorData || selectedSession.sensorData.length === 0) return null;
    if (currentTimeOffset === null) return selectedSession.sensorData[0];
    
    const tStart = selectedSession.sensorData[0].timestamp;
    const targetTimestamp = tStart + currentTimeOffset * 1000;
    
    let closestPt = selectedSession.sensorData[0];
    let minDiff = Math.abs(closestPt.timestamp - targetTimestamp);
    
    for (let i = 1; i < selectedSession.sensorData.length; i++) {
      const pt = selectedSession.sensorData[i];
      const diff = Math.abs(pt.timestamp - targetTimestamp);
      if (diff < minDiff) {
        minDiff = diff;
        closestPt = pt;
      } else {
        break;
      }
    }
    return closestPt;
  };

  const handleSelectSession = (session: ArcherySession | null) => {
    setSelectedSession(session);
    setCurrentTimeOffset(null);
  };

  // Helper to format date
  const formatDate = (ts: number) => {
    return new Date(ts).toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  // Export session data as JSON file
  const exportSession = (session: ArcherySession) => {
    const dataStr = JSON.stringify(session, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    
    const link = document.createElement('a');
    link.href = url;
    link.download = `archery-session-${session.id}.json`;
    document.body.appendChild(link);
    link.click();
    
    // Cleanup
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="scrollable">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <div style={{ textAlign: 'left' }}>
          <h2 className="header-title">Session History</h2>
          <p className="subtitle">Review your aim stability and video recordings.</p>
        </div>
        {sessions.length > 0 && (
          <button
            className="btn-secondary"
            style={{
              padding: '6px 12px',
              fontSize: '11px',
              borderRadius: '20px',
              color: 'var(--unstable)',
              borderColor: 'rgba(255, 59, 48, 0.2)',
              background: 'rgba(255, 59, 48, 0.05)',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              height: 'auto',
              cursor: 'pointer'
            }}
            onClick={() => {
              if (window.confirm("Are you sure you want to clear all recorded sessions? This action cannot be undone.")) {
                onClearSessions();
              }
            }}
          >
            🗑️ Clear All
          </button>
        )}
      </div>

      {sessions.length === 0 ? (
        <div className="glass-panel" style={{
          textAlign: 'center',
          padding: '40px 20px',
          color: 'var(--text-secondary)'
        }}>
          <div style={{ fontSize: '36px', marginBottom: '12px' }}>🎯</div>
          <h3 style={{ color: '#fff', fontSize: '16px', marginBottom: '8px' }}>No Sessions Recorded Yet</h3>
          <p style={{ fontSize: '13px', lineHeight: '1.4' }}>
            Go to the Tracker or Recorder tabs, point your bow down to arm, then raise to start auto-recording!
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {sessions.map((session) => {
            const borderCol = session.type === 'video' ? 'var(--blue)' : 'var(--gold)';
            
            return (
              <div
                key={session.id}
                className="glass-card"
                style={{
                  margin: 0,
                  cursor: 'pointer',
                  borderLeft: `4px solid ${borderCol}`,
                  transition: 'transform 0.15s, background-color 0.15s'
                }}
                onClick={() => handleSelectSession(session)}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <span style={{
                      fontSize: '10px',
                      background: session.type === 'video' ? 'rgba(0,122,255,0.15)' : 'rgba(255,204,0,0.15)',
                      color: session.type === 'video' ? 'var(--blue)' : 'var(--gold)',
                      padding: '2px 8px',
                      borderRadius: '10px',
                      fontWeight: 'bold',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px'
                    }}>
                      {session.type} Mode
                    </span>
                    <h4 style={{ color: '#fff', fontSize: '15px', marginTop: '6px' }}>{formatDate(session.timestamp)}</h4>
                    <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                      Duration: {session.duration}s • Points: {session.sensorData.length}
                    </p>
                  </div>
                  
                  {session.score !== undefined && (
                    <div style={{ textAlign: 'right' }}>
                      <span style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>SCORE</span>
                      <h3 style={{ color: 'var(--steady)', fontSize: '20px', fontWeight: 800 }}>
                        {session.score} PTS
                      </h3>
                      <span style={{ fontSize: '9px', color: 'var(--text-secondary)', display: 'block', marginTop: '2px' }}>
                        Arrow #{session.arrowNumber} • {session.distance}m
                      </span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* --- SESSION DETAILED ANALYSIS SHEET --- */}
      {selectedSession && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          background: 'rgba(5, 5, 8, 0.95)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          zIndex: 100,
          display: 'flex',
          flexDirection: 'column',
          boxSizing: 'border-box'
        }}>
          
          {/* Header */}
          <div style={{
            padding: '20px',
            borderBottom: '1px solid var(--border-glass)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}>
            <div>
              <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>SESSION LOG</span>
              <h3 style={{ color: '#fff', fontSize: '18px' }}>{formatDate(selectedSession.timestamp)}</h3>
            </div>
            <button
              className="btn-secondary"
              style={{ padding: '8px 16px', borderRadius: '20px', fontSize: '13px' }}
              onClick={() => handleSelectSession(null)}
            >
              Close
            </button>
          </div>

          {/* Analysis Content */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>
            
            {/* Stats Dashboard */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: '12px',
              marginBottom: '20px'
            }}>
              <div className="glass-card" style={{ margin: 0, textAlign: 'center', padding: '12px' }}>
                <span style={{ fontSize: '9px', color: 'var(--text-secondary)', display: 'block' }}>SCORE</span>
                <span style={{ fontSize: '18px', color: 'var(--steady)', fontWeight: 800 }}>
                  {selectedSession.score !== undefined ? `${selectedSession.score} PTS` : 'N/A'}
                </span>
              </div>
              <div className="glass-card" style={{ margin: 0, textAlign: 'center', padding: '12px' }}>
                <span style={{ fontSize: '9px', color: 'var(--text-secondary)', display: 'block' }}>DISTANCE</span>
                <span style={{ fontSize: '18px', color: 'var(--blue)', fontWeight: 800 }}>
                  {selectedSession.distance !== undefined ? `${selectedSession.distance}m` : 'N/A'}
                </span>
              </div>
              <div className="glass-card" style={{ margin: 0, textAlign: 'center', padding: '12px' }}>
                <span style={{ fontSize: '9px', color: 'var(--text-secondary)', display: 'block' }}>HOLD TIME</span>
                <span style={{ fontSize: '18px', color: '#fff', fontWeight: 800 }}>
                  {selectedSession.duration}s
                </span>
              </div>
            </div>

            {/* Arrow & Target group card */}
            {selectedSession.score !== undefined && (
              <div className="glass-card" style={{ margin: '0 0 20px 0', padding: '16px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <h4 style={{ color: '#fff', fontSize: '14px', marginBottom: '12px', width: '100%', textAlign: 'left' }}>Arrow Release Scoring Detail</h4>
                
                <div style={{ display: 'flex', gap: '20px', alignItems: 'center', width: '100%', flexWrap: 'wrap', justifyContent: 'center' }}>
                  
                  {/* FITA Target face */}
                  <div style={{ position: 'relative', background: 'rgba(0,0,0,0.3)', padding: '10px', borderRadius: '12px', border: '1px solid var(--border-glass)' }}>
                    <svg width="220" height="220" viewBox="0 0 220 220" style={{ display: 'block', margin: '0 auto' }}>
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
                      
                      {/* Plotted Arrow landing position */}
                      {selectedSession.arrowX !== undefined && selectedSession.arrowY !== undefined && (
                        <g>
                          <circle cx={110 + selectedSession.arrowX} cy={110 + selectedSession.arrowY} r="7" fill="var(--steady)" opacity="0.6" className="pulsing" />
                          <circle cx={110 + selectedSession.arrowX} cy={110 + selectedSession.arrowY} r="3" fill="#fff" stroke="var(--steady)" strokeWidth="1.5" />
                        </g>
                      )}
                    </svg>
                  </div>

                  {/* Bullet Stats */}
                  <div style={{ flex: 1, minWidth: '160px', display: 'flex', flexDirection: 'column', gap: '8px', textAlign: 'left' }}>
                    <div style={{ background: 'rgba(255,255,255,0.02)', padding: '8px 12px', borderRadius: '8px', borderLeft: '3px solid var(--gold)' }}>
                      <span style={{ fontSize: '9px', color: 'var(--text-secondary)', display: 'block' }}>ARROW NUMBER</span>
                      <strong style={{ fontSize: '15px', color: '#fff' }}>Arrow #{selectedSession.arrowNumber}</strong>
                    </div>
                    <div style={{ background: 'rgba(255,255,255,0.02)', padding: '8px 12px', borderRadius: '8px', borderLeft: '3px solid var(--blue)' }}>
                      <span style={{ fontSize: '9px', color: 'var(--text-secondary)', display: 'block' }}>TARGET DISTANCE</span>
                      <strong style={{ fontSize: '15px', color: '#fff' }}>{selectedSession.distance} Meters</strong>
                    </div>
                    <div style={{ background: 'rgba(255,255,255,0.02)', padding: '8px 12px', borderRadius: '8px', borderLeft: '3px solid var(--steady)' }}>
                      <span style={{ fontSize: '9px', color: 'var(--text-secondary)', display: 'block' }}>CALCULATED SCORE</span>
                      <strong style={{ fontSize: '16px', color: 'var(--steady)' }}>{selectedSession.score} Points {selectedSession.score >= 9 ? '🎯 Gold!' : ''}</strong>
                    </div>
                  </div>

                </div>
              </div>
            )}

            {/* Raw Telemetry Matrix Card (IMU & Geomagnetic North Projections) */}
            <div className="glass-card" style={{ margin: '0 0 20px 0', padding: '16px', textAlign: 'left', background: 'rgba(255,255,255,0.01)', border: '1px solid var(--border-glass)' }}>
              <h4 style={{ color: '#fff', fontSize: '13px', marginBottom: '12px', fontWeight: 600 }}>Raw Telemetry Matrix (IMU & Magnetometer)</h4>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div style={{ background: 'rgba(0,0,0,0.3)', padding: '10px 12px', borderRadius: '8px', borderLeft: '3px solid var(--unstable)' }}>
                  <span style={{ fontSize: '9px', color: 'var(--text-secondary)', display: 'block', fontWeight: 'bold' }}>INERTIAL ACCEL (AVG)</span>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '6px', fontSize: '11px', color: '#fff', fontFamily: 'var(--mono)' }}>
                    <span>X-Accel: <strong style={{ color: 'var(--unstable)' }}>{
                      selectedSession.sensorData.length > 0
                        ? (selectedSession.sensorData.reduce((acc, curr) => acc + Math.abs(curr.accX || 0), 0) / selectedSession.sensorData.length).toFixed(2)
                        : '0.00'
                    } m/s²</strong></span>
                    <span>Y-Accel: <strong style={{ color: 'var(--unstable)' }}>{
                      selectedSession.sensorData.length > 0
                        ? (selectedSession.sensorData.reduce((acc, curr) => acc + Math.abs(curr.accY || 0), 0) / selectedSession.sensorData.length).toFixed(2)
                        : '0.00'
                    } m/s²</strong></span>
                    <span>Z-Accel: <strong style={{ color: 'var(--unstable)' }}>{
                      selectedSession.sensorData.length > 0
                        ? (selectedSession.sensorData.reduce((acc, curr) => acc + Math.abs(curr.accZ || 0), 0) / selectedSession.sensorData.length).toFixed(2)
                        : '0.00'
                    } m/s²</strong></span>
                  </div>
                </div>
                
                <div style={{ background: 'rgba(0,0,0,0.3)', padding: '10px 12px', borderRadius: '8px', borderLeft: '3px solid var(--blue)' }}>
                  <span style={{ fontSize: '9px', color: 'var(--text-secondary)', display: 'block', fontWeight: 'bold' }}>MAGNETIC NORTH (AVG)</span>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '6px', fontSize: '11px', color: '#fff', fontFamily: 'var(--mono)' }}>
                    <span>X-Mag: <strong style={{ color: 'var(--blue)' }}>{
                      selectedSession.sensorData.length > 0
                        ? (selectedSession.sensorData.reduce((acc, curr) => acc + (curr.magX || 0), 0) / selectedSession.sensorData.length).toFixed(2)
                        : '0.00'
                    } G</strong></span>
                    <span>Y-Mag: <strong style={{ color: 'var(--blue)' }}>{
                      selectedSession.sensorData.length > 0
                        ? (selectedSession.sensorData.reduce((acc, curr) => acc + (curr.magY || 0), 0) / selectedSession.sensorData.length).toFixed(2)
                        : '0.00'
                    } G</strong></span>
                    <span>Z-Mag: <strong style={{ color: 'var(--blue)' }}>{
                      selectedSession.sensorData.length > 0
                        ? (selectedSession.sensorData.reduce((acc, curr) => acc + (curr.magZ || 0), 0) / selectedSession.sensorData.length).toFixed(2)
                        : '0.00'
                    } G</strong></span>
                  </div>
                </div>
              </div>
            </div>

            {/* Sync Video Player (If video session) */}
            {selectedSession.type === 'video' && selectedSession.videoUrl && (
              <div style={{ marginBottom: '20px', borderRadius: 'var(--border-radius-md)', overflow: 'hidden', border: '1px solid var(--border-glass)', background: '#000' }}>
                <video
                  src={selectedSession.videoUrl}
                  controls
                  playsInline
                  style={{ width: '100%', display: 'block', maxHeight: '220px' }}
                  onTimeUpdate={(e) => setCurrentTimeOffset(e.currentTarget.currentTime)}
                />
              </div>
            )}

            {/* Real-time Video Synced Telemetry HUD */}
            {selectedSession.type === 'video' && selectedSession.videoUrl && (
              (() => {
                const syncedPt = getSyncedTelemetryPoint();
                if (!syncedPt) return null;
                return (
                  <div className="glass-card" style={{
                    margin: '0 0 20px 0',
                    padding: '14px',
                    background: 'rgba(56, 189, 248, 0.04)',
                    border: '1px solid rgba(56, 189, 248, 0.25)',
                    borderRadius: '12px',
                    textAlign: 'left'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                      <span style={{ fontSize: '11px', color: '#38bdf8', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        🔄 VIDEO SYNCED TELEMETRY
                      </span>
                      <span style={{ fontSize: '10px', color: 'var(--text-secondary)', fontFamily: 'var(--mono)' }}>
                        Time: {currentTimeOffset !== null ? currentTimeOffset.toFixed(2) : '0.00'}s / {selectedSession.duration}s
                      </span>
                    </div>
                    
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                      {/* Gravity Components */}
                      <div style={{ background: 'rgba(0,0,0,0.4)', padding: '10px', borderRadius: '8px', borderLeft: '3px solid var(--gold)' }}>
                        <span style={{ fontSize: '9px', color: 'var(--text-secondary)', display: 'block', fontWeight: 'bold', letterSpacing: '0.5px' }}>GRAVITY VECTOR ANGLE</span>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '6px', fontSize: '11px', color: '#fff', fontFamily: 'var(--mono)' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span>X (Pitch):</span>
                            <strong style={{ color: 'var(--gold)' }}>{getDegrees({ x: syncedPt.accX, y: syncedPt.accY, z: syncedPt.accZ }, 'x')}°</strong>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span>Y (Roll):</span>
                            <strong style={{ color: 'var(--blue)' }}>{getDegrees({ x: syncedPt.accX, y: syncedPt.accY, z: syncedPt.accZ }, 'y')}°</strong>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span>Z (Heading):</span>
                            <strong style={{ color: 'var(--steady)' }}>{getDegrees({ x: syncedPt.accX, y: syncedPt.accY, z: syncedPt.accZ }, 'z')}°</strong>
                          </div>
                        </div>
                      </div>
                      
                      {/* Magnet Components */}
                      <div style={{ background: 'rgba(0,0,0,0.4)', padding: '10px', borderRadius: '8px', borderLeft: '3px solid var(--steady)' }}>
                        <span style={{ fontSize: '9px', color: 'var(--text-secondary)', display: 'block', fontWeight: 'bold', letterSpacing: '0.5px' }}>MAGNET ANGLE</span>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '6px', fontSize: '11px', color: '#fff', fontFamily: 'var(--mono)' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span>X Component:</span>
                            <strong style={{ color: 'var(--gold)' }}>{getDegrees({ x: syncedPt.magX, y: syncedPt.magY, z: syncedPt.magZ }, 'x')}°</strong>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span>Y Component:</span>
                            <strong style={{ color: 'var(--blue)' }}>{getDegrees({ x: syncedPt.magX, y: syncedPt.magY, z: syncedPt.magZ }, 'y')}°</strong>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span>Z Component:</span>
                            <strong style={{ color: 'var(--steady)' }}>{getDegrees({ x: syncedPt.magX, y: syncedPt.magY, z: syncedPt.magZ }, 'z')}°</strong>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()
            )}

            {/* Synced Telemetry Timeline */}
            <div style={{ marginBottom: '24px' }}>
              <h4 style={{ color: '#fff', fontSize: '14px', marginBottom: '8px', textAlign: 'left' }}>Dominant Alignment Timeline</h4>
              <SensorChart
                rollingBufferRef={{ current: selectedSession.sensorData }}
                height={160}
                triggerState="AIMING"
                currentTimeOffset={currentTimeOffset}
              />
              <p style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '6px', textAlign: 'left', lineHeight: '1.4' }}>
                💡 Overlaid color-coded curves track the exact angles of your calibrated dominant gravity and magnet axes in degrees (0-180°). Perfect flat, horizontal lines signify peak aiming consistency!
              </p>
            </div>

            {/* Action buttons */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <button
                className="btn-primary"
                style={{ width: '100%', fontSize: '14px', padding: '12px' }}
                onClick={() => exportSession(selectedSession)}
              >
                📥 Export Session Log (.json)
              </button>
              
              <button
                className="btn-secondary"
                style={{ width: '100%', fontSize: '14px', padding: '12px', color: 'var(--unstable)', border: '1px solid rgba(255, 59, 48, 0.2)' }}
                onClick={() => {
                  onDeleteSession(selectedSession.id);
                  handleSelectSession(null);
                }}
              >
                🗑️ Delete Session
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
};
