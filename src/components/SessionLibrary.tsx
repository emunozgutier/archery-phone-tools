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
  isScored?: boolean;
  setNumber?: number;
}

interface SessionLibraryProps {
  sessions: ArcherySession[];
  onDeleteSession: (id: string) => void;
  onClearSessions: () => void;
  onUpdateSession: (id: string, updates: Partial<ArcherySession>) => void;
}

export const SessionLibrary: React.FC<SessionLibraryProps> = ({
  sessions,
  onDeleteSession,
  onClearSessions,
  onUpdateSession
}) => {
  const [selectedSession, setSelectedSession] = useState<ArcherySession | null>(null);
  const [currentTimeOffset, setCurrentTimeOffset] = useState<number | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editDistance, setEditDistance] = useState(70);
  const [editScore, setEditScore] = useState(0);
  const [editArrowX, setEditArrowX] = useState<number | undefined>(undefined);
  const [editArrowY, setEditArrowY] = useState<number | undefined>(undefined);
  const [expandedSets, setExpandedSets] = useState<{ [key: number]: boolean }>({});
  
  // Wizard States
  const [wizardUnscored, setWizardUnscored] = useState<ArcherySession[]>([]);
  const [wizardIndex, setWizardIndex] = useState<number | null>(null);
  const [wizardDistance, setWizardDistance] = useState(70);
  const [wizardScore, setWizardScore] = useState(0);
  const [wizardArrowX, setWizardArrowX] = useState<number | undefined>(undefined);
  const [wizardArrowY, setWizardArrowY] = useState<number | undefined>(undefined);
  const [wizardAnswers, setWizardAnswers] = useState<{ id: string; score: number; distance: number; arrowX: number; arrowY: number }[]>([]);

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
    setIsEditing(false);
    if (session) {
      setEditDistance(session.distance || 70);
      setEditScore(session.score || 0);
      setEditArrowX(session.arrowX);
      setEditArrowY(session.arrowY);
    }
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
          {/* Unscored score banner */}
          {(() => {
            const unscoredSessions = sessions.filter(s => !s.isScored);
            if (unscoredSessions.length === 0) return null;
            return (
              <div style={{
                display: 'flex',
                gap: '12px',
                marginBottom: '8px',
                background: 'rgba(255, 204, 0, 0.08)',
                border: '1px solid rgba(255, 204, 0, 0.25)',
                borderRadius: '12px',
                padding: '12px 16px',
                alignItems: 'center',
                justifyContent: 'space-between',
                boxShadow: '0 4px 20px rgba(255, 204, 0, 0.05)',
                textAlign: 'left'
              }}>
                <div>
                  <h4 style={{ color: 'var(--gold)', margin: 0, fontSize: '14px', fontWeight: 'bold' }}>
                    🎯 Unscored Shots Detected
                  </h4>
                  <p style={{ margin: '4px 0 0 0', fontSize: '11px', color: 'var(--text-secondary)' }}>
                    You have {unscoredSessions.length} recorded shots waiting to be scored and bundled.
                  </p>
                </div>
                <button
                  className="btn-primary"
                  style={{
                    background: 'linear-gradient(135deg, var(--gold), #f39c12)',
                    boxShadow: '0 4px 12px rgba(243,156,18,0.3)',
                    border: 'none',
                    padding: '8px 16px',
                    borderRadius: '20px',
                    fontSize: '11px',
                    fontWeight: 'bold',
                    color: '#fff',
                    cursor: 'pointer',
                    height: 'auto',
                    pointerEvents: 'auto'
                  }}
                  onClick={() => {
                    const sorted = [...unscoredSessions].sort((a, b) => a.timestamp - b.timestamp);
                    setWizardUnscored(sorted);
                    setWizardIndex(0);
                    setWizardDistance(sorted[0].distance || 70);
                    setWizardScore(0);
                    setWizardArrowX(undefined);
                    setWizardArrowY(undefined);
                    setWizardAnswers([]);
                  }}
                >
                  Score End ({unscoredSessions.length})
                </button>
              </div>
            );
          })()}

          {/* Unscored Group Collapsible */}
          {(() => {
            const unscoredSessions = sessions.filter(s => !s.isScored);
            if (unscoredSessions.length === 0) return null;
            const isUnscoredExpanded = expandedSets[-1] !== false;
            return (
              <div className="glass-panel" style={{
                padding: 0,
                borderRadius: '12px',
                overflow: 'hidden',
                border: '1px solid rgba(255, 204, 0, 0.2)',
                background: 'rgba(255, 204, 0, 0.02)',
                margin: 0
              }}>
                <div 
                  onClick={() => setExpandedSets(prev => ({ ...prev, [-1]: prev[-1] === false }))}
                  style={{
                    padding: '14px 16px',
                    background: 'rgba(255, 204, 0, 0.04)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    cursor: 'pointer',
                    borderBottom: isUnscoredExpanded ? '1px solid rgba(255, 204, 0, 0.15)' : 'none',
                    userSelect: 'none'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', textAlign: 'left' }}>
                    <span style={{ fontSize: '18px' }}>🏹</span>
                    <div>
                      <h4 style={{ color: 'var(--gold)', margin: 0, fontSize: '15px', fontWeight: 'bold' }}>
                        Unscored Set
                      </h4>
                      <p style={{ margin: '2px 0 0 0', fontSize: '11px', color: 'var(--text-secondary)' }}>
                        {unscoredSessions.length} shot arrows pending score
                      </p>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                    <span style={{
                      fontSize: '9px',
                      background: 'rgba(255, 204, 0, 0.15)',
                      color: 'var(--gold)',
                      padding: '2px 8px',
                      borderRadius: '10px',
                      fontWeight: 'bold'
                    }}>
                      UNSCORED
                    </span>
                    <span style={{ fontSize: '16px', color: 'var(--text-secondary)', transform: isUnscoredExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
                      ▼
                    </span>
                  </div>
                </div>
                
                {isUnscoredExpanded && (
                  <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: '8px', background: 'rgba(0,0,0,0.15)' }}>
                    {unscoredSessions.sort((a, b) => b.timestamp - a.timestamp).map((session) => {
                      const borderCol = session.type === 'video' ? 'var(--blue)' : 'var(--gold)';
                      return (
                        <div
                          key={session.id}
                          className="glass-card"
                          style={{
                            margin: 0,
                            cursor: 'pointer',
                            borderLeft: `4px solid ${borderCol}`,
                            background: 'rgba(255, 255, 255, 0.02)',
                            padding: '10px 14px',
                            borderRadius: '8px'
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSelectSession(session);
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div style={{ textAlign: 'left' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <span style={{
                                  fontSize: '9px',
                                  background: session.type === 'video' ? 'rgba(0,122,255,0.12)' : 'rgba(255,204,0,0.12)',
                                  color: session.type === 'video' ? 'var(--blue)' : 'var(--gold)',
                                  padding: '1px 6px',
                                  borderRadius: '6px',
                                  fontWeight: 'bold',
                                  textTransform: 'uppercase'
                                }}>
                                  {session.type}
                                </span>
                                {session.arrowNumber !== undefined && (
                                  <span style={{ color: '#fff', fontSize: '12px', fontWeight: '500' }}>
                                    Arrow #{session.arrowNumber}
                                  </span>
                                )}
                              </div>
                              <p style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '4px', marginBottom: 0 }}>
                                {formatDate(session.timestamp)} • {session.duration}s hold
                              </p>
                            </div>
                            
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                              <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                                {session.distance || 70}m
                              </span>
                              <span style={{ fontSize: '12px', color: 'var(--gold)' }}>
                                ⚠️ Not Scored
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })()}

          {/* Scored Sets list */}
          {(() => {
            const scoredSessions = sessions.filter(s => s.isScored);
            const setsMap: { [key: number]: ArcherySession[] } = {};
            scoredSessions.forEach(s => {
              const setNum = s.setNumber || 1;
              if (!setsMap[setNum]) setsMap[setNum] = [];
              setsMap[setNum].push(s);
            });
            
            const setNumbers = Object.keys(setsMap)
              .map(Number)
              .sort((a, b) => b - a);
              
            if (setNumbers.length === 0 && sessions.filter(s => !s.isScored).length === 0) {
              return (
                <div className="glass-panel" style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-secondary)' }}>
                  <div style={{ fontSize: '36px', marginBottom: '12px' }}>🎯</div>
                  <h3 style={{ color: '#fff', fontSize: '16px', marginBottom: '8px' }}>No Sessions Recorded Yet</h3>
                </div>
              );
            }
            
            return setNumbers.map((setNum) => {
              const setArrows = setsMap[setNum].sort((a, b) => a.timestamp - b.timestamp);
              const totalScore = setArrows.reduce((sum, s) => sum + (s.score || 0), 0);
              const avgVibration = setArrows.length > 0 
                ? (setArrows.reduce((sum, s) => sum + (s.avgVibration || 0), 0) / setArrows.length).toFixed(1)
                : '0.0';
              const isExpanded = expandedSets[setNum] === true;
              
              return (
                <div key={setNum} className="glass-panel" style={{
                  padding: 0,
                  borderRadius: '12px',
                  overflow: 'hidden',
                  border: '1px solid var(--border-glass)',
                  background: 'rgba(255, 255, 255, 0.02)',
                  margin: 0
                }}>
                  <div 
                    onClick={() => setExpandedSets(prev => ({ ...prev, [setNum]: !prev[setNum] }))}
                    style={{
                      padding: '14px 16px',
                      background: 'rgba(255, 255, 255, 0.03)',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      cursor: 'pointer',
                      borderBottom: isExpanded ? '1px solid var(--border-glass)' : 'none',
                      userSelect: 'none'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', textAlign: 'left' }}>
                      <span style={{ fontSize: '18px' }}>🎯</span>
                      <div>
                        <h4 style={{ color: '#fff', margin: 0, fontSize: '15px', fontWeight: 'bold' }}>
                          Set #{setNum}
                        </h4>
                        <p style={{ margin: '2px 0 0 0', fontSize: '11px', color: 'var(--text-secondary)' }}>
                          {setArrows.length} arrows shot • Avg Vib: {avgVibration}m/s²
                        </p>
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                      <div style={{ textAlign: 'right' }}>
                        <span style={{ fontSize: '9px', color: 'var(--text-secondary)', display: 'block' }}>TOTAL SCORE</span>
                        <strong style={{ color: 'var(--steady)', fontSize: '16px', fontWeight: 800 }}>
                          {totalScore} PTS
                        </strong>
                      </div>
                      <span style={{ fontSize: '16px', color: 'var(--text-secondary)', transform: isExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
                        ▼
                      </span>
                    </div>
                  </div>
                  
                  {isExpanded && (
                    <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: '8px', background: 'rgba(0,0,0,0.15)' }}>
                      {setArrows.map((session) => {
                        const borderCol = session.type === 'video' ? 'var(--blue)' : 'var(--gold)';
                        return (
                          <div
                            key={session.id}
                            className="glass-card"
                            style={{
                              margin: 0,
                              cursor: 'pointer',
                              borderLeft: `4px solid ${borderCol}`,
                              background: 'rgba(255, 255, 255, 0.02)',
                              padding: '10px 14px',
                              borderRadius: '8px'
                            }}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSelectSession(session);
                            }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <div style={{ textAlign: 'left' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                  <span style={{
                                    fontSize: '9px',
                                    background: session.type === 'video' ? 'rgba(0,122,255,0.12)' : 'rgba(255,204,0,0.12)',
                                    color: session.type === 'video' ? 'var(--blue)' : 'var(--gold)',
                                    padding: '1px 6px',
                                    borderRadius: '6px',
                                    fontWeight: 'bold',
                                    textTransform: 'uppercase'
                                  }}>
                                    {session.type}
                                  </span>
                                  {session.arrowNumber !== undefined && (
                                    <span style={{ color: '#fff', fontSize: '12px', fontWeight: '500' }}>
                                      Arrow #{session.arrowNumber}
                                    </span>
                                  )}
                                </div>
                                <p style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '4px', marginBottom: 0 }}>
                                  {formatDate(session.timestamp)} • {session.duration}s hold
                                </p>
                              </div>
                              
                              <div style={{ textAlign: 'right' }}>
                                <h3 style={{ color: 'var(--steady)', fontSize: '16px', fontWeight: 800, margin: 0 }}>
                                  {session.score} PTS
                                </h3>
                                <span style={{ fontSize: '9px', color: 'var(--text-secondary)' }}>
                                  {session.distance}m
                                </span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            });
          })()}
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
              isEditing ? (
                <div className="glass-card" style={{ margin: '0 0 20px 0', padding: '16px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center', marginBottom: '12px' }}>
                    <h4 style={{ color: 'var(--gold)', fontSize: '14px', margin: 0, fontWeight: 'bold' }}>🎯 Plot Arrow Landing Position</h4>
                    <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Tap target below to score</span>
                  </div>

                  <div style={{ display: 'flex', gap: '20px', alignItems: 'center', width: '100%', flexWrap: 'wrap', justifyContent: 'center' }}>
                    
                    {/* Interactive FITA Target face */}
                    <div style={{ position: 'relative', background: 'rgba(0,0,0,0.5)', padding: '10px', borderRadius: '12px', border: '1px solid var(--border-glass)', boxShadow: '0 4px 15px rgba(0,0,0,0.4)', pointerEvents: 'auto' }}>
                      <svg 
                        width="220" 
                        height="220" 
                        viewBox="0 0 220 220" 
                        style={{ display: 'block', margin: '0 auto', cursor: 'crosshair' }}
                        onClick={(e) => {
                          const svg = e.currentTarget;
                          const rect = svg.getBoundingClientRect();
                          const clickX = e.clientX - rect.left;
                          const clickY = e.clientY - rect.top;
                          const cx = 110;
                          const cy = 110;
                          const dx = clickX - cx;
                          const dy = clickY - cy;
                          const maxRadius = 100;
                          const dist = Math.sqrt(dx * dx + dy * dy);
                          
                          let normX = dx;
                          let normY = dy;
                          if (dist > maxRadius) {
                            const scale = maxRadius / dist;
                            normX *= scale;
                            normY *= scale;
                          }
                          
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
                          
                          setEditArrowX(Math.round(normX));
                          setEditArrowY(Math.round(normY));
                          setEditScore(calculatedScore);
                        }}
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
                        
                        {/* Edit Marker */}
                        {editArrowX !== undefined && editArrowY !== undefined && (
                          <g>
                            <circle cx={110 + editArrowX} cy={110 + editArrowY} r="7" fill="var(--steady)" opacity="0.6" className="pulsing" />
                            <circle cx={110 + editArrowX} cy={110 + editArrowY} r="3" fill="#fff" stroke="var(--steady)" strokeWidth="1.5" />
                          </g>
                        )}
                      </svg>
                    </div>

                    {/* Inputs panel */}
                    <div style={{ flex: 1, minWidth: '160px', display: 'flex', flexDirection: 'column', gap: '10px', textAlign: 'left' }}>
                      <div style={{ background: 'rgba(255,255,255,0.02)', padding: '10px 12px', borderRadius: '8px', borderLeft: '3px solid var(--gold)' }}>
                        <span style={{ fontSize: '9px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>EDIT ARROW SCORE</span>
                        <strong style={{ fontSize: '16px', color: 'var(--steady)' }}>{editScore} Points {editScore >= 9 ? '🎯' : ''}</strong>
                      </div>
                      
                      <div style={{ background: 'rgba(255,255,255,0.02)', padding: '10px 12px', borderRadius: '8px', borderLeft: '3px solid var(--blue)', pointerEvents: 'auto' }}>
                        <label style={{ fontSize: '9px', color: 'var(--text-secondary)', display: 'block', marginBottom: '6px' }}>TARGET DISTANCE</label>
                        <select
                          value={editDistance}
                          onChange={(e) => setEditDistance(parseInt(e.target.value) || 70)}
                          style={{
                            width: '100%',
                            background: 'rgba(0,0,0,0.5)',
                            border: '1px solid var(--border-glass)',
                            borderRadius: '6px',
                            color: '#fff',
                            padding: '6px',
                            fontSize: '13px'
                          }}
                        >
                          {[18, 30, 50, 60, 70, 90].map((dist) => (
                            <option key={dist} value={dist}>{dist}m</option>
                          ))}
                        </select>
                      </div>

                      {/* Save/Cancel Buttons */}
                      <div style={{ display: 'flex', gap: '8px', marginTop: '4px', pointerEvents: 'auto' }}>
                        <button
                          className="btn-primary"
                          style={{ flex: 1, padding: '8px 12px', fontSize: '12px', borderRadius: '6px', background: 'linear-gradient(135deg, var(--steady), #2ecc71)' }}
                          onClick={() => {
                            onUpdateSession(selectedSession.id, {
                              distance: editDistance,
                              score: editScore,
                              arrowX: editArrowX,
                              arrowY: editArrowY,
                              isScored: true
                            });
                            // Update local select state to reflect changes instantly
                            const updated = {
                              ...selectedSession,
                              distance: editDistance,
                              score: editScore,
                              arrowX: editArrowX,
                              arrowY: editArrowY,
                              isScored: true
                            };
                            setSelectedSession(updated);
                            setIsEditing(false);
                          }}
                        >
                          💾 Save
                        </button>
                        <button
                          className="btn-secondary"
                          style={{ flex: 1, padding: '8px 12px', fontSize: '12px', borderRadius: '6px', borderColor: 'rgba(255,255,255,0.15)', color: '#fff' }}
                          onClick={() => setIsEditing(false)}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>

                  </div>
                </div>
              ) : (
                <div className="glass-card" style={{ margin: '0 0 20px 0', padding: '16px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center', marginBottom: '12px' }}>
                    <h4 style={{ color: '#fff', fontSize: '14px', margin: 0, textAlign: 'left' }}>Arrow Release Scoring Detail</h4>
                    <button
                      className="btn-primary"
                      style={{
                        padding: '6px 12px',
                        fontSize: '11px',
                        borderRadius: '14px',
                        background: 'linear-gradient(135deg, var(--gold), #f39c12)',
                        boxShadow: '0 2px 6px rgba(243,156,18,0.2)',
                        border: 'none',
                        cursor: 'pointer',
                        fontWeight: 'bold',
                        color: '#fff',
                        pointerEvents: 'auto'
                      }}
                      onClick={() => setIsEditing(true)}
                    >
                      🎯 Set Score & Distance
                    </button>
                  </div>
                  
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
                        <strong style={{ fontSize: '16px', color: 'var(--steady)' }}>
                          {selectedSession.score !== undefined && selectedSession.arrowX !== undefined && selectedSession.arrowY !== undefined 
                            ? `${selectedSession.score} Points ${selectedSession.score >= 9 ? '🎯 Gold!' : ''}`
                            : 'Not scored yet'}
                        </strong>
                      </div>
                    </div>

                  </div>
                </div>
              )
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

      {/* --- GUIDED SCORING WIZARD OVERLAY --- */}
      {wizardIndex !== null && wizardUnscored.length > 0 && (
        (() => {
          const currentArrow = wizardUnscored[wizardIndex];
          const nextSetNumber = (() => {
            const existingSets = sessions
              .map(s => s.setNumber)
              .filter((n): n is number => typeof n === 'number');
            return existingSets.length > 0 ? Math.max(...existingSets) + 1 : 1;
          })();
          
          return (
            <div style={{
              position: 'fixed',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              background: 'rgba(5, 5, 8, 0.98)',
              backdropFilter: 'blur(25px)',
              WebkitBackdropFilter: 'blur(25px)',
              zIndex: 200,
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
                <div style={{ textAlign: 'left' }}>
                  <span style={{
                    fontSize: '10px',
                    background: 'rgba(255, 204, 0, 0.15)',
                    color: 'var(--gold)',
                    padding: '2px 8px',
                    borderRadius: '10px',
                    fontWeight: 'bold',
                    textTransform: 'uppercase',
                    letterSpacing: '1px'
                  }}>
                    Scoring Set #{nextSetNumber}
                  </span>
                  <h3 style={{ color: '#fff', fontSize: '18px', marginTop: '4px' }}>
                    Arrow {wizardIndex + 1} of {wizardUnscored.length} (Arrow #{currentArrow.arrowNumber})
                  </h3>
                </div>
                <button
                  className="btn-secondary"
                  style={{
                    padding: '6px 14px',
                    borderRadius: '16px',
                    fontSize: '12px',
                    color: 'var(--unstable)',
                    borderColor: 'rgba(255, 59, 48, 0.2)',
                    background: 'rgba(255, 59, 48, 0.05)',
                    cursor: 'pointer'
                  }}
                  onClick={() => {
                    if (window.confirm("Abort scoring wizard? All current progress will be lost.")) {
                      setWizardIndex(null);
                      setWizardUnscored([]);
                      setWizardAnswers([]);
                    }
                  }}
                >
                  ❌ Abort
                </button>
              </div>

              {/* Wizard Content */}
              <div style={{ flex: 1, overflowY: 'auto', padding: '20px', display: 'flex', flexDirection: 'column', gap: '20px', alignItems: 'center' }}>
                
                {/* Arrow Info banner */}
                <div className="glass-card" style={{ width: '100%', maxWidth: '480px', margin: 0, padding: '12px 16px', textAlign: 'left', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <span style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>SHOT AT</span>
                    <strong style={{ display: 'block', fontSize: '13px', color: '#fff' }}>{formatDate(currentArrow.timestamp)}</strong>
                  </div>
                  <div>
                    <span style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>HOLD TIME</span>
                    <strong style={{ display: 'block', fontSize: '13px', color: '#fff' }}>{currentArrow.duration}s</strong>
                  </div>
                  <div>
                    <span style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>TYPE</span>
                    <strong style={{ display: 'block', fontSize: '13px', color: currentArrow.type === 'video' ? 'var(--blue)' : 'var(--gold)', textTransform: 'capitalize' }}>{currentArrow.type}</strong>
                  </div>
                </div>

                {/* Plot Arrow Landing Position Card */}
                <div className="glass-card" style={{ width: '100%', maxWidth: '480px', margin: 0, padding: '20px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center', marginBottom: '15px' }}>
                    <h4 style={{ color: 'var(--gold)', fontSize: '14px', margin: 0, fontWeight: 'bold' }}>🎯 Plot Arrow Landing Position</h4>
                    <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Tap FITA target to score</span>
                  </div>

                  <div style={{ display: 'flex', gap: '24px', alignItems: 'center', width: '100%', flexDirection: 'column', justifyContent: 'center' }}>
                    
                    {/* Interactive FITA Target face */}
                    <div style={{ position: 'relative', background: 'rgba(0,0,0,0.5)', padding: '12px', borderRadius: '16px', border: '1px solid var(--border-glass)', boxShadow: '0 8px 32px rgba(0,0,0,0.5)', pointerEvents: 'auto' }}>
                      <svg 
                        width="240" 
                        height="240" 
                        viewBox="0 0 220 220" 
                        style={{ display: 'block', margin: '0 auto', cursor: 'crosshair' }}
                        onClick={(e) => {
                          const svg = e.currentTarget;
                          const rect = svg.getBoundingClientRect();
                          const clickX = e.clientX - rect.left;
                          const clickY = e.clientY - rect.top;
                          const cx = 110;
                          const cy = 110;
                          const dx = (clickX / rect.width) * 220 - cx;
                          const dy = (clickY / rect.height) * 220 - cy;
                          const maxRadius = 100;
                          const dist = Math.sqrt(dx * dx + dy * dy);
                          
                          let normX = dx;
                          let normY = dy;
                          if (dist > maxRadius) {
                            const scale = maxRadius / dist;
                            normX *= scale;
                            normY *= scale;
                          }
                          
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
                          
                          setWizardArrowX(Math.round(normX));
                          setWizardArrowY(Math.round(normY));
                          setWizardScore(calculatedScore);
                        }}
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
                        
                        {/* Edit Marker */}
                        {wizardArrowX !== undefined && wizardArrowY !== undefined && (
                          <g>
                            <circle cx={110 + wizardArrowX} cy={110 + wizardArrowY} r="7" fill="var(--steady)" opacity="0.6" className="pulsing" />
                            <circle cx={110 + wizardArrowX} cy={110 + wizardArrowY} r="3" fill="#fff" stroke="var(--steady)" strokeWidth="1.5" />
                          </g>
                        )}
                      </svg>
                    </div>

                    {/* Inputs panel */}
                    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '12px', textAlign: 'left', pointerEvents: 'auto' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                        <div style={{ background: 'rgba(255,255,255,0.02)', padding: '10px 12px', borderRadius: '8px', borderLeft: '3px solid var(--gold)', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                          <span style={{ fontSize: '9px', color: 'var(--text-secondary)', display: 'block', marginBottom: '2px' }}>CALCULATED SCORE</span>
                          <strong style={{ fontSize: '15px', color: 'var(--steady)' }}>
                            {wizardArrowX !== undefined ? `${wizardScore} PTS ${wizardScore >= 9 ? '🎯' : ''}` : 'Tap Target'}
                          </strong>
                        </div>
                        
                        <div style={{ background: 'rgba(255,255,255,0.02)', padding: '8px 12px', borderRadius: '8px', borderLeft: '3px solid var(--blue)' }}>
                          <label style={{ fontSize: '9px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>DISTANCE</label>
                          <select
                            value={wizardDistance}
                            onChange={(e) => setWizardDistance(parseInt(e.target.value) || 70)}
                            style={{
                              width: '100%',
                              background: 'rgba(0,0,0,0.5)',
                              border: '1px solid var(--border-glass)',
                              borderRadius: '6px',
                              color: '#fff',
                              padding: '5px',
                              fontSize: '12px'
                            }}
                          >
                            {[18, 30, 50, 60, 70, 90].map((dist) => (
                              <option key={dist} value={dist}>{dist}m</option>
                            ))}
                          </select>
                        </div>
                      </div>

                      {/* Wizard Navigation Footer */}
                      <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
                        <button
                          className="btn-primary"
                          disabled={wizardArrowX === undefined}
                          style={{
                            flex: 1,
                            padding: '12px 18px',
                            fontSize: '14px',
                            borderRadius: '10px',
                            background: wizardArrowX === undefined ? 'rgba(255,255,255,0.1)' : 'linear-gradient(135deg, var(--steady), #2ecc71)',
                            cursor: wizardArrowX === undefined ? 'not-allowed' : 'pointer',
                            color: '#fff',
                            border: 'none',
                            fontWeight: 'bold',
                            boxShadow: wizardArrowX === undefined ? 'none' : '0 4px 15px rgba(46, 204, 113, 0.25)'
                          }}
                          onClick={() => {
                            if (wizardArrowX === undefined || wizardArrowY === undefined) return;
                            
                            const currentAns = {
                              id: currentArrow.id,
                              score: wizardScore,
                              distance: wizardDistance,
                              arrowX: wizardArrowX,
                              arrowY: wizardArrowY
                            };
                            const updatedAnswers = [...wizardAnswers, currentAns];
                            
                            if (wizardIndex < wizardUnscored.length - 1) {
                              // Move to next arrow
                              setWizardAnswers(updatedAnswers);
                              setWizardIndex(wizardIndex + 1);
                              
                              // Reset score/clicks for the next arrow
                              setWizardScore(0);
                              setWizardArrowX(undefined);
                              setWizardArrowY(undefined);
                            } else {
                              // Done! Update all sessions at once with batch scoring
                              updatedAnswers.forEach((ans) => {
                                onUpdateSession(ans.id, {
                                  score: ans.score,
                                  distance: ans.distance,
                                  arrowX: ans.arrowX,
                                  arrowY: ans.arrowY,
                                  isScored: true,
                                  setNumber: nextSetNumber
                                });
                              });
                              
                              // Expand the newly created set automatically
                              setExpandedSets(prev => ({
                                ...prev,
                                [nextSetNumber]: true
                              }));
                              
                              // Reset wizard
                              setWizardIndex(null);
                              setWizardUnscored([]);
                              setWizardAnswers([]);
                            }
                          }}
                        >
                          {wizardIndex === wizardUnscored.length - 1 ? '🎯 Complete Set' : '➡️ Next Arrow'}
                        </button>
                      </div>

                    </div>
                  </div>
                </div>

              </div>
            </div>
          );
        })()
      )}

    </div>
  );
};
