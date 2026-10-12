// ============================================================================
// TuningTab — Auto-Tuning Optimization & Method Synthesis Hub
// ============================================================================

'use client';

import React from 'react';
import {
  Wand2,
  ArrowRight,
  AlertTriangle,
  CheckCircle2,
  Sparkles,
  Info,
  Check,
} from 'lucide-react';
import { TuningResult, TuningRecommendation, PIDGains } from '@/types/simulation';

interface TuningTabProps {
  isAutoTuning: boolean;
  onRunAutoTune: () => void;
  tuningResults: TuningResult[];
  recommendations: TuningRecommendation[];
  currentGains: PIDGains;
  onApplyGains: (gains: PIDGains) => void;
}

const methodNames: Record<string, string> = {
  pole_placement: 'Pole Placement (Thrust)',
  ziegler_nichols: 'Ziegler-Nichols',
  cohen_coon: 'Cohen-Coon',
  itae_optimal: 'ITAE Optimal',
  numerical_optimization: 'Nelder-Mead Optimizer',
};

// Memoized Tuning Result Card
const TuningResultCard = React.memo(function TuningResultCard({
  result,
  currentGains,
  onApply,
}: {
  result: TuningResult;
  currentGains: PIDGains;
  onApply: () => void;
}) {
  const confidenceColor =
    result.confidence > 0.7 ? '#10B981' : result.confidence > 0.4 ? '#F59E0B' : '#EF4444';

  const isCurrent =
    Math.abs(result.gains.Kp - currentGains.Kp) < 0.005 &&
    Math.abs(result.gains.Ki - currentGains.Ki) < 0.005 &&
    Math.abs(result.gains.Kd - currentGains.Kd) < 0.005;

  return (
    <div className="p-2.5 rounded-lg border border-[var(--border)] bg-[var(--input-bg)]/40 hover:border-cyan-400/40 transition-colors text-xs space-y-2">
      <div className="flex items-center justify-between">
        <span className="font-bold text-[11px] text-[var(--text)]">
          {methodNames[result.method] || result.method}
        </span>
        <div className="flex items-center gap-1.5">
          <span className="text-[9px] text-[var(--text-muted)]">Confidence:</span>
          <span
            className="text-[10px] font-bold font-mono px-1.5 py-0.2 rounded"
            style={{
              color: confidenceColor,
              backgroundColor: `${confidenceColor}15`,
              border: `1px solid ${confidenceColor}30`,
            }}
          >
            {(result.confidence * 100).toFixed(0)}%
          </span>
        </div>
      </div>

      {/* Gain values chips */}
      <div className="grid grid-cols-3 gap-1 text-[10px] font-mono text-center">
        <div className="p-1 rounded bg-[var(--surface-2)] border border-[var(--accent-cyan)]/30">
          <span className="text-[var(--text-muted)] text-[9px] block">Kp</span>
          <span className="font-bold text-[var(--accent-cyan)]">{result.gains.Kp.toFixed(3)}</span>
        </div>
        <div className="p-1 rounded bg-[var(--surface-2)] border border-[var(--accent-purple)]/30">
          <span className="text-[var(--text-muted)] text-[9px] block">Ki</span>
          <span className="font-bold text-[var(--accent-purple)]">{result.gains.Ki.toFixed(3)}</span>
        </div>
        <div className="p-1 rounded bg-[var(--surface-2)] border border-[var(--accent-green)]/30">
          <span className="text-[var(--text-muted)] text-[9px] block">Kd</span>
          <span className="font-bold text-[var(--accent-green)]">{result.gains.Kd.toFixed(3)}</span>
        </div>
      </div>

      {/* Apply Button */}
      <button
        type="button"
        onClick={onApply}
        disabled={isCurrent}
        className={`w-full py-1.5 px-2 rounded text-[10px] font-bold transition-all flex items-center justify-center gap-1.5 shadow-sm ${
          isCurrent
            ? 'bg-[var(--accent-green-bg)] text-[var(--accent-green)] border border-[var(--accent-green)]/30 cursor-default'
            : 'bg-[var(--accent-cyan-bg)] text-[var(--accent-cyan)] hover:brightness-110 border border-[var(--accent-cyan)]/30 active:scale-98'
        }`}
      >
        {isCurrent ? (
          <>
            <Check size={11} /> Sedang Digunakan
          </>
        ) : (
          <>
            Terapkan Gain <ArrowRight size={11} />
          </>
        )}
      </button>
    </div>
  );
});

export const TuningTab = React.memo(function TuningTab({
  isAutoTuning,
  onRunAutoTune,
  tuningResults,
  recommendations,
  currentGains,
  onApplyGains,
}: TuningTabProps) {
  const hasResults = tuningResults.length > 0;

  return (
    <div
      role="tabpanel"
      id="tabpanel-tuning"
      data-tab-content="tuning"
      aria-labelledby="tab-tuning"
      className="p-3 space-y-3 font-mono"
    >
      {/* ── Auto-Tune Primary Action CTA ── */}
      <div>
        <div className="flex items-center gap-1.5 mb-2">
          <Wand2 size={13} className="text-[var(--accent-cyan)]" />
          <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
            Auto-Tuning Engine
          </span>
        </div>

        <button
          type="button"
          onClick={onRunAutoTune}
          disabled={isAutoTuning}
          className="w-full p-3 rounded-lg bg-[var(--accent-cyan-bg)] border border-[var(--accent-cyan)]/40 text-[var(--accent-cyan)] text-xs font-bold hover:brightness-110 transition-all disabled:opacity-50 flex items-center justify-center gap-2 shadow-sm group active:scale-98"
        >
          {isAutoTuning ? (
            <>
              <div className="w-3.5 h-3.5 border-2 border-[var(--accent-cyan)] border-t-transparent rounded-full animate-spin" />
              <span>Mengoptimasi 4 Metode Matematis...</span>
            </>
          ) : (
            <>
              <Sparkles size={14} className="text-[var(--accent-cyan)] group-hover:rotate-12 transition-transform" />
              <span>Jalankan Auto-Tune (4 Metode)</span>
            </>
          )}
        </button>
      </div>

      {/* Empty State Help text */}
      {!hasResults && !isAutoTuning && (
        <div className="p-3 rounded-lg bg-[var(--accent-cyan-bg)] border border-[var(--accent-cyan)]/20 text-[10px] text-[var(--accent-cyan)] flex items-start gap-2.5">
          <Info size={14} className="flex-shrink-0 text-[var(--accent-cyan)] mt-0.5" />
          <div>
            <p className="font-bold text-[11px] mb-0.5 text-[var(--accent-cyan)]">Belum Ada Hasil Tuning</p>
            <p className="text-[var(--text-muted)] leading-relaxed">
              Tekan tombol di atas untuk mensintesis gain pengendali optimal secara otomatis menggunakan
              metode Pole Placement, Ziegler-Nichols, Cohen-Coon, dan Optimasi Nelder-Mead.
            </p>
          </div>
        </div>
      )}

      {/* Recommendations if any */}
      {recommendations.length > 0 && (
        <div className="space-y-2 pt-1 border-t border-[var(--border)]">
          <div className="flex items-center gap-1.5">
            <AlertTriangle size={12} className="text-amber-400" />
            <span className="text-[10px] font-bold uppercase tracking-wider opacity-70">
              Rekomendasi Diagnostik
            </span>
          </div>

          <div className="space-y-1.5">
            {recommendations.map((rec, i) => {
              const isCrit = rec.severity === 'critical';
              const isWarn = rec.severity === 'warning';
              const Icon = isCrit ? AlertTriangle : isWarn ? AlertTriangle : CheckCircle2;
              const color = isCrit ? '#EF4444' : isWarn ? '#F59E0B' : '#10B981';

              return (
                <div
                  key={i}
                  className="p-2.5 rounded-lg border text-xs"
                  style={{ borderColor: `${color}35`, backgroundColor: `${color}0C` }}
                >
                  <div className="flex items-start gap-2">
                    <Icon size={14} style={{ color, flexShrink: 0, marginTop: 1 }} />
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-[11px]" style={{ color }}>
                        {rec.title}
                      </p>
                      <p className="text-[10px] opacity-70 mt-0.5 leading-relaxed">{rec.message}</p>
                      {rec.suggestedGains && (
                        <button
                          type="button"
                          onClick={() => {
                            if (rec.suggestedGains) {
                              onApplyGains({
                                Kp: rec.suggestedGains.Kp ?? currentGains.Kp,
                                Ki: rec.suggestedGains.Ki ?? currentGains.Ki,
                                Kd: rec.suggestedGains.Kd ?? currentGains.Kd,
                              });
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
        </div>
      )}

      {/* Computed Tuning Results */}
      {hasResults && (
        <div className="space-y-2 pt-1 border-t border-[var(--border)]">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider opacity-70">
              Hasil Sintesis & Optimasi
            </span>
            <span className="text-[9px] opacity-50">{tuningResults.length} Metode</span>
          </div>

          <div className="space-y-2">
            {tuningResults.map((result, i) => (
              <TuningResultCard
                key={i}
                result={result}
                currentGains={currentGains}
                onApply={() => onApplyGains(result.gains)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
});
