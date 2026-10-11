// ============================================================================
// CodeExportDrawer — 1-Click Code Exporter (C++/Arduino, Python, JSON)
// Rendered via React Portal to document.body (Track A1 Specification)
// - Position fixed inset-y-0 right-0, width min(480px, 100vw), z-index 50
// - Backdrop click-to-close, Esc to close, focus trapped & restored
// - Document body scroll locked while open
// - Does not affect sidebar or canvas width / layout
// ============================================================================

'use client';

import React, { useState, useMemo, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Copy, Check, X, FileCode2 } from 'lucide-react';
import { PIDConfig, PlantParameters } from '@/types/simulation';
import { RobotDefinition } from '@/types/robots';

interface CodeExportDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  pidConfig: PIDConfig;
  selectedRobot: RobotDefinition;
  setpoint: number;
  plant: PlantParameters;
  triggerRef?: React.RefObject<HTMLElement | null>;
}

export const CodeExportDrawer = React.memo(function CodeExportDrawer({
  isOpen,
  onClose,
  pidConfig,
  selectedRobot,
  setpoint,
  plant,
  triggerRef,
}: CodeExportDrawerProps) {
  const [mounted, setMounted] = useState(false);
  const [exportTab, setExportTab] = useState<'cpp' | 'python' | 'json'>('cpp');
  const [copied, setCopied] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);
  const previousActiveElementRef = useRef<HTMLElement | null>(null);

  // SSR-safe portal mounting
  useEffect(() => {
    setMounted(true);
  }, []);

  // Keyboard accessibility (Esc to close) & Body scroll lock & Focus management
  useEffect(() => {
    if (!isOpen) return;

    // Save active element for focus restoration
    previousActiveElementRef.current =
      triggerRef?.current || (document.activeElement as HTMLElement | null);

    // Lock body scroll
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Focus drawer container
    const focusTimer = setTimeout(() => {
      const firstFocusable = drawerRef.current?.querySelector<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (firstFocusable) {
        firstFocusable.focus();
      }
    }, 50);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      clearTimeout(focusTimer);
      document.body.style.overflow = originalOverflow;
      window.removeEventListener('keydown', handleKeyDown);

      // Restore focus on close
      if (previousActiveElementRef.current && typeof previousActiveElementRef.current.focus === 'function') {
        previousActiveElementRef.current.focus();
      }
    };
  }, [isOpen, onClose, triggerRef]);

  const snippets = useMemo(() => {
    const { Kp, Ki, Kd, dt, derivativeFilterN, integralClamp } = pidConfig;
    const robot = selectedRobot;

    const cpp = `// ============================================================
// Auto-Generated PID Parameters for: ${robot.name}
// Platform: Universal PID Simulation Platform
// Sampling Frequency: ${(1 / dt).toFixed(0)} Hz (dt = ${dt}s)
// ============================================================
#include <Arduino.h>

const double PID_KP = ${Kp.toFixed(4)};
const double PID_KI = ${Ki.toFixed(4)};
const double PID_KD = ${Kd.toFixed(4)};
const double PID_N  = ${derivativeFilterN.toFixed(1)}; // Low-pass filter N
const double PID_DT = ${dt.toFixed(4)}; // Timestep

const double OUT_MIN = ${integralClamp[0].toFixed(1)};
const double OUT_MAX = ${integralClamp[1].toFixed(1)};

double computePID(double setpoint, double measurement) {
    static double integral = 0.0;
    static double prevMeasurement = 0.0;
    static double filteredDerivative = 0.0;

    double error = setpoint - measurement;

    // Proportional Term
    double pTerm = PID_KP * error;

    // Integral Term
    integral += error * PID_DT;
    if (integral > OUT_MAX) integral = OUT_MAX;
    else if (integral < OUT_MIN) integral = OUT_MIN;
    double iTerm = PID_KI * integral;

    // Derivative on Measurement with Low-Pass Filter
    double rawDeriv = -(measurement - prevMeasurement) / PID_DT;
    prevMeasurement = measurement;
    double alpha = (PID_N * PID_DT) / (1.0 + PID_N * PID_DT);
    filteredDerivative = alpha * rawDeriv + (1.0 - alpha) * filteredDerivative;
    double dTerm = PID_KD * filteredDerivative;

    double output = pTerm + iTerm + dTerm;
    if (output > OUT_MAX) return OUT_MAX;
    if (output < OUT_MIN) return OUT_MIN;
    return output;
}`;

    const python = `# ============================================================
# Auto-Generated PID Parameters for: ${robot.name}
# Platform: Universal PID Simulation Platform
# ============================================================
class PIDController:
    def __init__(self):
        self.Kp = ${Kp.toFixed(4)}
        self.Ki = ${Ki.toFixed(4)}
        self.Kd = ${Kd.toFixed(4)}
        self.N  = ${derivativeFilterN.toFixed(1)}
        self.dt = ${dt.toFixed(4)}
        self.integral = 0.0
        self.prev_meas = 0.0
        self.filtered_d = 0.0
        self.limits = (${integralClamp[0].toFixed(1)}, ${integralClamp[1].toFixed(1)})

    def update(self, setpoint: float, measurement: float) -> float:
        error = setpoint - measurement
        p = self.Kp * error

        self.integral = max(self.limits[0], min(self.limits[1], self.integral + error * self.dt))
        i = self.Ki * self.integral

        raw_d = -(measurement - self.prev_meas) / self.dt
        self.prev_meas = measurement
        alpha = (self.N * self.dt) / (1.0 + self.N * self.dt)
        self.filtered_d = alpha * raw_d + (1.0 - alpha) * self.filtered_d
        d = self.Kd * self.filtered_d

        output = p + i + d
        return max(self.limits[0], min(self.limits[1], output))`;

    const json = JSON.stringify(
      {
        archetype: robot.id,
        name: robot.name,
        targetSetpoint: setpoint,
        gains: {
          Kp,
          Ki,
          Kd,
          derivativeFilterN,
          dt,
          integralClamp,
        },
        plant,
      },
      null,
      2
    );

    return { cpp, python, json };
  }, [pidConfig, selectedRobot, setpoint, plant]);

  if (!isOpen || !mounted) return null;

  const handleCopy = () => {
    const text =
      exportTab === 'cpp'
        ? snippets.cpp
        : exportTab === 'python'
        ? snippets.python
        : snippets.json;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const drawerContent = (
    <div
      className="fixed inset-0 z-50 flex justify-end animate-in fade-in duration-150"
      aria-labelledby="code-export-title"
      role="dialog"
      aria-modal="true"
    >
      {/* Backdrop (Click to close) */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Slide-over Drawer Panel */}
      <div
        ref={drawerRef}
        className="relative z-50 h-full bg-[var(--panel-bg)] border-l border-[var(--border)] shadow-2xl flex flex-col font-mono text-xs overflow-hidden animate-in slide-in-from-right duration-200"
        style={{ width: 'min(480px, 100vw)' }}
      >
        {/* Header */}
        <div className="p-4 border-b border-[var(--border)] bg-black/30 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-cyan-500/15 border border-cyan-500/30 text-cyan-400">
              <FileCode2 size={16} />
            </div>
            <div>
              <h2 id="code-export-title" className="font-bold text-sm text-[var(--text-primary)]">
                Export Controller Code
              </h2>
              <p className="text-[10px] text-slate-400">
                {selectedRobot.name} (dt = {pidConfig.dt}s)
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label="Salin snippet kode"
              onClick={handleCopy}
              className="px-2.5 py-1.5 rounded-md bg-cyan-500/20 text-cyan-300 hover:bg-cyan-500/30 flex items-center gap-1.5 text-[11px] font-bold transition-all active:scale-95 border border-cyan-500/30 shadow-sm"
            >
              {copied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
              <span>{copied ? 'Tersalin!' : 'Copy'}</span>
            </button>

            <button
              type="button"
              aria-label="Tutup drawer ekspor kode"
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Format Selector Tabs */}
        <div className="px-4 py-2.5 border-b border-[var(--border)] bg-black/15 flex items-center gap-1.5 shrink-0">
          {(['cpp', 'python', 'json'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setExportTab(tab)}
              className={`px-3 py-1 rounded-md text-[11px] font-bold transition-all ${
                exportTab === tab
                  ? 'bg-cyan-400 text-slate-900 shadow-md'
                  : 'bg-white/5 text-slate-400 hover:text-slate-200 hover:bg-white/10'
              }`}
            >
              {tab === 'cpp' ? 'C++ / Arduino' : tab === 'python' ? 'Python' : 'JSON Schema'}
            </button>
          ))}
        </div>

        {/* Code Preview Body (Scrollable) */}
        <div className="flex-1 p-4 overflow-y-auto custom-scrollbar bg-slate-950/80">
          <pre className="p-3.5 rounded-xl bg-slate-950 text-[10px] text-cyan-300/90 overflow-x-auto leading-relaxed border border-white/10 font-mono shadow-inner">
            {exportTab === 'cpp' ? snippets.cpp : exportTab === 'python' ? snippets.python : snippets.json}
          </pre>
        </div>

        {/* Footer info */}
        <div className="p-3 border-t border-[var(--border)] bg-black/40 text-[10px] text-slate-400 flex items-center justify-between shrink-0">
          <span>Target SP: {setpoint.toFixed(2)}</span>
          <span>Esc untuk menutup</span>
        </div>
      </div>
    </div>
  );

  return createPortal(drawerContent, document.body);
});
