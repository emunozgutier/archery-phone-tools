import React, { useEffect, useRef } from 'react';
import type { SensorDataPoint } from '../hooks/useSensors';

interface SensorChartProps {
  rollingBufferRef: React.MutableRefObject<SensorDataPoint[]> | { current: SensorDataPoint[] };
  height?: number;
  calibration?: {
    gravityDominantAxis: 'x' | 'y' | 'z' | null;
    magnetDominantAxis: 'x' | 'y' | 'z' | null;
  };
}

export const SensorChart: React.FC<SensorChartProps> = ({
  rollingBufferRef,
  height = 140,
  calibration
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const bufferRef = rollingBufferRef;

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

      // --- 1. Draw Stability Waveform (Emerald hold timeline 0-100%) ---
      ctx.lineWidth = 2;
      ctx.beginPath();
      
      buffer.forEach((pt, idx) => {
        const x = idx * spacing;
        const stability = 100 - pt.vibration; // Map shakiness (0-100) to Stability (100-0)
        const normValue = stability / 100;
        const y = heightVal - (normValue * (heightVal - 30)) - 8;
        
        if (idx === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      });

      // Draw premium glow shadow on holding stability
      ctx.shadowBlur = 8;
      ctx.shadowColor = 'rgba(52, 199, 89, 0.25)';
      ctx.strokeStyle = '#34c759'; // steady green
      ctx.stroke();
      ctx.shadowBlur = 0; // reset

      // Translucent hold area filling
      ctx.lineTo((buffer.length - 1) * spacing, heightVal);
      ctx.lineTo(0, heightVal);
      ctx.closePath();
      const fillGrad = ctx.createLinearGradient(0, heightVal, 0, 0);
      fillGrad.addColorStop(0, 'rgba(52, 199, 89, 0.0)');
      fillGrad.addColorStop(1, 'rgba(52, 199, 89, 0.08)');
      ctx.fillStyle = fillGrad;
      ctx.fill();

      // --- 2. Draw Gravity Component Angle for Picked Axis (0-180°) ---
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = getAxisColor(gAxis);
      ctx.beginPath();
      buffer.forEach((pt, idx) => {
        const x = idx * spacing;
        const gAngle = getDegrees({ x: pt.accX, y: pt.accY, z: pt.accZ }, gAxis);
        const y = heightVal - ((gAngle / 180) * (heightVal - 30)) - 8;
        if (idx === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();

      // --- 3. Draw Magnet Component Angle for Picked Axis (0-180°) ---
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = getAxisColor(mAxis);
      ctx.beginPath();
      buffer.forEach((pt, idx) => {
        const x = idx * spacing;
        const mAngle = getDegrees({ x: pt.magX, y: pt.magY, z: pt.magZ }, mAxis);
        const y = heightVal - ((mAngle / 180) * (heightVal - 30)) - 8;
        if (idx === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();

      // --- 4. Draw Diagnostics Telemetry HUD Readout ---
      const latestPt = buffer[buffer.length - 1];
      const latestStability = 100 - latestPt.vibration;
      const latestGAngle = getDegrees({ x: latestPt.accX, y: latestPt.accY, z: latestPt.accZ }, gAxis);
      const latestMAngle = getDegrees({ x: latestPt.magX, y: latestPt.magY, z: latestPt.magZ }, mAxis);

      ctx.font = '9px JetBrains Mono, monospace';
      ctx.textBaseline = 'top';

      // Left side: stability score percentage
      ctx.fillStyle = '#34c759';
      ctx.textAlign = 'left';
      ctx.fillText(`🟢 STABILITY: ${latestStability}%`, 8, 8);

      // Right side: picked components angles
      ctx.textAlign = 'right';
      ctx.fillStyle = getAxisColor(gAxis);
      ctx.fillText(`🎯 Grav ${gAxis.toUpperCase()}: ${latestGAngle}°`, width - 8, 8);
      ctx.fillStyle = getAxisColor(mAxis);
      ctx.fillText(`🧲 Mag ${mAxis.toUpperCase()}: ${latestMAngle}°`, width - 8, 18);

      animationFrameRef.current = requestAnimationFrame(draw);
    };

    animationFrameRef.current = requestAnimationFrame(draw);

    return () => {
      window.removeEventListener('resize', resizeCanvas);
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [bufferRef, calibration]);

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
