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
}

interface SessionLibraryProps {
  sessions: ArcherySession[];
  onDeleteSession: (id: string) => void;
}

export const SessionLibrary: React.FC<SessionLibraryProps> = ({
  sessions,
  onDeleteSession
}) => {
  const [selectedSession, setSelectedSession] = useState<ArcherySession | null>(null);

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
      <div style={{ marginBottom: '20px' }}>
        <h2 className="header-title">Session History</h2>
        <p className="subtitle">Review your aim stability and video recordings.</p>
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
            const stability = 100 - session.avgVibration;
            const stabilityColor = stability > 85 ? 'var(--steady)' : stability > 65 ? 'var(--tremor)' : 'var(--unstable)';
            
            return (
              <div
                key={session.id}
                className="glass-card"
                style={{
                  margin: 0,
                  cursor: 'pointer',
                  borderLeft: `4px solid ${stabilityColor}`,
                  transition: 'transform 0.15s, background-color 0.15s'
                }}
                onClick={() => setSelectedSession(session)}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
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
                  
                  <div style={{ textAlign: 'right' }}>
                    <span style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>STABILITY</span>
                    <h3 style={{ color: stabilityColor, fontSize: '20px', fontWeight: 800 }}>
                      {stability}%
                    </h3>
                  </div>
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
              onClick={() => setSelectedSession(null)}
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
                <span style={{ fontSize: '9px', color: 'var(--text-secondary)', display: 'block' }}>AVG STABILITY</span>
                <span style={{ fontSize: '18px', color: 'var(--steady)', fontWeight: 800 }}>
                  {100 - selectedSession.avgVibration}%
                </span>
              </div>
              <div className="glass-card" style={{ margin: 0, textAlign: 'center', padding: '12px' }}>
                <span style={{ fontSize: '9px', color: 'var(--text-secondary)', display: 'block' }}>MAX SHAKE</span>
                <span style={{ fontSize: '18px', color: 'var(--unstable)', fontWeight: 800 }}>
                  {selectedSession.maxVibration}%
                </span>
              </div>
              <div className="glass-card" style={{ margin: 0, textAlign: 'center', padding: '12px' }}>
                <span style={{ fontSize: '9px', color: 'var(--text-secondary)', display: 'block' }}>DURATION</span>
                <span style={{ fontSize: '18px', color: '#fff', fontWeight: 800 }}>
                  {selectedSession.duration}s
                </span>
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
                />
              </div>
            )}

            {/* Synced Telemetry Timeline */}
            <div style={{ marginBottom: '24px' }}>
              <h4 style={{ color: '#fff', fontSize: '14px', marginBottom: '8px', textAlign: 'left' }}>Aim Stability Timeline</h4>
              <SensorChart
                rollingBufferRef={{ current: selectedSession.sensorData }}
                height={160}
                showVibrationOnly={false}
              />
              <p style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '6px', textAlign: 'left' }}>
                💡 Blue line tracks tilt (Pitch), showing when you drew and held the bow. Glowing red fill shows tremor levels. Consistent flat lines signify supreme stability!
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
                  setSelectedSession(null);
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
