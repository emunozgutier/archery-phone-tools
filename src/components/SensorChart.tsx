import React, { useEffect, useRef } from 'react';
import type { SensorDataPoint } from '../hooks/useSensors';

interface SensorChartProps {
  rollingBufferRef: React.MutableRefObject<SensorDataPoint[]> | { current: SensorDataPoint[] };
  height?: number;
  showVibrationOnly?: boolean;
}

export const SensorChart: React.FC<SensorChartProps> = ({
  rollingBufferRef,
  height = 140,
  showVibrationOnly = false
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

    // Dynamic 60fps drawing loop
    const draw = () => {
      const width = canvas.width / window.devicePixelRatio;
      const heightVal = canvas.height / window.devicePixelRatio;
      
      // Clear canvas
      ctx.clearRect(0, 0, width, heightVal);

      // Draw background grid lines
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
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

      // --- 1. Draw Vibration Tremor Waveform ---
      ctx.lineWidth = 2.5;
      
      // Paint glowing vibration path
      ctx.beginPath();
      buffer.forEach((pt, idx) => {
        // Map vibration index (0-100) to Canvas coordinate (y goes down, so 100 is bottom, 0 is top)
        // Actually, we want low vibration (steady) at the bottom, and high vibration (shake) at the top!
        const x = idx * spacing;
        const normValue = pt.vibration / 100; // 0 to 1
        const y = heightVal - (normValue * (heightVal - 20)) - 10;
        
        if (idx === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      });
      
      // Draw glow shadow
      ctx.shadowBlur = 12;
      ctx.shadowColor = 'rgba(255, 59, 48, 0.4)';
      ctx.strokeStyle = '#ff3b30'; // red
      
      // Color vibration path dynamically (gradient from green to orange to red)
      const pathGradient = ctx.createLinearGradient(0, heightVal, 0, 0);
      pathGradient.addColorStop(0.1, '#34c759'); // green (steady)
      pathGradient.addColorStop(0.5, '#ff9500'); // orange (tremor)
      pathGradient.addColorStop(0.9, '#ff3b30'); // red (shake)
      
      ctx.strokeStyle = pathGradient;
      ctx.stroke();
      
      // Reset shadows
      ctx.shadowBlur = 0;

      // Fill area under vibration curve with transparency
      ctx.lineTo( (buffer.length - 1) * spacing, heightVal);
      ctx.lineTo(0, heightVal);
      ctx.closePath();
      const fillGrad = ctx.createLinearGradient(0, heightVal, 0, 0);
      fillGrad.addColorStop(0, 'rgba(52, 199, 89, 0.0)');
      fillGrad.addColorStop(0.5, 'rgba(255, 149, 0, 0.05)');
      fillGrad.addColorStop(1, 'rgba(255, 59, 48, 0.15)');
      ctx.fillStyle = fillGrad;
      ctx.fill();

      // --- 2. Draw Pitch & Roll Overlaid Timeline (If not vibration-only) ---
      if (!showVibrationOnly) {
        // We want to overlay pitch/roll timeline.
        // Pitch/roll are usually between -90 and 90 degrees.
        // Let's draw pitch in blue and roll in gold.
        const midY = heightVal / 2;
        const degScale = (heightVal - 30) / 180; // scale -90 to 90

        // Reference center-line (ideal level aiming position)
        ctx.strokeStyle = 'rgba(255, 204, 0, 0.15)';
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.moveTo(0, midY);
        ctx.lineTo(width, midY);
        ctx.stroke();
        ctx.setLineDash([]); // Reset dash

        // Draw Pitch Timeline
        ctx.strokeStyle = 'rgba(0, 122, 255, 0.7)'; // neon blue
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        buffer.forEach((pt, idx) => {
          const x = idx * spacing;
          // Normalize pitch (-90 to 90)
          const clampedPitch = Math.max(-90, Math.min(90, pt.pitch));
          const y = midY - (clampedPitch * degScale);
          if (idx === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.stroke();

        // Draw HUD indicators
        ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.font = '10px JetBrains Mono, monospace';
        ctx.textAlign = 'left';
        ctx.fillText('vibe', 8, 14);
        ctx.fillStyle = 'rgba(0, 122, 255, 0.7)';
        ctx.fillText('pitch', 8, 26);
      } else {
        // Just print latest vibe index
        const latestPoint = buffer[buffer.length - 1];
        ctx.font = '12px JetBrains Mono, monospace';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.textAlign = 'right';
        ctx.fillText(`VIBE INDEX: ${latestPoint.vibration}`, width - 10, 18);
      }

      animationFrameRef.current = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      window.removeEventListener('resize', resizeCanvas);
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [showVibrationOnly, bufferRef]);

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
