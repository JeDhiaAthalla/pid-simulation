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
    if (metrics.dampingAssessment === 'unstable') return 'bg-[var(--accent-red)]';
    if (metrics.dampingAssessment === 'underdamped') return 'bg-[var(--accent-amber)]';
    if (metrics.dampingAssessment === 'critically_damped') return 'bg-[var(--accent-green)]';
    return 'bg-[var(--text-faint)]';
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

  const showLabel = sidebarWidth === undefined || sidebarWidth >= 360;

  return (
    <div
      role="tablist"
      aria-label="Navigasi Panel Sidebar"
      className="px-2 pt-1 min-h-[36px] border-b border-[var(--border)] bg-[var(--surface)] flex items-center justify-between font-mono sticky top-0 z-20 gap-1"
    >
      {tabs.map((tab, idx) => {
        const Icon = tab.icon;
        const isActive = activeTab === tab.key;

        return (
          <button
            key={tab.key}
            role="tab"
            id={`tab-${tab.key}`}
            data-tab-id={tab.key}
            aria-selected={isActive}
            aria-label={tab.label}
            title={tab.label}
            aria-controls={`tabpanel-${tab.key}`}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onTabChange(tab.key)}
            onKeyDown={(e) => handleKeyDown(e, idx)}
            className={`flex-1 min-h-[32px] py-1 px-1.5 min-w-0 flex items-center justify-center gap-1.5 text-xs font-bold transition-all relative border-b-2 rounded-t-md focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--focus-ring)] ${
              isActive
                ? 'text-[var(--accent-cyan)] border-[var(--accent-cyan)] bg-[var(--accent-cyan-bg)]'
                : 'text-[var(--text-muted)] hover:text-[var(--text)] border-transparent hover:bg-[var(--hover-bg)]'
            }`}
          >
            <Icon size={14} className="flex-shrink-0" />
            <span
              data-sidebar-tab-label="true"
              className={`text-[11px] truncate ${
                showLabel ? 'inline' : 'hidden'
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
              <span className="px-1 py-0.2 rounded-full text-[9px] bg-[var(--accent-amber-bg)] text-[var(--accent-amber)] font-bold border border-[var(--accent-amber)]/40 flex-shrink-0">
                {recommendationsCount}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
});
