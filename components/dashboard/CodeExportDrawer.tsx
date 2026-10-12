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
import { getHoverFeedforward } from '@/lib/physicsEngine';

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
    const { Kp, Ki, Kd, dt, derivativeFilterN, setpointWeight } = pidConfig;
    const robot = selectedRobot;
    const b = setpointWeight ?? 1.0;
    const hasB = Math.abs(b - 1.0) > 1e-4;
    const uFf = getHoverFeedforward(plant);
    const [uMin, uMax] = plant.actuatorLimits;
    const controlUnit = robot.controlUnit;
    const outputUnit = robot.outputUnit;
    const setpointVar = robot.outputVariable;
    const controlVar = robot.controlVariable;

    const cpp = `// ============================================================
// Auto-Generated Industrial PID Controller
// Target Plant: ${robot.name}
// Platform: Embedded C++ / Arduino / ESP32
// Sampling Frequency: ${(1 / dt).toFixed(0)} Hz (dt = ${dt} s)
// Process Variable (${setpointVar}): [${outputUnit}]
// Control Output   (${controlVar}): [${controlUnit}]
// ============================================================
#include <Arduino.h>

// --- Controller Tuning Gains ---
const double PID_KP = ${Kp.toFixed(4)}; // Proportional Gain [${controlUnit}/${outputUnit}]
const double PID_KI = ${Ki.toFixed(4)}; // Integral Gain [${controlUnit}/(${outputUnit}*s)]
const double PID_KD = ${Kd.toFixed(4)}; // Derivative Gain [${controlUnit}*s/${outputUnit}]
${hasB ? `const double PID_B  = ${b.toFixed(4)}; // Setpoint Weighting factor (b)\n` : ''}const double PID_N  = ${derivativeFilterN.toFixed(1)}; // Derivative Low-Pass Filter Coefficient
const double PID_DT = ${dt.toFixed(4)}; // Sampling Timestep [s]

// --- Physical Environment & Actuator Bounds ---
const double FEEDFORWARD_FF = ${uFf.toFixed(4)}; // Feedforward bias (e.g. Gravity Hover Thrust m*g) [${controlUnit}]
const double ACTUATOR_MIN   = ${uMin.toFixed(2)}; // Minimum Actuator Limit [${controlUnit}]
const double ACTUATOR_MAX   = ${uMax.toFixed(2)}; // Maximum Actuator Limit [${controlUnit}]

/**
 * Computes one step of PID control effort.
 * @param setpoint    Target value in [${outputUnit}]
 * @param measurement Sensor feedback value in [${outputUnit}]
 * @return            Clamped control effort in [${controlUnit}]
 */
double computePID(double setpoint, double measurement) {
    static double integral = 0.0;
    static double prevMeasurement = 0.0;
    static double filteredDerivative = 0.0;

    double error = setpoint - measurement;

    // 1. Proportional Term${hasB ? ' (with 2-DOF setpoint weighting b)' : ''}
    double pTerm = ${hasB ? `PID_KP * (PID_B * setpoint - measurement)` : `PID_KP * error`};

    // 2. Derivative on Measurement with 1st-Order Low-Pass Filter (eliminates derivative kick)
    double rawDeriv = -(measurement - prevMeasurement) / PID_DT;
    prevMeasurement = measurement;
    double alpha = (PID_N * PID_DT) / (1.0 + PID_N * PID_DT);
    filteredDerivative = alpha * rawDeriv + (1.0 - alpha) * filteredDerivative;
    double dTerm = PID_KD * filteredDerivative;

    // 3. Conditional Integration Anti-Windup
    double tentativeUnsat = FEEDFORWARD_FF + pTerm + (PID_KI * integral) + dTerm;
    bool isHighSat = (tentativeUnsat >= ACTUATOR_MAX && error > 0.0);
    bool isLowSat  = (tentativeUnsat <= ACTUATOR_MIN && error < 0.0);

    if (!isHighSat && !isLowSat) {
        integral += error * PID_DT;
    }

    // 4. Output Headroom Clamp (prevents persistent windup on extreme setpoints)
    double headroomHigh = max(0.0, ACTUATOR_MAX - FEEDFORWARD_FF);
    double headroomLow  = max(0.0, FEEDFORWARD_FF - ACTUATOR_MIN);
    double availableHeadroom = (FEEDFORWARD_FF > 0.0) ? headroomHigh : min(headroomHigh, headroomLow);
    if (PID_KI > 0.0 && availableHeadroom > 0.0) {
        double iMax = 0.90 * availableHeadroom;
        double iClampLimit = iMax / PID_KI;
        if (integral > iClampLimit) integral = iClampLimit;
        else if (integral < -iClampLimit) integral = -iClampLimit;
    }

    double iTerm = PID_KI * integral;

    // 5. Total Control Effort with Saturation
    double output = FEEDFORWARD_FF + pTerm + iTerm + dTerm;
    if (output > ACTUATOR_MAX) return ACTUATOR_MAX;
    if (output < ACTUATOR_MIN) return ACTUATOR_MIN;
    return output;
}`;

    const python = `# ============================================================
# Auto-Generated Industrial PID Controller
# Target Plant: ${robot.name}
# Platform: Python 3.9+ (MicroPython / Desktop)
# Sampling Frequency: ${(1 / dt).toFixed(0)} Hz (dt = ${dt} s)
# Process Variable (${setpointVar}): [${outputUnit}]
# Control Output   (${controlVar}): [${controlUnit}]
# ============================================================

class PIDController:
    """
    Industrial 2-DOF PID Controller with Derivative-on-Measurement,
    Conditional Integration Anti-Windup, and Physical Actuator Limits.
    """
    def __init__(self):
        # --- Controller Tuning Gains ---
        self.Kp = ${Kp.toFixed(4)}  # Proportional Gain [${controlUnit}/${outputUnit}]
        self.Ki = ${Ki.toFixed(4)}  # Integral Gain [${controlUnit}/(${outputUnit}*s)]
        self.Kd = ${Kd.toFixed(4)}  # Derivative Gain [${controlUnit}*s/${outputUnit}]
${hasB ? `        self.b  = ${b.toFixed(4)}  # Setpoint Weighting factor (b)\n` : ''}        self.N  = ${derivativeFilterN.toFixed(1)}  # Derivative Low-Pass Filter Coefficient
        self.dt = ${dt.toFixed(4)}  # Timestep [s]

        # --- Physical Environment & Actuator Bounds ---
        self.u_ff = ${uFf.toFixed(4)}  # Feedforward bias (e.g. Gravity Hover Thrust) [${controlUnit}]
        self.limits = (${uMin.toFixed(2)}, ${uMax.toFixed(2)})  # Saturation [${controlUnit}]

        # --- Internal State Variables ---
        self.integral = 0.0
        self.prev_meas = 0.0
        self.filtered_d = 0.0

    def update(self, setpoint: float, measurement: float) -> float:
        """
        Compute control output for current time step.
        :param setpoint: Target value [${outputUnit}]
        :param measurement: Current measured value [${outputUnit}]
        :return: Saturated control effort [${controlUnit}]
        """
        error = setpoint - measurement

        # 1. Proportional Term${hasB ? ' (2-DOF Setpoint Weighting)' : ''}
        p = ${hasB ? `self.Kp * (self.b * setpoint - measurement)` : `self.Kp * error`}

        # 2. Derivative on Measurement with Low-Pass Filter (eliminates derivative kick)
        raw_d = -(measurement - self.prev_meas) / self.dt
        self.prev_meas = measurement
        alpha = (self.N * self.dt) / (1.0 + self.N * self.dt)
        self.filtered_d = alpha * raw_d + (1.0 - alpha) * self.filtered_d
        d = self.Kd * self.filtered_d

        # 3. Conditional Integration Anti-Windup
        tentative = self.u_ff + p + (self.Ki * self.integral) + d
        is_high_sat = tentative >= self.limits[1] and error > 0
        is_low_sat  = tentative <= self.limits[0] and error < 0

        if not is_high_sat and not is_low_sat:
            self.integral += error * self.dt

        # 4. Output Headroom Clamp
        headroom_high = max(0.0, self.limits[1] - self.u_ff)
        headroom_low  = max(0.0, self.u_ff - self.limits[0])
        available_headroom = headroom_high if self.u_ff > 0 else min(headroom_high, headroom_low)
        if self.Ki > 0 and available_headroom > 0:
            i_max = 0.90 * available_headroom
            i_clamp = i_max / self.Ki
            self.integral = max(-i_clamp, min(i_clamp, self.integral))

        i = self.Ki * self.integral

        # 5. Saturated Total Output
        output = self.u_ff + p + i + d
        return max(self.limits[0], min(self.limits[1], output))

    def reset(self):
        """Reset internal integrator and filter states."""
        self.integral = 0.0
        self.prev_meas = 0.0
        self.filtered_d = 0.0`;

    const json = JSON.stringify(
      {
        archetype: robot.id,
        name: robot.name,
        targetSetpoint: setpoint,
        units: {
          processVariable: outputUnit,
          controlEffort: controlUnit,
        },
        gains: {
          Kp,
          Ki,
          Kd,
          setpointWeight: b,
          derivativeFilterN,
          dt,
        },
        environment: {
          feedforward: uFf,
          actuatorLimits: [uMin, uMax],
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
        className="relative z-50 h-full bg-[var(--surface)] border-l border-[var(--border)] shadow-2xl flex flex-col font-mono text-xs overflow-hidden animate-in slide-in-from-right duration-200"
        style={{ width: 'min(480px, 100vw)' }}
      >
        {/* Header */}
        <div className="p-4 border-b border-[var(--border)] bg-[var(--surface-2)] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-[var(--accent-cyan-bg)] border border-[var(--border-active)] text-[var(--accent-cyan)]">
              <FileCode2 size={16} />
            </div>
            <div>
              <h2 id="code-export-title" className="font-bold text-sm text-[var(--text)]">
                Export Controller Code
              </h2>
              <p className="text-[10px] text-[var(--text-muted)]">
                {selectedRobot.name} (dt = {pidConfig.dt}s)
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label="Salin snippet kode"
              onClick={handleCopy}
              className="px-2.5 py-1.5 rounded-md bg-[var(--accent-cyan-bg)] text-[var(--accent-cyan)] hover:brightness-110 flex items-center gap-1.5 text-[11px] font-bold transition-all active:scale-95 border border-[var(--border-active)] shadow-sm"
            >
              {copied ? <Check size={13} className="text-[var(--accent-green)]" /> : <Copy size={13} />}
              <span>{copied ? 'Tersalin!' : 'Copy'}</span>
            </button>

            <button
              type="button"
              aria-label="Tutup drawer ekspor kode"
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-[var(--hover-bg)] text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Format Selector Tabs */}
        <div className="px-4 py-2.5 border-b border-[var(--border)] bg-[var(--surface-2)]/50 flex items-center gap-1.5 shrink-0">
          {(['cpp', 'python', 'json'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setExportTab(tab)}
              className={`px-3 py-1 rounded-md text-[11px] font-bold transition-all ${
                exportTab === tab
                  ? 'bg-[var(--accent-cyan)] text-white shadow-md'
                  : 'bg-[var(--surface-2)] text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--hover-bg)]'
              }`}
            >
              {tab === 'cpp' ? 'C++ / Arduino' : tab === 'python' ? 'Python' : 'JSON Schema'}
            </button>
          ))}
        </div>

        {/* Code Preview Body (Scrollable) */}
        <div className="flex-1 p-4 overflow-y-auto custom-scrollbar bg-[var(--bg)]">
          <pre className="p-3.5 rounded-xl bg-[var(--surface)] text-[10px] text-[var(--text)] overflow-x-auto leading-relaxed border border-[var(--border)] font-mono shadow-inner">
            {exportTab === 'cpp' ? snippets.cpp : exportTab === 'python' ? snippets.python : snippets.json}
          </pre>
        </div>

        {/* Footer info */}
        <div className="p-3 border-t border-[var(--border)] bg-[var(--surface-2)] text-[10px] text-[var(--text-muted)] flex items-center justify-between shrink-0">
          <span>Target SP: {setpoint.toFixed(2)}</span>
          <span>Esc untuk menutup</span>
        </div>
      </div>
    </div>
  );

  return createPortal(drawerContent, document.body);
});
