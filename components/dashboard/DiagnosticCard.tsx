// ============================================================================
// DiagnosticCard — Interactive System Health Recommendation & 1-Click Corrector
// ============================================================================

'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ArrowRight,
  Check,
} from 'lucide-react';
import { TuningRecommendation, PIDGains } from '@/types/simulation';

interface DiagnosticCardProps {
  recommendation: TuningRecommendation;
  onApplyGains: (gains: Partial<PIDGains>) => void;
  currentGains?: Partial<PIDGains>;
  className?: string;
}

export const DiagnosticCard = React.memo(function DiagnosticCard({
  recommendation,
  onApplyGains,
  currentGains,
  className = '',
}: DiagnosticCardProps) {
  const [isApplied, setIsApplied] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const isCrit = recommendation.severity === 'critical';
  const isWarn = recommendation.severity === 'warning';
  const Icon = isCrit ? AlertTriangle : isWarn ? AlertTriangle : CheckCircle2;
  const color = isCrit ? '#EF4444' : isWarn ? '#F59E0B' : '#10B981';

  const handleApplyCorrection = () => {
    let targetGains: Partial<PIDGains> = recommendation.suggestedGains || {};
    let toast = 'Koreksi parameter PID berhasil diterapkan.';

    const titleLower = recommendation.title.toLowerCase();
    const currKp = currentGains?.Kp ?? 2.0;
    const currKi = currentGains?.Ki ?? 0.5;
    const currKd = currentGains?.Kd ?? 0.3;

    // 1. Sustained Oscillation / Unstable Correction: Kp -35%, Kd +25%, Ki -50%
    if (titleLower.includes('oscillation') || titleLower.includes('unstable')) {
      targetGains = {
        Kp: Number((currKp * 0.65).toFixed(4)),
        Kd: Number(((currKd > 0 ? currKd * 1.25 : 0.5)).toFixed(4)),
        Ki: Number((currKi * 0.50).toFixed(4)),
      };
      toast = 'Koreksi Diterapkan: Kp diturunkan, Kd dinaikkan untuk meredam osilasi.';
    }
    // 2. Actuator Saturation Correction: Kp -30%, Ki -30%
    else if (titleLower.includes('saturation')) {
      targetGains = {
        Kp: Number((currKp * 0.70).toFixed(4)),
        Ki: Number((currKi * 0.70).toFixed(4)),
        Kd: currKd,
      };
      toast = 'Koreksi Diterapkan: Kp dan Ki diturunkan 30% untuk mengatasi saturasi aktuator.';
    } else if (recommendation.suggestedAction) {
      toast = recommendation.suggestedAction;
    }

    onApplyGains(targetGains);
    setIsApplied(true);
    setToastMessage(toast);

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setIsApplied(false);
      setToastMessage(null);
    }, 3000);
  };

  return (
    <div
      className={`p-2.5 rounded-lg border text-xs transition-all duration-200 ${className}`}
      style={{
        borderColor: isApplied ? '#10B98160' : `${color}35`,
        backgroundColor: isApplied ? '#10B98110' : `${color}0C`,
      }}
    >
      <div className="flex items-start gap-2">
        <Icon size={14} style={{ color: isApplied ? '#10B981' : color, flexShrink: 0, marginTop: 1 }} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-1">
            <p className="font-bold text-[11px]" style={{ color: isApplied ? '#10B981' : color }}>
              {recommendation.title}
            </p>
            {isApplied && (
              <span className="text-[9px] font-mono font-bold text-emerald-400 bg-emerald-500/10 px-1.5 py-0.2 rounded border border-emerald-500/30 animate-pulse">
                AKTIF
              </span>
            )}
          </div>
          <p className="text-[10px] opacity-75 mt-0.5 leading-relaxed text-[var(--text)]">
            {recommendation.message}
          </p>

          {/* Action Button */}
          {recommendation.suggestedGains && (
            <button
              type="button"
              onClick={handleApplyCorrection}
              className={`mt-2 px-2.5 py-1 rounded text-[10px] font-bold transition-all flex items-center gap-1.5 active:scale-95 shadow-xs ${
                isApplied
                  ? 'bg-emerald-500/25 text-emerald-300 border border-emerald-500/50'
                  : 'hover:brightness-115'
              }`}
              style={
                !isApplied
                  ? {
                      backgroundColor: `${color}20`,
                      color,
                      border: `1px solid ${color}40`,
                    }
                  : undefined
              }
            >
              {isApplied ? (
                <>
                  <Check size={11} className="text-emerald-400" />
                  <span>Koreksi Diterapkan</span>
                </>
              ) : (
                <>
                  <span>Terapkan Koreksi</span>
                  <ArrowRight size={10} />
                </>
              )}
            </button>
          )}

          {/* 3-Second Temporary Toast / Badge Notification */}
          {toastMessage && (
            <div className="mt-2 p-1.5 rounded bg-emerald-950/80 border border-emerald-500/40 text-[10px] text-emerald-300 flex items-start gap-1.5 transition-all">
              <CheckCircle2 size={12} className="text-emerald-400 shrink-0 mt-0.5" />
              <span className="leading-tight">{toastMessage}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});
