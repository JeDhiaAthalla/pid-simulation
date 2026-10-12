// ============================================================================
// RunBar — Simulation Playback Bar (Start/Pause, Step, Reset, Disturbance, Speed)
// ============================================================================

'use client';

import React from 'react';
import { Play, Pause, StepForward, RotateCcw, Zap, Timer } from 'lucide-react';

interface RunBarProps {
  isRunning: boolean;
  onToggleRunning: () => void;
  onStepForward: () => void;
  onReset: () => void;
  onDisturbance: () => void;
  speedMultiplier: number;
  onSetSpeed: (speed: number) => void;
  time: number;
}

export const RunBar = React.memo(function RunBar({
  isRunning,
  onToggleRunning,
  onStepForward,
  onReset,
  onDisturbance,
  speedMultiplier,
  onSetSpeed,
  time,
}: RunBarProps) {
  return (
    <div className="px-3 py-2 border-b border-[var(--border)] bg-[var(--panel-bg)]/80 flex flex-col gap-2 font-mono">
      {/* ── Main Action Buttons ── */}
      <div className="flex items-center gap-1.5">
        {/* Primary Start / Pause Toggle */}
        <button
          type="button"
          aria-label={isRunning ? 'Jeda Simulasi' : 'Mulai Simulasi'}
          onClick={onToggleRunning}
          className={`flex-1 py-2 px-3 rounded-lg flex items-center justify-center gap-2 text-xs font-bold transition-all shadow-sm active:scale-[0.98] ${
            isRunning
              ? 'bg-[var(--accent-amber-bg)] text-[var(--accent-amber)] border border-[var(--accent-amber)]/40 hover:brightness-110'
              : 'bg-[var(--accent-green-bg)] text-[var(--accent-green)] border border-[var(--accent-green)]/40 hover:brightness-110'
          }`}
        >
          {isRunning ? <Pause size={14} /> : <Play size={14} />}
          <span>{isRunning ? 'PAUSE' : 'START'}</span>
        </button>

        {/* Step Forward (1 physics tick dt) */}
        <button
          type="button"
          aria-label="Langkah Maju 1 Tick (Step +1dt)"
          onClick={onStepForward}
          className="p-2 rounded-lg border border-[var(--border)] bg-[var(--input-bg)]/40 hover:bg-[var(--hover-bg)] transition-colors text-[var(--text-muted)] hover:text-[var(--text)]"
          title="Langkah Maju 1 Tick (Δt)"
        >
          <StepForward size={14} />
        </button>

        {/* Panic Reset Button */}
        <button
          type="button"
          aria-label="Reset Plant State ke Nol"
          onClick={onReset}
          className="p-2 rounded-lg border border-[var(--border)] bg-[var(--input-bg)]/40 hover:bg-[var(--accent-red-bg)] hover:border-[var(--accent-red)]/40 text-[var(--accent-red)] transition-colors"
          title="Panic Reset Plant State ke Nol"
        >
          <RotateCcw size={14} />
        </button>

        {/* Transient Disturbance Injection Button */}
        <button
          type="button"
          aria-label="Injeksi Gangguan Gaya Transien"
          onClick={onDisturbance}
          className="p-2 rounded-lg border border-[var(--accent-amber)]/40 bg-[var(--accent-amber-bg)] hover:brightness-110 text-[var(--accent-amber)] transition-colors active:scale-95"
          title="Injeksi Gangguan Gaya Transien (Petir)"
        >
          <Zap size={14} />
        </button>
      </div>

      {/* ── Sub-row: Speed Multipliers & Clock Status ── */}
      <div className="flex items-center justify-between text-[10px]">
        {/* Speed Segmented Control */}
        <div className="flex items-center gap-1.5">
          <span className="text-[var(--text-muted)] flex items-center gap-0.5">
            <Timer size={10} />
            Laju:
          </span>
          <div className="flex gap-0.5 bg-[var(--surface-2)] p-0.5 rounded border border-[var(--border)]">
            {[0.25, 0.5, 1.0, 2.0].map((s) => (
              <button
                key={s}
                type="button"
                aria-label={`Kecepatan ${s}x`}
                onClick={() => onSetSpeed(s)}
                className={`px-1.5 py-0.5 rounded text-[10px] font-extrabold transition-all ${
                  speedMultiplier === s
                    ? 'bg-[var(--accent-amber)] text-[var(--accent-amber-text)] shadow-sm'
                    : 'text-[var(--text-muted)] hover:text-[var(--text)]'
                }`}
              >
                {s}×
              </button>
            ))}
          </div>
        </div>

        {/* Time + Status Pill */}
        <div className="flex items-center gap-2">
          <span className="text-[var(--text-muted)] text-[10px] font-mono">
            {time.toFixed(2)}s
          </span>
          <span
            className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider border ${
              isRunning
                ? 'bg-[var(--accent-green-bg)] text-[var(--accent-green)] border-[var(--accent-green)]/30'
                : 'bg-[var(--surface-2)] text-[var(--text-muted)] border-[var(--border)]'
            }`}
          >
            {isRunning ? '● RUNNING' : '○ DIAM'}
          </span>
        </div>
      </div>
    </div>
  );
});
