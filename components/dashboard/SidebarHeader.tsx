// ============================================================================
// SidebarHeader — Sticky Top Navigation & Compact Robot Archetype Selector
// ============================================================================

'use client';

import React, { useState } from 'react';
import {
  Cpu,
  Sun,
  Moon,
  Code,
  ChevronDown,
  ChevronRight,
  Minimize2,
} from 'lucide-react';
import { RobotDefinition } from '@/types/robots';
import { ROBOT_CATEGORIES, getRobotsByCategory } from '@/types/robots';
import { RobotCategory } from '@/types/simulation';

interface SidebarHeaderProps {
  selectedRobot: RobotDefinition;
  onSelectRobot: (robot: RobotDefinition) => void;
  isDark: boolean;
  onToggleTheme: () => void;
  showExport: boolean;
  onToggleExport: () => void;
  onCollapse: () => void;
  exportTriggerRef?: React.RefObject<HTMLButtonElement | null>;
}

export const SidebarHeader = React.memo(function SidebarHeader({
  selectedRobot,
  onSelectRobot,
  isDark,
  onToggleTheme,
  showExport,
  onToggleExport,
  onCollapse,
  exportTriggerRef,
}: SidebarHeaderProps) {
  const [showRobotPicker, setShowRobotPicker] = useState(false);
  const [expandedCategory, setExpandedCategory] = useState<RobotCategory | null>(null);

  return (
    <div className="border-b border-[var(--border)] bg-[var(--panel-bg)]/95 backdrop-blur-md sticky top-0 z-30 flex flex-col">
      {/* ── Row 1: Title + Tools (Export, Theme, Collapse) ── */}
      <div className="px-3 py-2 flex items-center justify-between border-b border-[var(--border-subtle)] gap-1.5">
        <div className="flex items-center gap-1.5 min-w-0">
          <Cpu size={15} className="text-[var(--accent-cyan)] shrink-0" />
          <span className="text-xs font-mono font-bold tracking-wider text-[var(--text)] truncate">
            PID CONTROL SIM
          </span>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {/* Code Export Toggle Button */}
          <button
            ref={exportTriggerRef}
            type="button"
            aria-label="Export Controller Code"
            onClick={onToggleExport}
            className={`p-1.5 rounded-md transition-colors ${
              showExport
                ? 'bg-[var(--accent-cyan-bg)] text-[var(--accent-cyan)] border border-[var(--border-active)]'
                : 'hover:bg-[var(--hover-bg)] text-[var(--text-muted)] hover:text-[var(--text)]'
            }`}
            title="Export Source Code (C++, Python, JSON)"
          >
            <Code size={14} />
          </button>

          {/* Theme Toggle Button */}
          <button
            type="button"
            aria-label={isDark ? 'Ganti ke Tema Terang' : 'Ganti ke Tema Gelap'}
            onClick={onToggleTheme}
            className="p-1.5 rounded-md hover:bg-[var(--hover-bg)] text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
            title={isDark ? 'Light Mode' : 'Dark Mode'}
          >
            {isDark ? (
              <Sun size={14} className="text-[var(--accent-amber)]" />
            ) : (
              <Moon size={14} className="text-[var(--accent-purple)]" />
            )}
          </button>

          {/* Collapse Panel Button */}
          <button
            type="button"
            aria-label="Ciutkan Sidebar"
            onClick={onCollapse}
            className="p-1.5 rounded-md hover:bg-[var(--hover-bg)] text-[var(--text-muted)] hover:text-[var(--text)] transition-colors opacity-75 hover:opacity-100"
            title="Sembunyikan / Ciutkan Sidebar"
          >
            <Minimize2 size={13} />
          </button>
        </div>
      </div>

      {/* ── Row 2: Compact Robot Archetype Selector ── */}
      <div className="px-3 py-2 relative">
        <button
          type="button"
          aria-label={`Pilih Robot (Saat ini: ${selectedRobot.name})`}
          onClick={() => setShowRobotPicker((p) => !p)}
          className="w-full p-2 rounded-lg flex items-center justify-between gap-2 border border-[var(--border)] bg-[var(--input-bg)]/40 hover:border-[var(--border-active)] hover:bg-[var(--hover-bg)] transition-all text-left group"
        >
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-lg flex-shrink-0">{selectedRobot.icon}</span>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-mono font-bold truncate text-[var(--text)] group-hover:text-[var(--accent-cyan)] transition-colors">
                {selectedRobot.name}
              </p>
              <p
                className="text-[10px] font-mono text-[var(--text-muted)] truncate"
                title={selectedRobot.description}
              >
                {selectedRobot.description}
              </p>
            </div>
          </div>
          <ChevronDown
            size={13}
            className={`transition-transform flex-shrink-0 text-[var(--text-muted)] ${
              showRobotPicker ? 'rotate-180' : ''
            }`}
          />
        </button>

        {/* Dropdown Menu Categories & Items */}
        {showRobotPicker && (
          <div className="absolute left-3 right-3 top-full mt-1 max-h-72 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-2xl z-40 font-mono">
            {(Object.keys(ROBOT_CATEGORIES) as RobotCategory[]).map((cat) => (
              <div key={cat} className="border-b border-[var(--border-subtle)] last:border-b-0">
                <button
                  type="button"
                  onClick={() =>
                    setExpandedCategory((prev) => (prev === cat ? null : cat))
                  }
                  className="w-full p-2 flex items-center gap-2 text-xs hover:bg-[var(--hover-bg)] transition-colors text-left text-[var(--text)]"
                >
                  <span className="text-sm">{ROBOT_CATEGORIES[cat].icon}</span>
                  <span className="font-bold text-[11px] text-[var(--text)]">
                    {ROBOT_CATEGORIES[cat].name}
                  </span>
                  <ChevronRight
                    size={11}
                    className={`ml-auto transition-transform text-[var(--text-muted)] ${
                      expandedCategory === cat ? 'rotate-90' : ''
                    }`}
                  />
                </button>

                {expandedCategory === cat &&
                  getRobotsByCategory(cat).map((robot) => (
                    <button
                      key={robot.id}
                      type="button"
                      onClick={() => {
                        onSelectRobot(robot);
                        setShowRobotPicker(false);
                      }}
                      className={`w-full p-2 pl-7 flex items-center gap-2 text-xs transition-colors text-left ${
                        selectedRobot.id === robot.id
                          ? 'bg-[var(--accent-cyan-bg)] text-[var(--accent-cyan)] font-bold'
                          : 'hover:bg-[var(--hover-bg)] text-[var(--text-muted)] hover:text-[var(--text)]'
                      }`}
                    >
                      <span className="text-sm">{robot.icon}</span>
                      <div className="min-w-0 flex-1">
                        <span className="truncate block text-[11px] font-bold">
                          {robot.name}
                        </span>
                      </div>
                    </button>
                  ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
});
