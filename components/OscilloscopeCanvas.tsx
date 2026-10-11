// ============================================================================
// OscilloscopeCanvas — High-Performance Real-Time Signal Plotter
// Canvas 2D with DPR scaling, auto-scaling grid, and live annotations
// ============================================================================

'use client';

import React, { useRef, useEffect, useCallback } from 'react';
import { DataPoint, StepResponseMetrics } from '@/types/simulation';

interface OscilloscopeCanvasProps {
  data: DataPoint[];
  metrics: StepResponseMetrics;
  setpoint: number;
  isDark: boolean;
  width?: number;
  height?: number;
}

// Color palette
const COLORS = {
  dark: {
    bg: '#090D16',
    gridMajor: 'rgba(34, 197, 94, 0.12)',
    gridMinor: 'rgba(34, 197, 94, 0.04)',
    axis: 'rgba(34, 197, 94, 0.3)',
    setpoint: '#FBBF24',
    pv: '#22D3EE',
    control: '#A78BFA',
    error: '#F87171',
    text: '#94A3B8',
    textBright: '#E2E8F0',
    band: 'rgba(34, 197, 94, 0.06)',
    marker: '#22C55E',
  },
  light: {
    bg: '#F8FAFC',
    gridMajor: 'rgba(15, 23, 42, 0.08)',
    gridMinor: 'rgba(15, 23, 42, 0.03)',
    axis: 'rgba(15, 23, 42, 0.2)',
    setpoint: '#D97706',
    pv: '#0891B2',
    control: '#7C3AED',
    error: '#DC2626',
    text: '#64748B',
    textBright: '#1E293B',
    band: 'rgba(15, 23, 42, 0.04)',
    marker: '#16A34A',
  },
};

function niceRound(value: number): number {
  if (value <= 0) return 1;
  const exp = Math.floor(Math.log10(value));
  const mantissa = value / Math.pow(10, exp);
  let nice: number;
  if (mantissa <= 1) nice = 1;
  else if (mantissa <= 2) nice = 2;
  else if (mantissa <= 5) nice = 5;
  else nice = 10;
  return nice * Math.pow(10, exp);
}

export default function OscilloscopeCanvas({
  data,
  metrics,
  setpoint,
  isDark,
  width: propWidth,
  height: propHeight,
}: OscilloscopeCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ width: 800, height: 400 });

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = sizeRef.current.width;
    const h = sizeRef.current.height;

    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.scale(dpr, dpr);

    const c = isDark ? COLORS.dark : COLORS.light;
    const padding = { top: 35, right: 20, bottom: 40, left: 60 };
    const plotW = w - padding.left - padding.right;
    const plotH = h - padding.top - padding.bottom;

    // ── Background ──
    ctx.fillStyle = c.bg;
    ctx.fillRect(0, 0, w, h);

    if (data.length < 2) {
      ctx.fillStyle = c.text;
      ctx.font = '13px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText('Waiting for simulation data...', w / 2, h / 2);
      ctx.fillText('Press ▶ Start to begin', w / 2, h / 2 + 22);
      return;
    }

    // ── Compute ranges ──
    const tMin = data[0].time;
    const tMax = data[data.length - 1].time;
    const timeSpan = Math.max(tMax - tMin, 0.1);

    let yMin = Infinity;
    let yMax = -Infinity;
    for (const dp of data) {
      yMin = Math.min(yMin, dp.processVariable, dp.setpoint, dp.controlEffort * 0.3);
      yMax = Math.max(yMax, dp.processVariable, dp.setpoint, dp.controlEffort * 0.3);
    }
    const yMargin = (yMax - yMin) * 0.15 || 1;
    yMin -= yMargin;
    yMax += yMargin;

    const mapX = (t: number) => padding.left + ((t - tMin) / timeSpan) * plotW;
    const mapY = (v: number) => padding.top + (1 - (v - yMin) / (yMax - yMin)) * plotH;

    // ── Grid ──
    const numGridX = 8;
    const numGridY = 6;
    const dxGrid = niceRound(timeSpan / numGridX);
    const dyGrid = niceRound((yMax - yMin) / numGridY);

    ctx.strokeStyle = c.gridMinor;
    ctx.lineWidth = 0.5;
    ctx.setLineDash([2, 4]);

    // Vertical grid lines
    let tGrid = Math.ceil(tMin / dxGrid) * dxGrid;
    while (tGrid <= tMax) {
      const x = mapX(tGrid);
      ctx.beginPath();
      ctx.moveTo(x, padding.top);
      ctx.lineTo(x, padding.top + plotH);
      ctx.stroke();

      ctx.fillStyle = c.text;
      ctx.font = '10px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`${tGrid.toFixed(2)}s`, x, h - padding.bottom + 16);
      tGrid += dxGrid;
    }

    // Horizontal grid lines
    let yGrid = Math.ceil(yMin / dyGrid) * dyGrid;
    while (yGrid <= yMax) {
      const y = mapY(yGrid);
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(padding.left + plotW, y);
      ctx.stroke();

      ctx.fillStyle = c.text;
      ctx.font = '10px "JetBrains Mono", monospace';
      ctx.textAlign = 'right';
      ctx.fillText(yGrid.toFixed(2), padding.left - 6, y + 3);
      yGrid += dyGrid;
    }

    ctx.setLineDash([]);

    // ── 2% Settling Band ──
    if (setpoint !== 0) {
      const amplitude = Math.abs(setpoint);
      const bandTop = mapY(setpoint + 0.02 * amplitude);
      const bandBot = mapY(setpoint - 0.02 * amplitude);
      ctx.fillStyle = c.band;
      ctx.fillRect(padding.left, bandTop, plotW, bandBot - bandTop);
    }

    // ── Setpoint line ──
    ctx.strokeStyle = c.setpoint;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([8, 4]);
    const spY = mapY(setpoint);
    ctx.beginPath();
    ctx.moveTo(padding.left, spY);
    ctx.lineTo(padding.left + plotW, spY);
    ctx.stroke();
    ctx.setLineDash([]);

    // ── Draw Signal Lines ──
    const drawLine = (
      key: keyof DataPoint,
      color: string,
      lineWidth: number,
      scale: number = 1
    ) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      ctx.beginPath();
      let started = false;
      for (const dp of data) {
        const x = mapX(dp.time);
        const val = (dp[key] as number) * scale;
        const y = mapY(val);
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
    };

    // Control effort (scaled down)
    drawLine('controlEffort', c.control, 1, 0.3);

    // Error
    ctx.globalAlpha = 0.4;
    drawLine('error', c.error, 1);
    ctx.globalAlpha = 1;

    // Process Variable (main signal)
    drawLine('processVariable', c.pv, 2.5);

    // ── Glow effect on PV ──
    ctx.shadowColor = c.pv;
    ctx.shadowBlur = isDark ? 8 : 0;
    drawLine('processVariable', c.pv, 1.5);
    ctx.shadowBlur = 0;

    // ── Peak Marker ──
    if (metrics.peakTime !== null && metrics.peakValue !== null) {
      const px = mapX(metrics.peakTime);
      const py = mapY(metrics.peakValue);
      if (px >= padding.left && px <= padding.left + plotW) {
        ctx.fillStyle = c.marker;
        ctx.beginPath();
        ctx.arc(px, py, 4, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = c.textBright;
        ctx.font = '9px "JetBrains Mono", monospace';
        ctx.textAlign = 'left';
        ctx.fillText(
          `Peak: ${metrics.peakValue.toFixed(2)} @ ${metrics.peakTime.toFixed(3)}s`,
          px + 8,
          py - 6
        );
      }
    }

    // ── Rise Time Marker ──
    if (metrics.riseTime !== null) {
      // Mark rise time region
      ctx.fillStyle = isDark ? 'rgba(34, 197, 94, 0.04)' : 'rgba(16, 185, 129, 0.04)';
    }

    // ── Title & Legend ──
    ctx.font = 'bold 11px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';

    const legendItems = [
      { label: 'SP', color: c.setpoint, dash: true },
      { label: 'PV', color: c.pv, dash: false },
      { label: 'u(t)×0.3', color: c.control, dash: false },
      { label: 'e(t)', color: c.error, dash: false },
    ];

    let legendX = padding.left + 8;
    const legendY = 14;

    ctx.fillStyle = c.textBright;
    ctx.fillText('OSCILLOSCOPE', legendX, legendY);
    legendX += 105;

    for (const item of legendItems) {
      ctx.strokeStyle = item.color;
      ctx.lineWidth = 2;
      if (item.dash) ctx.setLineDash([4, 3]);
      else ctx.setLineDash([]);

      ctx.beginPath();
      ctx.moveTo(legendX, legendY - 3);
      ctx.lineTo(legendX + 16, legendY - 3);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = item.color;
      ctx.font = '10px "JetBrains Mono", monospace';
      ctx.fillText(item.label, legendX + 20, legendY);
      legendX += 70;
    }

    // ── Time axis label ──
    ctx.fillStyle = c.text;
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('Time (s)', w / 2, h - 4);
  }, [data, metrics, setpoint, isDark]);

  // Resize observer
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        sizeRef.current = {
          width: Math.max(200, Math.floor(width)),
          height: Math.max(150, Math.floor(height)),
        };
        draw();
      }
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, [draw]);

  // Redraw on data change
  useEffect(() => {
    draw();
  }, [draw]);

  return (
    <div ref={containerRef} className="w-full h-full min-h-[250px] relative">
      <canvas
        ref={canvasRef}
        className="w-full h-full block"
        style={{ imageRendering: 'auto' }}
      />
    </div>
  );
}
