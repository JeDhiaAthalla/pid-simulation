// ============================================================================
// MiniMetricsBar — Compact Sticky Telemetry Strip (Tr | %OS | Ts | Ess)
// Track A3 Specification:
// - 4-column grid layout with horizontal padding
// - Labels do not stick to edges
// - Tabular numbers (tabular-nums font-mono)
// - Overshoot > 999 displayed as ">999%"
// ============================================================================

'use client';

import React from 'react';
import { StepResponseMetrics } from '@/types/simulation';

interface MiniMetricsBarProps {
  metrics: StepResponseMetrics;
}

export const MiniMetricsBar = React.memo(function MiniMetricsBar({
  metrics,
}: MiniMetricsBarProps) {
  const isStepValid = metrics.isStepValid !== false;
  const noStepTooltip = 'Tidak ada step (setpoint tidak berubah)';

  const trTooltip = isStepValid ? 'Rise Time (10% → 90%)' : noStepTooltip;
  const trStr = isStepValid && metrics.riseTime !== null ? `${metrics.riseTime.toFixed(2)}s` : '—';

  const formatOvershoot = (val: number | null): string => {
    if (!isStepValid || val === null) return '—';
    if (val > 999) return '>999%';
    return `${val.toFixed(1)}%`;
  };
  const osStr = formatOvershoot(metrics.peakOvershoot);
  const osTooltip = isStepValid ? 'Peak Overshoot (%OS)' : noStepTooltip;

  const tsStr =
    metrics.settlingTime !== null
      ? Number.isFinite(metrics.settlingTime)
        ? `${metrics.settlingTime.toFixed(2)}s`
        : '∞'
      : '—';

  const essStr =
    metrics.steadyStateError !== null
      ? metrics.steadyStateError.toFixed(3)
      : '—';

  const osColor =
    !isStepValid || metrics.peakOvershoot === null
      ? 'text-[var(--text-muted)]'
      : metrics.peakOvershoot > 25
      ? 'text-[var(--accent-red)]'
      : metrics.peakOvershoot <= 10
      ? 'text-[var(--accent-green)]'
      : 'text-[var(--accent-amber)]';

  return (
    <div className="px-3 py-1.5 border-b border-[var(--border)] bg-[var(--surface-2)]/60 grid grid-cols-4 gap-1 text-[10px] font-mono select-none">
      {/* Col 1: Tr */}
      <div
        className="flex items-center justify-center gap-1 min-w-0 px-1 border-r border-[var(--border-subtle)] last:border-r-0"
        title={trTooltip}
      >
        <span className="text-[var(--text-muted)] font-bold shrink-0">Tr:</span>
        <span className="font-bold text-[var(--accent-cyan)] tabular-nums truncate">{trStr}</span>
      </div>

      {/* Col 2: %OS */}
      <div
        className="flex items-center justify-center gap-1 min-w-0 px-1 border-r border-[var(--border-subtle)] last:border-r-0"
        title={osTooltip}
      >
        <span className="text-[var(--text-muted)] font-bold shrink-0">%OS:</span>
        <span className={`font-bold ${osColor} tabular-nums truncate`}>{osStr}</span>
      </div>

      {/* Col 3: Ts */}
      <div
        className="flex items-center justify-center gap-1 min-w-0 px-1 border-r border-[var(--border-subtle)] last:border-r-0"
        title="Settling Time (2% band)"
      >
        <span className="text-[var(--text-muted)] font-bold shrink-0">Ts:</span>
        <span className="font-bold text-[var(--accent-purple)] tabular-nums truncate">{tsStr}</span>
      </div>

      {/* Col 4: Ess */}
      <div
        className="flex items-center justify-center gap-1 min-w-0 px-1"
        title="Steady-State Error (|e_ss|)"
      >
        <span className="text-[var(--text-muted)] font-bold shrink-0">Ess:</span>
        <span className="font-bold text-[var(--accent-green)] tabular-nums truncate">{essStr}</span>
      </div>
    </div>
  );
});
