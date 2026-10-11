// ============================================================================
// ControlTab — Main Control Panel (Presets, Setpoint, PID Gains, Live Bars)
// ============================================================================

'use client';

import React, { useMemo } from 'react';
import { Sparkles, Target, Sliders, Settings } from 'lucide-react';
import { GainControl } from './GainControl';
import { PIDConfig, PIDGains, PlantParameters } from '@/types/simulation';
import { RobotDefinition } from '@/types/robots';

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
}

function PIDTermBar({
  label,
  value,
  max,
  color,
}: {
  label: string;
  value: number;
  max: number;
  color: string;
}) {
  const pct = max > 0 ? Math.min((Math.abs(value) / max) * 100, 100) : 0;
  const isNeg = value < 0;

  return (
    <div className="flex items-center gap-2 font-mono">
      <span className="text-[10px] w-4 font-bold" style={{ color }}>
        {label}
      </span>
      <div className="flex-1 h-1.5 rounded-full overflow-hidden bg-white/5">
        <div
          className="h-full rounded-full transition-all duration-75"
          style={{
            width: `${pct}%`,
            backgroundColor: color,
            marginLeft: isNeg ? 'auto' : undefined,
          }}
        />
      </div>
      <span className="text-[10px] w-14 text-right" style={{ color }}>
        {value.toFixed(3)}
      </span>
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
}: ControlTabProps) {
  const maxTerm = useMemo(() => {
    return Math.max(Math.abs(pTerm), Math.abs(iTerm), Math.abs(dTerm), 0.001);
  }, [pTerm, iTerm, dTerm]);

  return (
    <div
      role="tabpanel"
      id="tabpanel-control"
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
            className="p-2 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 transition-all flex flex-col items-center gap-0.5 group active:scale-95"
            title="Tuning redaman kritis untuk respon mulus tanpa goyang"
          >
            <span className="text-sm">🟢</span>
            <span className="text-[10px] font-bold text-emerald-400 group-hover:text-emerald-300">
              Stabil Mulus
            </span>
          </button>

          <button
            type="button"
            onClick={() => onApplyPreset('aggressive')}
            className="p-2 rounded-lg bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/30 transition-all flex flex-col items-center gap-0.5 group active:scale-95"
            title="Tuning agresif untuk tarikan cepat ke target"
          >
            <span className="text-sm">⚡</span>
            <span className="text-[10px] font-bold text-cyan-400 group-hover:text-cyan-300">
              Respon Cepat
            </span>
          </button>

          <button
            type="button"
            onClick={() => onApplyPreset('oscillating')}
            className="p-2 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 transition-all flex flex-col items-center gap-0.5 group active:scale-95"
            title="Tuning kurang teredam untuk demo fenomena osilasi"
          >
            <span className="text-sm">🟡</span>
            <span className="text-[10px] font-bold text-amber-400 group-hover:text-amber-300">
              Osilasi Demo
            </span>
          </button>
        </div>
      </div>

      {/* ── Setpoint Target Slider ── */}
      <div>
        <div className="flex items-center gap-1.5 mb-1.5">
          <Target size={12} className="text-amber-400" />
          <span className="text-[10px] font-bold uppercase tracking-wider opacity-70">
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
          color="#FBBF24"
          description="Nilai acuan tujuan (setpoint) yang harus dicapai dan dipertahankan oleh robot."
          defaultValue={selectedRobot.defaultSetpoint}
        />
      </div>

      {/* ── PID Gains with Reusable GainControl ── */}
      <div className="space-y-2">
        <div className="flex items-center gap-1.5 mb-1">
          <Sliders size={12} className="text-cyan-400" />
          <span className="text-[10px] font-bold uppercase tracking-wider opacity-70">
            Gain Pengendali PID
          </span>
        </div>

        <GainControl
          label="Kp"
          name="Proportional"
          value={pidConfig.Kp}
          onChange={(v) => onSetPIDGains({ Kp: v })}
          min={0}
          max={50}
          step={0.01}
          color="#06B6D4"
          description="Kekuatan tarikan utama ke target posisi sebanding dengan besar error saat ini."
          defaultValue={2.0}
        />

        <GainControl
          label="Ki"
          name="Integral"
          value={pidConfig.Ki}
          onChange={(v) => onSetPIDGains({ Ki: v })}
          min={0}
          max={20}
          step={0.01}
          color="#A78BFA"
          description="Akumulasi koreksi kesalahan sisa (steady-state error) untuk menjamin error tepat nol."
          defaultValue={0.5}
        />

        <GainControl
          label="Kd"
          name="Derivative"
          value={pidConfig.Kd}
          onChange={(v) => onSetPIDGains({ Kd: v })}
          min={0}
          max={10}
          step={0.001}
          color="#10B981"
          description="Gaya rem peredam laju perubahan error agar gerakan tidak kebablasan (overshoot)."
          defaultValue={0.3}
        />
      </div>

      {/* ── Live Term Distribution Bars ── */}
      <div className="space-y-1.5 pt-2 border-t border-white/5">
        <p className="text-[9px] opacity-50 uppercase tracking-wider">
          Distribusi Gaya Kontrol Live
        </p>
        <PIDTermBar label="P" value={pTerm} max={maxTerm} color="#06B6D4" />
        <PIDTermBar label="I" value={iTerm} max={maxTerm} color="#A78BFA" />
        <PIDTermBar label="D" value={dTerm} max={maxTerm} color="#10B981" />
      </div>

      {/* ── Custom Plant Parameter Override (Shown only for custom_plant) ── */}
      {selectedRobot.id === 'custom_plant' && (
        <div className="space-y-2 pt-2 border-t border-white/10">
          <div className="flex items-center gap-1.5 mb-1">
            <Settings size={12} className="text-amber-400" />
            <span className="text-[10px] font-bold uppercase tracking-wider opacity-70">
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
            color="#FBBF24"
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
            color="#06B6D4"
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
            color="#A78BFA"
            description="Rasio redaman osilasi alami orde-2."
            defaultValue={0.7}
          />
        </div>
      )}
    </div>
  );
});
