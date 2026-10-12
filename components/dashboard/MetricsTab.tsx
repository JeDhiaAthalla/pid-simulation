// ============================================================================
// MetricsTab — Transient Response Telemetry & Diagnostic Health Center
// ============================================================================

'use client';

import React from 'react';
import {
  TrendingUp,
  Activity,
  Timer,
  Crosshair,
  Waves,
  AlertTriangle,
  CheckCircle2,
  Info,
  ArrowRight,
  BarChart3,
} from 'lucide-react';
import { StepResponseMetrics, TuningRecommendation, PIDGains } from '@/types/simulation';

interface MetricsTabProps {
  metrics: StepResponseMetrics;
  recommendations: TuningRecommendation[];
  onApplyGains: (gains: Partial<PIDGains>) => void;
  simTime: number;
  isRunning: boolean;
}

// Reusable Metric Card with Memoization to prevent unnecessary renders
const MetricCard = React.memo(function MetricCard({
  label,
  value,
  unit,
  icon: Icon,
  color,
  hasData,
  tooltip,
}: {
  label: string;
  value: string | number | null;
  unit?: string;
  icon: React.ElementType;
  color?: string;
  hasData: boolean;
  tooltip?: string;
}) {
  return (
    <div
      title={tooltip}
      className="p-2.5 rounded-lg flex items-center gap-2.5 bg-[var(--input-bg)]/50 border border-[var(--border)] hover:border-white/20 transition-all"
    >
      <div
        className="p-1.5 rounded-md flex-shrink-0"
        style={{ backgroundColor: `${color || 'var(--accent)'}18` }}
      >
        <Icon size={14} style={{ color: color || 'var(--accent)' }} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[9px] font-mono text-[var(--text-muted)] font-semibold uppercase tracking-wider">{label}</p>
        <p
          className="text-xs font-mono font-bold truncate"
          style={{ color: hasData && color ? color : 'inherit' }}
        >
          {hasData && value !== null && value !== undefined ? `${value} ${unit || ''}` : '—'}
        </p>
      </div>
    </div>
  );
});

export const MetricsTab = React.memo(function MetricsTab({
  metrics,
  recommendations,
  onApplyGains,
  simTime,
  isRunning,
}: MetricsTabProps) {
  // Determine if simulation has produced valid metric data yet
  const hasData =
    metrics.riseTime !== null ||
    metrics.peakOvershoot !== null ||
    metrics.settlingTime !== null ||
    (metrics.steadyStateError !== null && simTime > 0.1);

  const isStepValid = metrics.isStepValid !== false;
  const noStepTooltip = 'Tidak ada step (setpoint tidak berubah)';

  // Settling time format: finite number or "∞ / unsettled"
  const settlingTimeStr =
    metrics.settlingTime !== null
      ? Number.isFinite(metrics.settlingTime)
        ? metrics.settlingTime.toFixed(3)
        : '∞ / unsettled'
      : null;

  const settlingUnit =
    metrics.settlingTime !== null && Number.isFinite(metrics.settlingTime) ? 's' : '';

  // Damping badge styling
  const getDampingBadgeStyle = () => {
    switch (metrics.dampingAssessment) {
      case 'unstable':
        return 'bg-[var(--accent-red-bg)] text-[var(--accent-red)] border-[var(--accent-red)]/30';
      case 'underdamped':
        return 'bg-[var(--accent-amber-bg)] text-[var(--accent-amber)] border-[var(--accent-amber)]/30';
      case 'critically_damped':
        return 'bg-[var(--accent-green-bg)] text-[var(--accent-green)] border-[var(--accent-green)]/30';
      default:
        return 'bg-[var(--surface-2)] text-[var(--text-muted)] border-[var(--border)]';
    }
  };

  // Track C2: Filter rekomendasi (kartu rekomendasi tidak boleh kritis "Excessive Overshoot" bila data belum cukup atau Mp > 500%)
  const filteredRecommendations = recommendations.filter((rec) => {
    if (!hasData) {
      // Don't show well-tuned / info cards when there is no simulation data yet
      return rec.severity === 'critical' || rec.severity === 'warning';
    }
    if (rec.title.includes('Excessive Overshoot') && (!isStepValid || metrics.peakOvershoot === null || metrics.peakOvershoot > 500)) {
      return false;
    }
    return true;
  });

  return (
    <div
      role="tabpanel"
      id="tabpanel-metrics"
      data-tab-content="metrics"
      aria-labelledby="tab-metrics"
      className="p-3 space-y-3 font-mono"
    >
      {/* Header Info */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <BarChart3 size={13} className="text-[var(--accent-cyan)]" />
          <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
            Metrik Respon Transien
          </span>
        </div>
        <span
          className={`text-[9px] px-1.5 py-0.5 rounded ${
            isRunning ? 'text-[var(--accent-green)] bg-[var(--accent-green-bg)]' : 'text-[var(--text-muted)] bg-[var(--surface-2)]'
          }`}
        >
          {isRunning ? '● Real-Time' : '○ Standby'}
        </span>
      </div>

      {/* Empty State Banner if no data */}
      {!hasData && (
        <div className="p-2.5 rounded-lg bg-[var(--accent-cyan-bg)] border border-[var(--accent-cyan)]/20 text-[10px] text-[var(--accent-cyan)] flex items-center gap-2">
          <Info size={13} className="flex-shrink-0 text-[var(--accent-cyan)]" />
          <span>Jalankan simulasi untuk melihat metrik respon transien live.</span>
        </div>
      )}

      {/* 2x2 Metric Cards Grid */}
      <div className="grid grid-cols-2 gap-2">
        <MetricCard
          label="Rise Time (Tr)"
          value={isStepValid && metrics.riseTime !== null ? metrics.riseTime.toFixed(3) : null}
          unit={isStepValid ? 's' : ''}
          icon={TrendingUp}
          color="var(--accent-cyan)"
          hasData={hasData && isStepValid}
          tooltip={!isStepValid ? noStepTooltip : undefined}
        />
        <MetricCard
          label="Overshoot (Mp)"
          value={isStepValid && metrics.peakOvershoot !== null ? metrics.peakOvershoot.toFixed(1) : null}
          unit={isStepValid ? '%' : ''}
          icon={Activity}
          color={
            metrics.peakOvershoot !== null && metrics.peakOvershoot > 25 ? 'var(--accent-red)' : 'var(--accent-green)'
          }
          hasData={hasData && isStepValid}
          tooltip={!isStepValid ? noStepTooltip : undefined}
        />
        <MetricCard
          label="Settling Time (Ts)"
          value={settlingTimeStr}
          unit={settlingUnit}
          icon={Timer}
          color="var(--accent-purple)"
          hasData={hasData}
        />
        <MetricCard
          label="SS Error (Ess)"
          value={metrics.steadyStateError !== null ? metrics.steadyStateError.toFixed(4) : null}
          icon={Crosshair}
          color={
            metrics.steadyStateError !== null && Math.abs(metrics.steadyStateError) > 0.1
              ? 'var(--accent-amber)'
              : 'var(--accent-green)'
          }
          hasData={hasData}
        />
      </div>

      {/* Damping Assessment & Oscillation Frequency Banner */}
      <div className="p-2 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] flex items-center justify-between text-xs">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-[var(--text-muted)]">Damping:</span>
          <span
            className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider border ${getDampingBadgeStyle()}`}
          >
            {hasData ? metrics.dampingAssessment.replace(/_/g, ' ') : 'STANDBY'}
          </span>
        </div>

        {metrics.oscillationFrequency !== null && hasData && (
          <span className="text-[10px] text-[var(--accent-amber)] opacity-90 flex items-center gap-1">
            <Waves size={11} />
            {metrics.oscillationFrequency.toFixed(1)} Hz
          </span>
        )}
      </div>

      {/* Diagnostic Summary Section */}
      <div className="pt-2 border-t border-[var(--border)] space-y-2">
        <div className="flex items-center gap-1.5">
          <Info size={12} className="text-amber-400" />
          <span className="text-[10px] font-bold uppercase tracking-wider opacity-70">
            Diagnostik Sistem
          </span>
        </div>

        {filteredRecommendations.length > 0 ? (
          <div className="space-y-1.5">
            {filteredRecommendations.map((rec, i) => {
              const isCrit = rec.severity === 'critical';
              const isWarn = rec.severity === 'warning';
              const Icon = isCrit ? AlertTriangle : isWarn ? AlertTriangle : CheckCircle2;
              const color = isCrit ? '#EF4444' : isWarn ? '#F59E0B' : '#10B981';

              return (
                <div
                  key={i}
                  className="p-2.5 rounded-lg border text-xs transition-colors"
                  style={{ borderColor: `${color}35`, backgroundColor: `${color}0C` }}
                >
                  <div className="flex items-start gap-2">
                    <Icon size={14} style={{ color, flexShrink: 0, marginTop: 1 }} />
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-[11px]" style={{ color }}>
                        {rec.title}
                      </p>
                      <p className="text-[10px] opacity-75 mt-0.5 leading-relaxed">
                        {rec.message}
                      </p>
                      {rec.suggestedGains && (
                        <button
                          type="button"
                          onClick={() => {
                            if (rec.suggestedGains) {
                              onApplyGains(rec.suggestedGains);
                            }
                          }}
                          className="mt-1.5 px-2 py-0.5 rounded text-[10px] font-bold transition-all flex items-center gap-1 active:scale-95"
                          style={{
                            backgroundColor: `${color}20`,
                            color,
                            border: `1px solid ${color}40`,
                          }}
                        >
                          Terapkan Koreksi <ArrowRight size={10} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="p-2.5 rounded-lg bg-white/5 border border-white/5 text-[10px] opacity-60 text-center">
            {hasData
              ? 'Sistem merespons dengan normal, belum terdeteksi anomali kritis.'
              : 'Menunggu data simulasi untuk evaluasi diagnostik.'}
          </div>
        )}
      </div>
    </div>
  );
});
