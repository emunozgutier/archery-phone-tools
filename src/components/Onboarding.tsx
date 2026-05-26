import React, { useState } from 'react';

interface OnboardingProps {
  isSupported: boolean;
  permissionGranted: boolean | null;
  onRequestPermissions: () => Promise<boolean>;
  cameraActive: boolean;
  onRequestCamera: () => Promise<MediaStream | null>;
  onMockSetup: () => void;
  isMockActive: boolean;
}

export const Onboarding: React.FC<OnboardingProps> = ({
  isSupported,
  permissionGranted,
  onRequestPermissions,
  cameraActive,
  onRequestCamera,
  onMockSetup,
  isMockActive
}) => {
  const [loading, setLoading] = useState(false);
  const [cameraLoading, setCameraLoading] = useState(false);

  const handleMotionClick = async () => {
    setLoading(true);
    await onRequestPermissions();
    setLoading(false);
  };

  const handleCameraClick = async () => {
    setCameraLoading(true);
    await onRequestCamera();
    setCameraLoading(false);
  };

  return (
    <div className="scrollable" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', minHeight: '80%' }}>
      {/* Dynamic Archery Visual Header */}
      <div style={{ textAlign: 'center', marginBottom: '32px', position: 'relative' }}>
        <div style={{
          width: '120px',
          height: '120px',
          borderRadius: '50%',
          background: 'radial-gradient(circle, #ffcc00 10%, #ff3b30 30%, #007aff 50%, #1a1a24 70%, #ffffff 90%)',
          margin: '0 auto',
          boxShadow: '0 8px 30px rgba(0,0,0,0.5), inset 0 0 10px rgba(0,0,0,0.3)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          animation: 'spin-slow 24s linear infinite',
          border: '2px solid rgba(255,255,255,0.2)'
        }}>
          {/* Target Center Dot */}
          <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#fff', opacity: 0.8 }} />
        </div>
        
        {/* Sight Ring Mockup overlay */}
        <div style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: '160px',
          height: '160px',
          borderRadius: '50%',
          border: '2px dashed var(--steady)',
          pointerEvents: 'none',
          animation: 'pulse 3s infinite ease-in-out'
        }} />
      </div>

      <div className="glass-panel" style={{ padding: '24px', textAlign: 'center' }}>
        <h1 className="header-title" style={{ fontSize: '26px', textAlign: 'center', marginBottom: '10px' }}>
          Archery Telemetry
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '14px', lineHeight: '1.5', marginBottom: '24px' }}>
          To unlock real-time shake analysis, compass aiming tracking, and target overlay recording, we need access to your device sensors.
        </p>

        {/* Step 1: Motion Sensors */}
        <div className="glass-card" style={{
          textAlign: 'left',
          borderLeft: permissionGranted ? '4px solid var(--steady)' : '4px solid rgba(255,255,255,0.1)',
          padding: '16px'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h3 style={{ fontSize: '15px', color: '#fff' }}>1. Device Motion & Orientation</h3>
              <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                Used to measure bow stability, tilt leveling, and target heading.
              </p>
            </div>
            {permissionGranted ? (
              <span style={{ color: 'var(--steady)', fontSize: '13px', fontWeight: 'bold' }}>✓ Active</span>
            ) : (
              <button
                className="btn-primary"
                style={{ padding: '8px 16px', fontSize: '13px', minWidth: '100px' }}
                onClick={handleMotionClick}
                disabled={loading}
              >
                {loading ? 'Enabling...' : 'Enable'}
              </button>
            )}
          </div>
        </div>

        {/* Step 2: Camera Stream */}
        <div className="glass-card" style={{
          textAlign: 'left',
          borderLeft: cameraActive ? '4px solid var(--steady)' : '4px solid rgba(255,255,255,0.1)',
          padding: '16px',
          marginTop: '12px'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h3 style={{ fontSize: '15px', color: '#fff' }}>2. Back Camera Feed</h3>
              <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                Used to overlay HUD aiming stats on top of live targeting feed.
              </p>
            </div>
            {cameraActive ? (
              <span style={{ color: 'var(--steady)', fontSize: '13px', fontWeight: 'bold' }}>✓ Active</span>
            ) : (
              <button
                className="btn-primary"
                style={{ padding: '8px 16px', fontSize: '13px', minWidth: '100px', background: 'linear-gradient(135deg, var(--blue), #0051ba)', boxShadow: '0 4px 15px rgba(0, 122, 255, 0.4)' }}
                onClick={handleCameraClick}
                disabled={cameraLoading}
              >
                {cameraLoading ? 'Starting...' : 'Access'}
              </button>
            )}
          </div>
        </div>

        {/* Fallback Simulator / Skip Onboarding for Developers */}
        <div style={{ marginTop: '24px' }}>
          {!isSupported && (
            <div style={{ background: 'rgba(255,149,0,0.1)', border: '1px solid rgba(255,149,0,0.3)', borderRadius: '8px', padding: '10px', fontSize: '12px', color: 'var(--tremor)', marginBottom: '16px', textAlign: 'left' }}>
              ⚠️ Motion sensors not detected. This is typical when testing on desktop browsers. We've enabled our built-in <strong>Archery Simulator</strong> for you.
            </div>
          )}
          
          <button
            className="btn-secondary"
            style={{ width: '100%', fontSize: '14px', padding: '12px' }}
            onClick={onMockSetup}
          >
            {isMockActive ? "🚀 Simulator Active - Enter Dashboard" : "💻 Use Desktop Archery Simulator"}
          </button>
        </div>
      </div>
    </div>
  );
};
