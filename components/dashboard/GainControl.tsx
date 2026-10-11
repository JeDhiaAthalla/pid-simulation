// ============================================================================
// GainControl — Unified Reusable Parameter Slider & Numeric Micro-Step Input
// Used for Setpoint, Kp, Ki, Kd, and Custom Plant parameters
// ============================================================================

'use client';

import React, { useState, useEffect } from 'react';
import { Info, RotateCcw } from 'lucide-react';

interface GainControlProps {
  label: string;
  name: string;
  value: number;
  onChange: (val: number) => void;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  color?: string;
  description?: string;
  defaultValue?: number;
}

export const GainControl = React.memo(function GainControl({
  label,
  name,
  value,
  onChange,
  min,
  max,
  step = 0.01,
  unit = '',
  color = '#22D3EE',
  description,
  defaultValue,
}: GainControlProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [tempVal, setTempVal] = useState(value.toString());
  const [showTooltip, setShowTooltip] = useState(false);

  useEffect(() => {
    if (!isEditing) {
      setTempVal(value.toFixed(step < 0.01 ? 3 : 2));
    }
  }, [value, isEditing, step]);

  const handleBlur = () => {
    setIsEditing(false);
    const parsed = parseFloat(tempVal);
    if (!isNaN(parsed)) {
      onChange(Math.max(min, Math.min(max, parsed)));
    } else {
      setTempVal(value.toFixed(step < 0.01 ? 3 : 2));
    }
  };

  const handleStep = (delta: number) => {
    const next = Math.max(min, Math.min(max, parseFloat((value + delta).toFixed(4))));
    onChange(next);
  };

  const isChangedFromDefault =
    defaultValue !== undefined && Math.abs(value - defaultValue) > 1e-4;

  const pct = Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));

  return (
    <div className="group flex flex-col gap-1 p-2 rounded-lg bg-[var(--input-bg)]/60 border border-[var(--border)] hover:border-white/20 transition-all relative">
      {/* Top Row: Label + Info Tooltip + Numeric Controls */}
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-1.5 min-w-0">
          <span
            className="text-[11px] font-mono font-bold tracking-tight"
            style={{ color }}
          >
            {label}
          </span>
          <span className="text-[10px] font-mono opacity-60 truncate max-w-[90px]">
            {name}
          </span>
          {description && (
            <div className="relative">
              <button
                type="button"
                aria-label={`Info ${label}`}
                onClick={() => setShowTooltip((p) => !p)}
                onMouseEnter={() => setShowTooltip(true)}
                onMouseLeave={() => setShowTooltip(false)}
                className="opacity-40 hover:opacity-100 transition-opacity p-0.5"
              >
                <Info size={11} />
              </button>
              {showTooltip && (
                <div className="absolute left-0 bottom-full mb-1 z-60 w-52 p-2 rounded-lg bg-slate-900 border border-white/20 text-[10px] text-slate-200 shadow-xl leading-relaxed pointer-events-none font-mono">
                  {description}
                </div>
              )}
            </div>
          )}
          {isChangedFromDefault && defaultValue !== undefined && (
            <button
              type="button"
              aria-label={`Reset ${label} ke default`}
              onClick={() => onChange(defaultValue)}
              className="p-0.5 opacity-40 hover:opacity-100 hover:text-amber-400 transition-all"
              title={`Reset ke default (${defaultValue})`}
            >
              <RotateCcw size={10} />
            </button>
          )}
        </div>

        {/* Numeric Input & Micro-Step Buttons (Target >= 32px height) */}
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            aria-label={`Kurangi ${label}`}
            onClick={() => handleStep(-(step || 0.01))}
            className="w-6 h-6 rounded bg-white/5 hover:bg-white/15 flex items-center justify-center text-[12px] font-mono font-bold opacity-70 hover:opacity-100 transition-colors active:scale-95 text-slate-300"
            title={`Kurangi ${step}`}
          >
            -
          </button>
          <input
            type="number"
            aria-label={`Nilai ${label}`}
            value={isEditing ? tempVal : value.toFixed(step < 0.01 ? 3 : 2)}
            onFocus={() => {
              setIsEditing(true);
              setTempVal(value.toString());
            }}
            onChange={(e) => setTempVal(e.target.value)}
            onBlur={handleBlur}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleBlur();
            }}
            step={step}
            className="w-16 px-1 py-0.5 text-right font-mono text-xs font-bold bg-black/40 border border-white/10 rounded focus:border-cyan-400 focus:outline-none"
            style={{ color }}
          />
          <button
            type="button"
            aria-label={`Tambah ${label}`}
            onClick={() => handleStep(step || 0.01)}
            className="w-6 h-6 rounded bg-white/5 hover:bg-white/15 flex items-center justify-center text-[12px] font-mono font-bold opacity-70 hover:opacity-100 transition-colors active:scale-95 text-slate-300"
            title={`Tambah ${step}`}
          >
            +
          </button>
          {unit && (
            <span className="text-[10px] font-mono opacity-50 ml-0.5 min-w-[14px]">
              {unit}
            </span>
          )}
        </div>
      </div>

      {/* Bottom Row: Range Slider */}
      <input
        type="range"
        aria-label={`Slider ${label}`}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="slider-input w-full h-1.5 rounded-full appearance-none cursor-pointer mt-1"
        style={{
          background: `linear-gradient(to right, ${color} ${pct}%, var(--slider-track) ${pct}%)`,
        }}
      />
    </div>
  );
});
