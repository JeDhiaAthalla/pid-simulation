// ============================================================================
// SidebarTabs — Sticky Tab Bar (Kontrol | Metrik | Tuning | Sinyal)
// With keyboard accessibility and status indicator dots
// ============================================================================

'use client';

import React from 'react';
import { Sliders, BarChart3, Wand2, Waves } from 'lucide-react';
import { StepResponseMetrics } from '@/types/simulation';

export type TabKey = 'control' | 'metrics' | 'tuning' | 'signal';

interface SidebarTabsProps {
  activeTab: TabKey;
  onTabChange: (tab: TabKey) => void;
  metrics: StepResponseMetrics;
  recommendationsCount: number;
  sidebarWidth?: number;
}

export const SidebarTabs = React.memo(function SidebarTabs({
  activeTab,
  onTabChange,
  metrics,
  recommendationsCount,
  sidebarWidth,
}: SidebarTabsProps) {
  const tabs: { key: TabKey; label: string; icon: React.ElementType }[] = [
    { key: 'control', label: 'Kontrol', icon: Sliders },
    { key: 'metrics', label: 'Metrik', icon: BarChart3 },
    { key: 'tuning', label: 'Tuning', icon: Wand2 },
    { key: 'signal', label: 'Sinyal', icon: Waves },
  ];

  // Health indicator dot for Metrics tab
  const getMetricsDotColor = () => {
    if (metrics.dampingAssessment === 'unstable') return 'bg-rose-400';
    if (metrics.dampingAssessment === 'underdamped') return 'bg-amber-400';
    if (metrics.dampingAssessment === 'critically_damped') return 'bg-emerald-400';
    return 'bg-slate-500';
  };

  const handleKeyDown = (e: React.KeyboardEvent, index: number) => {
    if (e.key === 'ArrowRight') {
      const nextIdx = (index + 1) % tabs.length;
      onTabChange(tabs[nextIdx].key);
    } else if (e.key === 'ArrowLeft') {
      const prevIdx = (index - 1 + tabs.length) % tabs.length;
      onTabChange(tabs[prevIdx].key);
    }
  };

  return (
    <div
      role="tablist"
      aria-label="Navigasi Panel Sidebar"
      className="px-2 pt-1.5 border-b border-[var(--border)] bg-[var(--panel-bg)]/95 flex items-center justify-between font-mono sticky top-0 z-20"
    >
      {tabs.map((tab, idx) => {
        const Icon = tab.icon;
        const isActive = activeTab === tab.key;

        return (
          <button
            key={tab.key}
            role="tab"
            id={`tab-${tab.key}`}
            aria-selected={isActive}
            aria-label={tab.label}
            title={tab.label}
            aria-controls={`tabpanel-${tab.key}`}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onTabChange(tab.key)}
            onKeyDown={(e) => handleKeyDown(e, idx)}
            className={`flex-1 py-1.5 px-1 flex items-center justify-center gap-1.5 text-xs font-bold transition-all relative border-b-2 rounded-t-md focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan-400 ${
              isActive
                ? 'text-cyan-400 border-cyan-400 bg-cyan-500/10'
                : 'text-slate-400 hover:text-slate-200 border-transparent hover:bg-white/5'
            }`}
          >
            <Icon size={13} className="flex-shrink-0" />
            <span
              className={`text-[11px] truncate ${
                sidebarWidth !== undefined && sidebarWidth < 360 ? 'hidden' : 'inline'
              }`}
            >
              {tab.label}
            </span>

            {/* Health indicator dot for Metrics tab */}
            {tab.key === 'metrics' && (
              <span
                className={`w-1.5 h-1.5 rounded-full ${getMetricsDotColor()} flex-shrink-0`}
                title={`Status: ${metrics.dampingAssessment}`}
              />
            )}

            {/* Recommendation badge for Tuning tab */}
            {tab.key === 'tuning' && recommendationsCount > 0 && (
              <span className="px-1 py-0.2 rounded-full text-[9px] bg-amber-500/30 text-amber-300 font-bold border border-amber-500/40">
                {recommendationsCount}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
});
