import React, { useState, useEffect } from 'react';
import { useGlobal } from '../store/useGlobal';

interface HUDOverlayProps {
  pitch: number;
  roll: number;
  heading: number;
  triggerState: 'IDLE' | 'ARMED' | 'AIMING';
  trackerState?: 'idle' | 'enter_state_armed' | 'stable_state_armed' | 'moving_to_state_aim' | 'enter_aiming_aim' | 'stable_state_aim' | 'exit_aiming_aim';
  isRecording: boolean;
  calibration: { downPitch: number; aimPitch: number; pitchTolerance: number };
  onStopRecording?: () => void;
}

export const HUDOverlay: React.FC<HUDOverlayProps> = ({
  pitch,
  roll,
  heading,
  triggerState,
  trackerState,
  isRecording,
  calibration,
  onStopRecording
}) => {
  const [recordSeconds, setRecordSeconds] = useState(0);
  const { sessions, currentArrowNumber } = useGlobal();
  const isAlreadyShot = sessions.some((s) => s.arrowNumber === currentArrowNumber);

  useEffect(() => {
    if (!isRecording) {
      return;
    }
    const interval = setInterval(() => {
      setRecordSeconds(prev => prev + 1);
    }, 1000);
    return () => {
      clearInterval(interval);
      setTimeout(() => setRecordSeconds(0), 0);
    };
  }, [isRecording]);

  // Format time (MM:SS)
  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60).toString().padStart(2, '0');
    const s = (secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  // Convert heading to cardinal directions
  const getCardinal = (deg: number) => {
    const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const index = Math.round(((deg % 360) / 45)) % 8;
    return `${deg}° ${directions[index]}`;
  };

  // Calculate bubble offsets (clamped between -50px and +50px for UI constraints)
  // Gamma controls left-right roll
  const maxOffset = 60;
  const rollError = roll; // 0 is ideal
  const rollOffset = Math.max(-maxOffset, Math.min(maxOffset, (rollError / 15) * maxOffset));
  const isRollBalanced = Math.abs(rollError) < 2.5;

  // Pitch controls up-down alignment relative to calibrated aimPitch
  const pitchError = pitch - calibration.aimPitch;
  const pitchOffset = Math.max(-maxOffset, Math.min(maxOffset, (pitchError / calibration.pitchTolerance) * maxOffset));
  const isPitchBalanced = Math.abs(pitchError) < 3.0;

  // Determine sight target color based directly on balance alignment
  const targetScale = 1;
  const targetColor = isPitchBalanced && isRollBalanced ? 'var(--steady)' : 'var(--gold)';

  // Deterministic clean alignment (no vibration jitter)
  const jitterX = 0;
  const jitterY = 0;

  return (
    <div style={{
      position: 'absolute',
      top: 0,
      left: 0,
      width: '100%',
      height: '100%',
      pointerEvents: 'none', // Allow clicking behind
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-between',
      padding: '16px',
      boxSizing: 'border-box',
      zIndex: 10
    }}>
      
      {/* --- TOP BAR: Compass and Recording Status --- */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        width: '100%'
      }}>
        {/* Cardinal Heading, Pitch, and Roll HUD */}
        <div className="glass-card" style={{
          padding: '6px 14px',
          margin: 0,
          display: 'flex',
          alignItems: 'center',
          gap: '14px',
          borderRadius: '20px',
          background: 'rgba(10, 11, 16, 0.75)',
          border: '1px solid rgba(255, 255, 255, 0.15)'
        }}>
          {/* HDG */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ fontSize: '9px', color: 'var(--text-secondary)', fontWeight: 'bold' }}>HDG</span>
            <span style={{ fontSize: '12px', fontFamily: 'var(--mono)', fontWeight: 700, color: 'var(--gold)' }}>
              {getCardinal(heading)}
            </span>
          </div>

          {/* Divider */}
          <div style={{ width: '1px', height: '12px', background: 'rgba(255,255,255,0.15)' }} />

          {/* PITCH */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ fontSize: '9px', color: 'var(--text-secondary)', fontWeight: 'bold' }}>PITCH</span>
            <span style={{ fontSize: '12px', fontFamily: 'var(--mono)', fontWeight: 700, color: isPitchBalanced ? 'var(--steady)' : '#fff' }}>
              {pitch > 0 ? '+' : ''}{Math.round(pitch)}°
            </span>
          </div>

          {/* Divider */}
          <div style={{ width: '1px', height: '12px', background: 'rgba(255,255,255,0.15)' }} />

          {/* ROLL */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ fontSize: '9px', color: 'var(--text-secondary)', fontWeight: 'bold' }}>ROLL</span>
            <span style={{ fontSize: '12px', fontFamily: 'var(--mono)', fontWeight: 700, color: isRollBalanced ? 'var(--steady)' : '#fff' }}>
              {roll > 0 ? '+' : ''}{Math.round(roll)}°
            </span>
          </div>
        </div>

        {/* Trigger Cues and Recording Status */}
        {isRecording ? (
          <div className="glass-card" style={{
            padding: '6px 12px',
            margin: 0,
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            borderRadius: '20px',
            background: 'rgba(255, 59, 48, 0.15)',
            border: '1px solid var(--unstable)'
          }}>
            <span style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              background: 'var(--unstable)',
              display: 'inline-block'
            }} className="blinking" />
            <span style={{ fontSize: '11px', color: '#fff', fontWeight: 'bold' }}>AUTO REC</span>
            <span style={{ fontSize: '14px', fontFamily: 'var(--mono)', fontWeight: 700, color: '#fff' }}>
              {formatTime(recordSeconds)}
            </span>
          </div>
        ) : (
          <div className="glass-card" style={{
            padding: '6px 12px',
            margin: 0,
            borderRadius: '20px',
            background: 'rgba(10, 11, 16, 0.75)',
            border: '1px solid rgba(255, 255, 255, 0.1)'
          }}>
            {(() => {
              switch (trackerState) {
                case 'idle':
                  if (isAlreadyShot) {
                    return <span style={{ fontSize: '12px', color: 'var(--unstable)', fontWeight: 'bold' }} className="blinking">⚠️ ARROW SHOT - SELECT UNUSED</span>;
                  }
                  return <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>⬇️ POINT BOW DOWN</span>;
                case 'enter_state_armed':
                  return <span style={{ fontSize: '12px', color: 'var(--gold)', fontWeight: 'bold' }} className="pulsing">⏳ ARMING... HOLD</span>;
                case 'stable_state_armed':
                  return <span style={{ fontSize: '12px', color: 'var(--steady)', fontWeight: 'bold' }} className="pulsing">🏹 ARMED - LIFT</span>;
                case 'moving_to_state_aim':
                  return <span style={{ fontSize: '12px', color: 'var(--blue)', fontWeight: 'bold' }}>🏹 DRAWING & LIFTING...</span>;
                case 'enter_aiming_aim':
                  return <span style={{ fontSize: '12px', color: 'var(--gold)', fontWeight: 'bold' }}>🎯 AIM ACQUIRED</span>;
                case 'stable_state_aim':
                  return <span style={{ fontSize: '12px', color: 'var(--steady)', fontWeight: 'bold' }}>🟢 PEAK AIM ACTIVE</span>;
                case 'exit_aiming_aim':
                  return <span style={{ fontSize: '12px', color: 'var(--unstable)', fontWeight: 'bold' }} className="blinking">🏹 FOLLOW-THROUGH</span>;
                default:
                  if (triggerState === 'AIMING') return <span style={{ fontSize: '12px', color: 'var(--gold)', fontWeight: 'bold' }}>🎯 AIM ACTIVE</span>;
                  if (triggerState === 'ARMED') return <span style={{ fontSize: '12px', color: 'var(--steady)', fontWeight: 'bold' }} className="pulsing">🏹 ARMED - LIFT</span>;
                  return <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>POINT BOW DOWN</span>;
              }
            })()}
          </div>
        )}
      </div>

      {/* --- CENTER VIEWPORT: Reticle and Dual-Axis Levels --- */}
      <div style={{
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        width: '260px',
        height: '260px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        pointerEvents: 'none'
      }}>
        
        {/* Horizontal Bubble Level Tape (Top) */}
        <div style={{
          position: 'absolute',
          top: 0,
          width: '140px',
          height: '14px',
          background: 'rgba(0,0,0,0.5)',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: '7px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: 'inset 0 0 5px rgba(0,0,0,0.8)'
        }}>
          {/* Target Center Line */}
          <div style={{ position: 'absolute', width: '2px', height: '100%', background: 'rgba(255, 255, 255, 0.3)' }} />
          <div style={{ position: 'absolute', width: '24px', height: '80%', borderLeft: '1px solid var(--steady)', borderRight: '1px solid var(--steady)' }} />
          
          {/* Sliding level bubble */}
          <div style={{
            position: 'absolute',
            width: '10px',
            height: '10px',
            borderRadius: '50%',
            background: isRollBalanced ? 'var(--steady)' : 'var(--gold)',
            boxShadow: isRollBalanced ? '0 0 10px var(--steady)' : '0 0 5px var(--gold)',
            transform: `translateX(${rollOffset}px)`,
            transition: 'transform 0.05s ease-out, background-color 0.1s'
          }} />
        </div>

        {/* Vertical Bubble Level Tape (Right Side) */}
        <div style={{
          position: 'absolute',
          right: 0,
          width: '14px',
          height: '140px',
          background: 'rgba(0,0,0,0.5)',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: '7px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: 'inset 0 0 5px rgba(0,0,0,0.8)'
        }}>
          {/* Target Center Line */}
          <div style={{ position: 'absolute', height: '2px', width: '100%', background: 'rgba(255, 255, 255, 0.3)' }} />
          <div style={{ position: 'absolute', height: '24px', width: '80%', borderTop: '1px solid var(--steady)', borderBottom: '1px solid var(--steady)' }} />
          
          {/* Sliding level bubble */}
          <div style={{
            position: 'absolute',
            width: '10px',
            height: '10px',
            borderRadius: '50%',
            background: isPitchBalanced ? 'var(--steady)' : 'var(--blue)',
            boxShadow: isPitchBalanced ? '0 0 10px var(--steady)' : '0 0 5px var(--blue)',
            transform: `translateY(${-pitchOffset}px)`, // pitch error inverted for vertical up/down movement
            transition: 'transform 0.05s ease-out, background-color 0.1s'
          }} />
        </div>

        {/* Concentric Sight Reticle */}
        <div style={{
          width: '80px',
          height: '80px',
          borderRadius: '50%',
          border: `2px solid ${targetColor}`,
          boxShadow: `0 0 15px ${targetColor}44`,
          transform: `scale(${targetScale}) translate(${jitterX}px, ${jitterY}px)`,
          transition: 'transform 0.08s ease-out, border-color 0.15s',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative'
        }}>
          {/* Inner Sight Reticle Crosshairs */}
          <div style={{ width: '40px', height: '1px', background: `${targetColor}aa`, position: 'absolute' }} />
          <div style={{ height: '40px', width: '1px', background: `${targetColor}aa`, position: 'absolute' }} />
          
          {/* Center aiming pin (dot) */}
          <div style={{
            width: '6px',
            height: '6px',
            borderRadius: '50%',
            background: targetColor,
            boxShadow: `0 0 8px ${targetColor}`
          }} />
        </div>

      </div>

      {/* --- BOTTOM BAR: Live vibration readout & balance status --- */}
      <div style={{
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px'
      }}>
        {isRecording && onStopRecording && (
          <button
            onClick={onStopRecording}
            style={{
              pointerEvents: 'auto',
              alignSelf: 'center',
              background: 'rgba(255, 59, 48, 0.25)',
              border: '1px solid var(--unstable)',
              color: '#fff',
              padding: '10px 20px',
              borderRadius: '24px',
              fontSize: '13px',
              fontWeight: 'bold',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              cursor: 'pointer',
              boxShadow: '0 4px 15px rgba(255, 59, 48, 0.4)',
              backdropFilter: 'blur(10px)',
              WebkitBackdropFilter: 'blur(10px)',
              margin: '4px 0',
              transition: 'transform 0.1s ease-out'
            }}
          >
            <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: 'var(--unstable)' }} className="blinking" />
            <span>Stop Recording</span>
          </button>
        )}
      </div>
      
    </div>
  );
};
