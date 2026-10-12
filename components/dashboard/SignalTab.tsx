// ============================================================================
// SignalTab — Filter Sinyal, Noise & Delay Transport Hub
// ============================================================================

'use client';

import React from 'react';
import { Waves, Cpu, ShieldAlert, Timer } from 'lucide-react';
import { PIDConfig, PlantParameters } from '@/types/simulation';

interface SignalTabProps {
  pidConfig: PIDConfig;
  onSetPIDConfig: (config: Partial<PIDConfig>) => void;
  plant: PlantParameters;
  onSetPlant: (params: Partial<PlantParameters>) => void;
  noiseEnabled: boolean;
  onToggleNoise: (enabled: boolean) => void;
  noiseSigma: number;
  onChangeNoiseSigma: (sigma: number) => void;
}

export const SignalTab = React.memo(function SignalTab({
  pidConfig,
  onSetPIDConfig,
  plant,
  onSetPlant,
  noiseEnabled,
  onToggleNoise,
  noiseSigma,
  onChangeNoiseSigma,
}: SignalTabProps) {
  return (
    <div
      role="tabpanel"
      id="tabpanel-signal"
      data-tab-content="signal"
      aria-labelledby="tab-signal"
      className="p-3 space-y-3.5 font-mono"
    >
      {/* ── Section 1: Sensor Noise (Gaussian) ── */}
      <div className="p-2.5 rounded-lg bg-[var(--input-bg)]/50 border border-[var(--border)] space-y-2">
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={noiseEnabled}
              onChange={(e) => onToggleNoise(e.target.checked)}
              className="rounded border-[var(--border)] text-[var(--accent-amber)] focus:ring-0 focus:ring-offset-0 cursor-pointer"
            />
            <span className="font-bold text-xs text-[var(--accent-amber)] flex items-center gap-1.5">
              <Waves size={13} /> Sensor Noise (Gaussian)
            </span>
          </label>
          <span className="text-[10px] font-bold text-[var(--accent-amber)] bg-[var(--accent-amber-bg)] px-1.5 py-0.5 rounded border border-[var(--accent-amber)]/30">
            {noiseEnabled ? `σ = ${noiseSigma.toFixed(2)}` : 'OFF'}
          </span>
        </div>

        <p className="text-[9px] text-[var(--text-muted)] leading-tight">
          Menambahkan derau acak Gaussian Box-Muller pada sensor Process Variable untuk menguji
          ketahanan filter turunan.
        </p>

        {noiseEnabled && (
          <div className="pt-1 space-y-1">
            <div className="flex justify-between text-[10px]">
              <span className="text-[var(--text-muted)]">Intensitas Derau (σ):</span>
              <span className="font-bold text-[var(--accent-amber)]">{noiseSigma.toFixed(2)}</span>
            </div>
            <input
              type="range"
              min={0.01}
              max={0.5}
              step={0.01}
              value={noiseSigma}
              onChange={(e) => onChangeNoiseSigma(parseFloat(e.target.value))}
              className="slider-input w-full h-1.5 rounded-full appearance-none cursor-pointer"
              style={{
                background: `linear-gradient(to right, var(--accent-amber) ${
                  ((noiseSigma - 0.01) / (0.5 - 0.01)) * 100
                }%, var(--slider-track) ${((noiseSigma - 0.01) / (0.5 - 0.01)) * 100}%)`,
              }}
            />
          </div>
        )}
      </div>

      {/* ── Section 2: Transport Latency / Dead-Time (L) ── */}
      <div className="p-2.5 rounded-lg bg-[var(--input-bg)]/50 border border-[var(--border)] space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Timer size={13} className="text-[var(--accent-cyan)]" />
            <span className="text-xs font-bold text-[var(--text)]">Dead-Time / Delay Transport (L)</span>
          </div>
          <span className="text-[10px] font-bold text-[var(--accent-cyan)] bg-[var(--accent-cyan-bg)] px-1.5 py-0.5 rounded border border-[var(--accent-cyan)]/30">
            {plant.deadTime.toFixed(3)}s
          </span>
        </div>

        <p className="text-[9px] text-[var(--text-muted)] leading-tight">
          Penundaan transmisi sinyal aktuator ke respon plant fisik (fase lag penurun batas kestabilan).
        </p>

        <div className="pt-1 space-y-1">
          <div className="flex justify-between text-[10px]">
            <span className="text-[var(--text-muted)]">Delay Transport:</span>
            <span className="font-bold text-[var(--accent-cyan)]">{plant.deadTime.toFixed(2)} s</span>
          </div>
          <input
            type="range"
            min={0}
            max={1.0}
            step={0.01}
            value={plant.deadTime}
            onChange={(e) => onSetPlant({ deadTime: parseFloat(e.target.value) })}
            className="slider-input w-full h-1.5 rounded-full appearance-none cursor-pointer"
            style={{
              background: `linear-gradient(to right, var(--accent-cyan) ${
                (plant.deadTime / 1.0) * 100
              }%, var(--slider-track) ${(plant.deadTime / 1.0) * 100}%)`,
            }}
          />
        </div>
      </div>

      {/* ── Section 3: Derivative Filter N ── */}
      <div className="p-2.5 rounded-lg bg-[var(--input-bg)]/50 border border-[var(--border)] space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Cpu size={13} className="text-[var(--accent-cyan)]" />
            <span className="text-xs font-bold text-[var(--text)]">Filter Turunan (N)</span>
          </div>
          <span className="text-[10px] font-bold text-[var(--accent-cyan)] bg-[var(--accent-cyan-bg)] px-1.5 py-0.5 rounded border border-[var(--accent-cyan)]/30">
            N = {pidConfig.derivativeFilterN}
          </span>
        </div>

        <p className="text-[9px] text-[var(--text-muted)] leading-tight">
          Filter lolos-rendah (low-pass) orde 1 untuk meredam amplifikasi noise frekuensi tinggi pada
          komponen Derivative Kd.
        </p>

        <div className="pt-1 space-y-1">
          <div className="flex justify-between text-[10px]">
            <span className="text-[var(--text-muted)]">Koefisien N:</span>
            <span className="font-bold text-[var(--accent-cyan)]">{pidConfig.derivativeFilterN}</span>
          </div>
          <input
            type="range"
            min={1}
            max={100}
            step={1}
            value={pidConfig.derivativeFilterN}
            onChange={(e) => onSetPIDConfig({ derivativeFilterN: parseInt(e.target.value) })}
            className="slider-input w-full h-1.5 rounded-full appearance-none cursor-pointer"
            style={{
              background: `linear-gradient(to right, var(--accent-cyan) ${
                ((pidConfig.derivativeFilterN - 1) / (100 - 1)) * 100
              }%, var(--slider-track) ${
                ((pidConfig.derivativeFilterN - 1) / (100 - 1)) * 100
              }%)`,
            }}
          />
        </div>
      </div>

      {/* ── Section 4: Anti-Windup Back-Calculation (Kb) ── */}
      <div className="p-2.5 rounded-lg bg-[var(--input-bg)]/50 border border-[var(--border)] space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <ShieldAlert size={13} className="text-[var(--accent-purple)]" />
            <span className="text-xs font-bold text-[var(--text)]">Anti-Windup (Kb)</span>
          </div>
          <span className="text-[10px] font-bold text-[var(--accent-purple)] bg-[var(--accent-purple-bg)] px-1.5 py-0.5 rounded border border-[var(--accent-purple)]/30">
            Kb = {pidConfig.antiWindupKb.toFixed(2)}
          </span>
        </div>

        <p className="text-[9px] text-[var(--text-muted)] leading-tight">
          Kompensasi back-calculation saat aktuator mencapai saturasi untuk mencegah akumulasi integral
          berlebih (integral windup).
        </p>

        <div className="pt-1 space-y-1">
          <div className="flex justify-between text-[10px]">
            <span className="text-[var(--text-muted)]">Koefisien Kb:</span>
            <span className="font-bold text-[var(--accent-purple)]">{pidConfig.antiWindupKb.toFixed(2)}</span>
          </div>
          <input
            type="range"
            min={0}
            max={2}
            step={0.05}
            value={pidConfig.antiWindupKb}
            onChange={(e) => onSetPIDConfig({ antiWindupKb: parseFloat(e.target.value) })}
            className="slider-input w-full h-1.5 rounded-full appearance-none cursor-pointer"
            style={{
              background: `linear-gradient(to right, var(--accent-purple) ${
                (pidConfig.antiWindupKb / 2.0) * 100
              }%, var(--slider-track) ${(pidConfig.antiWindupKb / 2.0) * 100}%)`,
            }}
          />
        </div>
      </div>

      {/* ── Section 5: Derivative Mode (Derivative-on-Measurement) ── */}
      <div className="p-2.5 rounded-lg bg-[var(--input-bg)]/50 border border-[var(--border)]">
        <label className="flex items-start gap-2.5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={pidConfig.derivativeOnMeasurement}
            onChange={(e) => onSetPIDConfig({ derivativeOnMeasurement: e.target.checked })}
            className="mt-0.5 rounded border-[var(--border)] text-[var(--accent-cyan)] focus:ring-0 focus:ring-offset-0 cursor-pointer"
          />
          <div className="flex-1">
            <span className="text-xs font-bold text-[var(--text)] block">
              Derivative-on-Measurement
            </span>
            <span className="text-[9px] text-[var(--text-muted)] leading-relaxed block mt-0.5">
              Menghitung diferensial dari Process Variable daripada Error, efektif mencegah spike
              ekstrem (&quot;Derivative Kick&quot;) saat pergantian setpoint seketika.
            </span>
          </div>
        </label>
      </div>
    </div>
  );
});
