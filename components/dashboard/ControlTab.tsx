// ============================================================================
// ControlTab — Main Control Panel (Presets, Setpoint, PID Gains, Live Bars)
// ============================================================================

'use client';

import React, { useMemo } from 'react';
import { Sparkles, Target, Sliders, Settings } from 'lucide-react';
import { GainControl } from './GainControl';
import { PIDConfig, PIDGains, PlantParameters, TuningRecommendation } from '@/types/simulation';
import { RobotDefinition } from '@/types/robots';
import { DiagnosticCard } from './DiagnosticCard';

interface ControlTabProps {
  selectedRobot: RobotDefinition;
  setpoint: number;
  onSetSetpoint: (sp: number) => void;
  pidConfig: PIDConfig;
  onSetPIDGains: (gains: Partial<PIDGains>) => void;
  pTerm: number;
  iTerm: number;
  dTerm: number;
  plant: PlantParameters;
  onSetPlant: (params: Partial<PlantParameters>) => void;
  onApplyPreset: (type: 'stable' | 'aggressive' | 'oscillating') => void;
  recommendations?: TuningRecommendation[];
}

// ---------------------------------------------------------------------------
// Center-Zero Bipolar Gauge: Industrial Precision Meter (BUG-03 Redesign)
// ---------------------------------------------------------------------------
function PIDTermBar({
  label,
  value,
  scale,
  color,
  unit,
}: {
  label: string;
  value: number;
  scale: number;
  color: string;
  unit: string;
}) {
  // Center-Zero layout: 0.00 is at exactly 50% width
  const safeScale = scale > 0 ? scale : 1;
  const pct = Math.min((Math.abs(value) / safeScale) * 50, 50);
  const isPos = value > 0;
  const isNeg = value < 0;
  const formattedVal = `${value > 0 ? '+' : value < 0 ? '-' : ' '}${Math.abs(value).toFixed(2)}`;

  return (
    <div className="flex items-center gap-2 font-mono text-[10px]">
      {/* Term Label */}
      <span className="w-3.5 font-bold shrink-0 text-center" style={{ color }}>
        {label}
      </span>

      {/* Center-Zero Bipolar Track */}
      <div className="flex-1 h-3 rounded bg-slate-950/70 border border-slate-800/90 relative overflow-hidden flex items-center">
        {/* Subtle grid background markings */}
        <div className="absolute inset-0 flex justify-between px-1.5 pointer-events-none opacity-20 text-[7px] text-slate-400 font-mono select-none">
          <span>-</span>
          <span className="text-[6.5px]">0.0</span>
          <span>+</span>
        </div>

        {/* Center Vertical Divider (0.00 neutral baseline) */}
        <div className="absolute left-1/2 top-0 bottom-0 w-[1px] bg-slate-600/90 border-r border-slate-700 z-10 -translate-x-1/2" />

        {/* Positive Bar (Grows from center 50% to RIGHT) */}
        {isPos && (
          <div
            className="h-full rounded-r transition-all duration-75 relative z-5"
            style={{
              left: '50%',
              width: `${pct}%`,
              backgroundColor: color,
            }}
          />
        )}

        {/* Negative Bar (Grows from center 50% to LEFT) */}
        {isNeg && (
          <div
            className="h-full rounded-l transition-all duration-75 relative z-5"
            style={{
              left: `${50 - pct}%`,
              width: `${pct}%`,
              backgroundColor: color,
            }}
          />
        )}
      </div>

      {/* Numerical Value with Explicit Sign and Monospace Spacing */}
      <div className="w-20 text-right tabular-nums font-mono shrink-0">
        <span
          className="font-bold"
          style={{ color: Math.abs(value) > 1e-4 ? color : 'var(--text-muted)' }}
        >
          {formattedVal}
        </span>
        <span className="text-[9px] text-[var(--text-muted)] ml-1 font-normal">{unit}</span>
      </div>
    </div>
  );
}

export const ControlTab = React.memo(function ControlTab({
  selectedRobot,
  setpoint,
  onSetSetpoint,
  pidConfig,
  onSetPIDGains,
  pTerm,
  iTerm,
  dTerm,
  plant,
  onSetPlant,
  onApplyPreset,
  recommendations,
}: ControlTabProps) {
  // Symmetric dynamic scale based on actuator limits and live deviations [-Umax, +Umax]
  const controlScale = useMemo(() => {
    const limits = plant.actuatorLimits || [-20, 20];
    const maxBound = Math.max(Math.abs(limits[0]), Math.abs(limits[1]));
    const maxDev = Math.max(Math.abs(pTerm), Math.abs(iTerm), Math.abs(dTerm));
    return Math.max(maxBound, maxDev, 1.0);
  }, [plant.actuatorLimits, pTerm, iTerm, dTerm]);

  return (
    <div
      role="tabpanel"
      id="tabpanel-control"
      data-tab-content="control"
      aria-labelledby="tab-control"
      className="p-3 space-y-3 font-mono"
    >
      {/* ── 1-Click Zero-Math Presets ── */}
      <div>
        <div className="flex items-center gap-1.5 mb-1.5">
          <Sparkles size={12} className="text-amber-400" />
          <span className="text-[10px] font-bold uppercase tracking-wider opacity-70">
            Preset Praktis (1-Klik)
          </span>
        </div>

        <div className="grid grid-cols-3 gap-1.5 text-center">
          <button
            type="button"
            onClick={() => onApplyPreset('stable')}
            className="p-2 rounded-lg bg-[var(--accent-green-bg)] hover:brightness-110 border border-[var(--accent-green)]/30 transition-all flex flex-col items-center gap-0.5 group active:scale-95"
            title="Tuning redaman kritis untuk respon mulus tanpa goyang"
          >
            <span className="text-sm">🟢</span>
            <span className="text-[10px] font-bold text-[var(--accent-green)]">
              Stabil Mulus
            </span>
          </button>

          <button
            type="button"
            onClick={() => onApplyPreset('aggressive')}
            className="p-2 rounded-lg bg-[var(--accent-cyan-bg)] hover:brightness-110 border border-[var(--accent-cyan)]/30 transition-all flex flex-col items-center gap-0.5 group active:scale-95"
            title="Tuning agresif untuk tarikan cepat ke target"
          >
            <span className="text-sm">⚡</span>
            <span className="text-[10px] font-bold text-[var(--accent-cyan)]">
              Respon Cepat
            </span>
          </button>

          <button
            type="button"
            onClick={() => onApplyPreset('oscillating')}
            className="p-2 rounded-lg bg-[var(--accent-amber-bg)] hover:brightness-110 border border-[var(--accent-amber)]/30 transition-all flex flex-col items-center gap-0.5 group active:scale-95"
            title="Tuning kurang teredam untuk demo fenomena osilasi"
          >
            <span className="text-sm">🟡</span>
            <span className="text-[10px] font-bold text-[var(--accent-amber)]">
              Osilasi Demo
            </span>
          </button>
        </div>
      </div>

      {/* ── Setpoint Target Slider ── */}
      <div>
        <div className="flex items-center gap-1.5 mb-1.5">
          <Target size={12} className="text-[var(--accent-amber)]" />
          <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
            Target Posisi (Setpoint)
          </span>
        </div>
        <GainControl
          label={selectedRobot.outputVariable}
          name="Nilai Acuan"
          value={setpoint}
          onChange={onSetSetpoint}
          min={selectedRobot.setpointRange[0]}
          max={selectedRobot.setpointRange[1]}
          step={0.1}
          unit={selectedRobot.outputUnit}
          color="var(--accent-amber)"
          description="Nilai acuan tujuan (setpoint) yang harus dicapai dan dipertahankan oleh robot."
          defaultValue={selectedRobot.defaultSetpoint}
        />
      </div>

      {/* ── PID Gains with Reusable GainControl ── */}
      <div className="space-y-2">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-1.5">
            <Sliders size={12} className="text-[var(--accent-cyan)]" />
            <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
              Gain Pengendali PID
            </span>
          </div>
          {/* BUG-03 Fix: Informative chip for Setpoint Weighting (b) */}
          <div
            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono bg-[var(--input-bg)] border border-[var(--border)] text-[var(--text-muted)] cursor-help"
            title="Bobot Setpoint (b): Mengurangi lonjakan awal saat step-change."
          >
            <span className="text-[9px] opacity-70">b:</span>
            <span className="font-bold text-[var(--accent-cyan)]">
              {(pidConfig.setpointWeight ?? 1.0).toFixed(2)}
            </span>
          </div>
        </div>

        <GainControl
          label="Kp"
          name="Proportional"
          value={pidConfig.Kp}
          onChange={(v) => onSetPIDGains({ Kp: v, setpointWeight: 1.0 })}
          min={0}
          max={50}
          step={0.01}
          color="var(--accent-cyan)"
          description="Kekuatan tarikan utama ke target posisi sebanding dengan besar error saat ini."
          defaultValue={2.0}
        />

        <GainControl
          label="Ki"
          name="Integral"
          value={pidConfig.Ki}
          onChange={(v) => onSetPIDGains({ Ki: v, setpointWeight: 1.0 })}
          min={0}
          max={20}
          step={0.01}
          color="var(--accent-purple)"
          description="Akumulasi koreksi kesalahan sisa (steady-state error) untuk menjamin error tepat nol."
          defaultValue={0.5}
        />

        <GainControl
          label="Kd"
          name="Derivative"
          value={pidConfig.Kd}
          onChange={(v) => onSetPIDGains({ Kd: v, setpointWeight: 1.0 })}
          min={0}
          max={10}
          step={0.001}
          color="var(--accent-green)"
          description="Gaya rem peredam laju perubahan error agar gerakan tidak kebablasan (overshoot)."
          defaultValue={0.3}
        />
      </div>

      {/* ── Live Term Distribution Bars (Center-Zero Bipolar Precision Gauge) ── */}
      <div className="space-y-1.5 pt-2 border-t border-[var(--border-subtle)]">
        <div className="flex items-center justify-between text-[9px] text-[var(--text-muted)] font-mono">
          <span className="uppercase tracking-wider font-bold">
            Distribusi Gaya Kontrol Live
          </span>
          <span className="opacity-70">
            Skala: ±{controlScale.toFixed(1)} {selectedRobot.controlUnit}
          </span>
        </div>
        <PIDTermBar
          label="P"
          value={pTerm}
          scale={controlScale}
          color="#06B6D4"
          unit={selectedRobot.controlUnit}
        />
        <PIDTermBar
          label="I"
          value={iTerm}
          scale={controlScale}
          color="#A855F7"
          unit={selectedRobot.controlUnit}
        />
        <PIDTermBar
          label="D"
          value={dTerm}
          scale={controlScale}
          color="#10B981"
          unit={selectedRobot.controlUnit}
        />
      </div>

      {/* ── Diagnostic Quick Alerts (1-Click Correction) ── */}
      {recommendations && recommendations.length > 0 && (
        <div className="space-y-1.5 pt-2 border-t border-[var(--border-subtle)]">
          <p className="text-[9px] text-[var(--accent-amber)] uppercase tracking-wider font-bold">
            Peringatan Diagnostik Sistem
          </p>
          {recommendations.map((rec, i) => (
            <DiagnosticCard
              key={i}
              recommendation={rec}
              onApplyGains={onSetPIDGains}
              currentGains={pidConfig}
            />
          ))}
        </div>
      )}

      {/* ── Custom Plant Parameter Override (Shown only for custom_plant) ── */}
      {selectedRobot.id === 'custom_plant' && (
        <div className="space-y-2 pt-2 border-t border-[var(--border)]">
          <div className="flex items-center gap-1.5 mb-1">
            <Settings size={12} className="text-[var(--accent-amber)]" />
            <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
              Parameter Transfer Function
            </span>
          </div>
          <GainControl
            label="K"
            name="Static Gain"
            value={plant.gain}
            onChange={(v) => onSetPlant({ gain: v })}
            min={0.01}
            max={10}
            step={0.01}
            color="var(--accent-amber)"
            description="Penguatan statis plant (gain rasio output/input tunak)."
            defaultValue={1.0}
          />
          <GainControl
            label="τ"
            name="Time Constant"
            value={plant.timeConstant}
            onChange={(v) => onSetPlant({ timeConstant: v })}
            min={0.01}
            max={5}
            step={0.01}
            unit="s"
            color="var(--accent-cyan)"
            description="Konstanta waktu inersia respon plant."
            defaultValue={0.3}
          />
          <GainControl
            label="ζ"
            name="Damping Ratio"
            value={plant.dampingRatio}
            onChange={(v) => onSetPlant({ dampingRatio: v })}
            min={0}
            max={2}
            step={0.01}
            color="var(--accent-purple)"
            description="Rasio redaman osilasi alami orde-2."
            defaultValue={0.7}
          />
        </div>
      )}
    </div>
  );
});
