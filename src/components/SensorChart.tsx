import React, { useEffect, useRef } from 'react';
import type { SensorDataPoint } from '../hooks/useSensors';

interface SensorChartProps {
  rollingBufferRef: React.MutableRefObject<SensorDataPoint[]> | { current: SensorDataPoint[] };
  height?: number;
  calibration?: {
    gravityDominantAxis: 'x' | 'y' | 'z' | null;
    magnetDominantAxis: 'x' | 'y' | 'z' | null;
  };
  triggerState?: 'IDLE' | 'ARMED' | 'AIMING';
  currentTimeOffset?: number | null;
}

export const SensorChart: React.FC<SensorChartProps> = ({
  rollingBufferRef,
  height = 140,
  calibration,
  triggerState,
  currentTimeOffset
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const bufferRef = rollingBufferRef;
  const syncOffsetRef = useRef<number | null>(null);

  useEffect(() => {
    syncOffsetRef.current = currentTimeOffset !== undefined ? currentTimeOffset : null;
  }, [currentTimeOffset]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Handle high-DPI displays (retina)
    const resizeCanvas = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * window.devicePixelRatio;
      canvas.height = rect.height * window.devicePixelRatio;
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    };

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    // Helpers to resolve component angles relative to primary fields in degrees (0-180)
    const getDegrees = (vec: { x: number; y: number; z: number } | null | undefined, axis: 'x' | 'y' | 'z') => {
      if (!vec) return 90;
      const norm = Math.sqrt(vec.x * vec.x + vec.y * vec.y + vec.z * vec.z) || 1;
      const val = vec[axis];
      const clamped = Math.max(-1, Math.min(1, val / norm));
      return Math.round(Math.acos(clamped) * (180 / Math.PI));
    };

    // Premium axis color palette matching our matrix diagnostic dashboard
    const getAxisColor = (axis: 'x' | 'y' | 'z') => {
      if (axis === 'x') return '#fc0'; // gold
      if (axis === 'y') return '#007aff'; // blue
      return '#34c759'; // teal/green
    };

    // Dynamic 60fps drawing loop
    const draw = () => {
      const width = canvas.width / window.devicePixelRatio;
      const heightVal = canvas.height / window.devicePixelRatio;
      
      // Clear canvas
      ctx.clearRect(0, 0, width, heightVal);

      // Draw background grid lines
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
      ctx.lineWidth = 1;
      
      const gridRows = 4;
      for (let i = 1; i < gridRows; i++) {
        const y = (heightVal / gridRows) * i;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }

      const gridCols = 8;
      for (let i = 1; i < gridCols; i++) {
        const x = (width / gridCols) * i;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, heightVal);
        ctx.stroke();
      }

      const buffer = bufferRef.current;
      if (buffer.length < 2) {
        // Draw empty text placeholder
        ctx.font = '13px Outfit, sans-serif';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('Calibrating sensors...', width / 2, heightVal / 2);
        animationFrameRef.current = requestAnimationFrame(draw);
        return;
      }

      const maxPoints = 120; // 2 seconds of 60fps data
      const spacing = width / (maxPoints - 1);

      // Resolve calibrated dominant tracking axes
      const gAxis = calibration?.gravityDominantAxis || 'y';
      const mAxis = calibration?.magnetDominantAxis || 'z';

      // If in ARMED or IDLE mode, force traces to flat zero
      const isAiming = triggerState === 'AIMING';

      // --- 1. Draw Gravity Component Angle for Picked Axis (0-180°) ---
      ctx.lineWidth = 2;
      ctx.strokeStyle = getAxisColor(gAxis);
      ctx.beginPath();
      buffer.forEach((pt, idx) => {
        const x = idx * spacing;
        const gAngle = isAiming ? getDegrees({ x: pt.accX, y: pt.accY, z: pt.accZ }, gAxis) : 0;
        const y = heightVal - ((gAngle / 180) * (heightVal - 30)) - 8;
        if (idx === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();

      // --- 2. Draw Magnet Component Angle for Picked Axis (0-180°) ---
      ctx.lineWidth = 2;
      ctx.strokeStyle = getAxisColor(mAxis);
      ctx.beginPath();
      buffer.forEach((pt, idx) => {
        const x = idx * spacing;
        const mAngle = isAiming ? getDegrees({ x: pt.magX, y: pt.magY, z: pt.magZ }, mAxis) : 0;
        const y = heightVal - ((mAngle / 180) * (heightVal - 30)) - 8;
        if (idx === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();

      // --- 2.5 Draw Sync Scrubber Cursor if active ---
      const offset = syncOffsetRef.current;
      if (offset !== null && offset !== undefined && buffer.length > 1) {
        const tStart = buffer[0].timestamp;
        const tEnd = buffer[buffer.length - 1].timestamp;
        const totalDuration = (tEnd - tStart) / 1000 || 1;
        const ratio = Math.max(0, Math.min(1, offset / totalDuration));
        const syncX = ratio * width;

        // Scrubber line
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.55)'; // glowing cyan
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(syncX, 0);
        ctx.lineTo(syncX, heightVal);
        ctx.stroke();

        // Top dot indicator
        ctx.fillStyle = '#38bdf8';
        ctx.beginPath();
        ctx.arc(syncX, 4, 3.5, 0, Math.PI * 2);
        ctx.fill();
      }

      // --- 3. Draw Diagnostics Telemetry HUD Readout ---
      const latestPt = buffer[buffer.length - 1];
      const latestGAngle = getDegrees({ x: latestPt.accX, y: latestPt.accY, z: latestPt.accZ }, gAxis);
      const latestMAngle = getDegrees({ x: latestPt.magX, y: latestPt.magY, z: latestPt.magZ }, mAxis);

      ctx.font = '9px JetBrains Mono, monospace';
      ctx.textBaseline = 'top';

      // Left side: current tracking state
      ctx.fillStyle = isAiming ? 'var(--gold)' : 'var(--text-secondary)';
      ctx.textAlign = 'left';
      ctx.fillText(`📊 STATUS: ${triggerState || 'IDLE'}`, 8, 8);

      // Right side: picked components angles (show 0 if in ARMED/IDLE mode)
      ctx.textAlign = 'right';
      ctx.fillStyle = getAxisColor(gAxis);
      ctx.fillText(`🎯 Grav ${gAxis.toUpperCase()}: ${isAiming ? latestGAngle : 0}°`, width - 8, 8);
      ctx.fillStyle = getAxisColor(mAxis);
      ctx.fillText(`🧲 Mag ${mAxis.toUpperCase()}: ${isAiming ? latestMAngle : 0}°`, width - 8, 18);

      animationFrameRef.current = requestAnimationFrame(draw);
    };

    animationFrameRef.current = requestAnimationFrame(draw);

    return () => {
      window.removeEventListener('resize', resizeCanvas);
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [bufferRef, calibration, triggerState]);

  return (
    <div style={{
      width: '100%',
      height: `${height}px`,
      borderRadius: 'var(--border-radius-md)',
      overflow: 'hidden',
      position: 'relative',
      border: '1px solid rgba(255, 255, 255, 0.05)',
      background: 'rgba(5, 5, 8, 0.8)'
    }}>
      <canvas
        ref={canvasRef}
        style={{
          width: '100%',
          height: '100%',
          display: 'block'
        }}
      />
    </div>
  );
};
