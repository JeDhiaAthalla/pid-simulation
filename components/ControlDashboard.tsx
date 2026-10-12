// ============================================================================
// ControlDashboard — Unified Modular PID Control Simulation Dashboard
// Redesigned Stage 2 Implementation:
// - Sticky Header: App Title, Theme Toggle, Code Export, Collapse, Robot Selector
// - Sticky RunBar: Start/Pause, Step, Reset, Disturbance, Speed multipliers, Clock
// - Sticky MiniMetricsBar: Single-line live telemetry (Tr | %OS | Ts | Ess)
// - Sticky 4-Tab Navigation: Kontrol | Metrik | Tuning | Sinyal (Keyboard Accessible)
// - Independent Scrollable Content Body with Custom Scrollbar
// - Integrated Resizable Drag Handle (320px – 560px) & Collapsible Rail
// - Hydration-Safe localStorage Persistence (Tabs, Width, Collapse State)
// ============================================================================

'use client';

import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  Zap,
  Sun,
  Moon,
  PanelLeftOpen,
} from 'lucide-react';
import { SimulationHookState, SimulationHookActions } from '@/hooks/useSimulation';
import { PIDGains } from '@/types/simulation';

// Modular Dashboard Subcomponents
import { SidebarHeader } from './dashboard/SidebarHeader';
import { RunBar } from './dashboard/RunBar';
import { MiniMetricsBar } from './dashboard/MiniMetricsBar';
import { SidebarTabs, TabKey } from './dashboard/SidebarTabs';
import { ControlTab } from './dashboard/ControlTab';
import { MetricsTab } from './dashboard/MetricsTab';
import { TuningTab } from './dashboard/TuningTab';
import { SignalTab } from './dashboard/SignalTab';
import { CodeExportDrawer } from './dashboard/CodeExportDrawer';

export interface ControlDashboardProps {
  state: SimulationHookState;
  actions: SimulationHookActions;
  isDark: boolean;
  toggleTheme: () => void;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  sidebarWidth?: number;
  onWidthChange?: (width: number) => void;
}

export default function ControlDashboard({
  state,
  actions,
  isDark,
  toggleTheme,
  isCollapsed: controlledCollapsed,
  onToggleCollapse: controlledToggleCollapse,
  sidebarWidth: controlledWidth,
  onWidthChange: controlledOnWidthChange,
}: ControlDashboardProps) {
  // ── 1. Local UI States with SSR Hydration Safety (Rule U6) ──
  const [activeTab, setActiveTab] = useState<TabKey>('control');
  const [internalCollapsed, setInternalCollapsed] = useState(false);
  const [internalWidth, setInternalWidth] = useState(380);
  const [isResizing, setIsResizing] = useState(false);
  const [showExport, setShowExport] = useState(false);

  // Noise State (Preserved for feature parity)
  const [noiseEnabled, setNoiseEnabled] = useState(false);
  const [noiseSigma, setNoiseSigma] = useState(0.05);

  const resizeStartXRef = useRef<number>(0);
  const resizeStartWidthRef = useRef<number>(380);
  const exportTriggerRef = useRef<HTMLButtonElement | null>(null);

  // Controlled vs Uncontrolled Resolution
  const isCollapsed = controlledCollapsed !== undefined ? controlledCollapsed : internalCollapsed;
  const currentWidth = controlledWidth !== undefined ? controlledWidth : internalWidth;

  const handleToggleCollapse = useCallback(() => {
    if (controlledToggleCollapse) {
      controlledToggleCollapse();
    } else {
      setInternalCollapsed((prev) => {
        const next = !prev;
        try {
          localStorage.setItem('pid_sim_sidebar_collapsed', JSON.stringify(next));
        } catch {
          // Ignore localStorage errors
        }
        return next;
      });
    }
  }, [controlledToggleCollapse]);

  const handleWidthChange = useCallback(
    (newWidth: number) => {
      const clamped = Math.max(320, Math.min(560, newWidth));
      if (controlledOnWidthChange) {
        controlledOnWidthChange(clamped);
      } else {
        setInternalWidth(clamped);
      }
      try {
        localStorage.setItem('pid_sim_sidebar_width', clamped.toString());
      } catch {
        // Ignore localStorage errors
      }
    },
    [controlledOnWidthChange]
  );

  const handleTabChange = useCallback((tab: TabKey) => {
    setActiveTab(tab);
    try {
      localStorage.setItem('pid_sim_active_tab', tab);
    } catch {
      // Ignore localStorage errors
    }
  }, []);

  // ── 2. Read LocalStorage ONLY after paint to prevent hydration mismatch (Rule U6) ──
  useEffect(() => {
    const handleWindowResize = () => {
      const maxAllowed = Math.min(560, Math.max(320, window.innerWidth - 320));
      if (currentWidth > maxAllowed) {
        handleWidthChange(maxAllowed);
      }
    };
    window.addEventListener('resize', handleWindowResize);

    const rafId = requestAnimationFrame(() => {
      try {
        const savedTab = localStorage.getItem('pid_sim_active_tab');
        if (
          savedTab &&
          (savedTab === 'control' ||
            savedTab === 'metrics' ||
            savedTab === 'tuning' ||
            savedTab === 'signal')
        ) {
          setActiveTab(savedTab as TabKey);
        }

        const savedWidth = localStorage.getItem('pid_sim_sidebar_width');
        if (savedWidth) {
          const parsed = parseInt(savedWidth, 10);
          if (!isNaN(parsed) && parsed >= 320 && parsed <= 560) {
            if (controlledOnWidthChange) {
              controlledOnWidthChange(parsed);
            } else {
              setInternalWidth(parsed);
            }
          } else {
            // Track A2: Nilai di luar rentang = reset default 380
            if (controlledOnWidthChange) {
              controlledOnWidthChange(380);
            } else {
              setInternalWidth(380);
            }
          }
        }

        const savedCollapsed = localStorage.getItem('pid_sim_sidebar_collapsed');
        if (savedCollapsed !== null && controlledCollapsed === undefined) {
          setInternalCollapsed(savedCollapsed === 'true');
        }
      } catch {
        // Ignore localStorage read errors in private browsing or iframe
      }
    });

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', handleWindowResize);
    };
  }, [controlledCollapsed, controlledOnWidthChange, currentWidth, handleWidthChange]);

  // ── 3. Resizable Drag Handle Logic ──
  const handlePointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    setIsResizing(true);
    resizeStartXRef.current = e.clientX;
    resizeStartWidthRef.current = currentWidth;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isResizing) return;
    const delta = e.clientX - resizeStartXRef.current;
    handleWidthChange(resizeStartWidthRef.current + delta);
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!isResizing) return;
    setIsResizing(false);
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // Pointer capture released
    }
  };

  // ── 4. Layman 1-Click Presets Calculation (Unmodified Math) ──
  const handleApplyPreset = useCallback(
    (type: 'stable' | 'aggressive' | 'oscillating') => {
      const basePlant = state.selectedRobot.defaultPlant;
      const tau = Math.max(basePlant.timeConstant, 0.05);
      const K = Math.max(basePlant.gain, 0.1);
      const L = Math.max(basePlant.deadTime, 0.01);

      if (type === 'stable') {
        const Kp = (0.9 * tau) / (K * L);
        const Ki = Kp / (3.3 * L);
        const Kd = Kp * 0.5 * L;
        actions.applyGains({
          Kp: parseFloat(Kp.toFixed(3)),
          Ki: parseFloat(Ki.toFixed(3)),
          Kd: parseFloat(Kd.toFixed(3)),
        });
      } else if (type === 'aggressive') {
        const Kp = (1.4 * tau) / (K * L);
        const Ki = Kp / (2.0 * L);
        const Kd = Kp * 0.45 * L;
        actions.applyGains({
          Kp: parseFloat(Kp.toFixed(3)),
          Ki: parseFloat(Ki.toFixed(3)),
          Kd: parseFloat(Kd.toFixed(3)),
        });
      } else if (type === 'oscillating') {
        const Kp = (2.2 * tau) / (K * L);
        const Ki = Kp / (1.2 * L);
        const Kd = Kp * 0.08 * L;
        actions.applyGains({
          Kp: parseFloat(Kp.toFixed(3)),
          Ki: parseFloat(Ki.toFixed(3)),
          Kd: parseFloat(Kd.toFixed(3)),
        });
      }
    },
    [actions, state.selectedRobot]
  );

  const handleApplyGains = useCallback(
    (gains: PIDGains) => {
      actions.applyGains(gains);
    },
    [actions]
  );

  const handleDisturbance = useCallback(() => {
    actions.injectDisturbance(state.plant.gain * 3.5, 0.35);
  }, [actions, state.plant.gain]);

  // ── 5. Collapsed Rail View (Icon Rail ~48px) ──
  if (isCollapsed) {
    return (
      <aside
        className="w-12 h-full border-r border-[var(--border)] bg-[var(--surface)] flex flex-col items-center py-2.5 gap-3 select-none flex-shrink-0 z-20"
        aria-label="Sidebar Rail Ciut"
      >
        <button
          type="button"
          aria-label="Perluas Sidebar"
          onClick={handleToggleCollapse}
          className="p-2 rounded-lg hover:bg-[var(--hover-bg)] text-[var(--accent-cyan)] transition-colors"
          title="Perluas Sidebar"
        >
          <PanelLeftOpen size={16} />
        </button>

        <div className="w-6 h-px bg-[var(--border)]" />

        {/* Quick Play/Pause Button */}
        <button
          type="button"
          aria-label={state.isRunning ? 'Jeda Simulasi' : 'Mulai Simulasi'}
          onClick={actions.toggleRunning}
          className={`p-2 rounded-lg transition-colors ${
            state.isRunning
              ? 'text-[var(--accent-amber)] hover:bg-[var(--accent-amber-bg)]'
              : 'text-[var(--accent-green)] hover:bg-[var(--accent-green-bg)]'
          }`}
          title={state.isRunning ? 'PAUSE' : 'START'}
        >
          {state.isRunning ? <Pause size={14} /> : <Play size={14} />}
        </button>

        {/* Quick Reset */}
        <button
          type="button"
          aria-label="Reset Simulasi"
          onClick={actions.reset}
          className="p-2 rounded-lg text-[var(--accent-red)] hover:bg-[var(--accent-red-bg)] transition-colors"
          title="Reset Plant"
        >
          <RotateCcw size={14} />
        </button>

        {/* Quick Disturbance */}
        <button
          type="button"
          aria-label="Injeksi Gangguan"
          onClick={handleDisturbance}
          className="p-2 rounded-lg text-[var(--accent-amber)] hover:bg-[var(--accent-amber-bg)] transition-colors"
          title="Injeksi Gangguan"
        >
          <Zap size={14} />
        </button>

        <div className="w-6 h-px bg-[var(--border)]" />

        {/* Active Tab Indicators */}
        <button
          type="button"
          aria-label="Buka Tab Kontrol"
          onClick={() => {
            handleToggleCollapse();
            handleTabChange('control');
          }}
          className={`p-2 rounded-lg transition-colors text-xs ${
            activeTab === 'control' ? 'bg-[var(--accent-cyan-bg)] text-[var(--accent-cyan)]' : 'text-[var(--text-muted)] hover:text-[var(--text)]'
          }`}
          title="Tab Kontrol"
        >
          <span className="text-[10px] font-mono font-bold">K</span>
        </button>

        <button
          type="button"
          aria-label="Buka Tab Metrik"
          onClick={() => {
            handleToggleCollapse();
            handleTabChange('metrics');
          }}
          className={`p-2 rounded-lg transition-colors text-xs ${
            activeTab === 'metrics' ? 'bg-[var(--accent-cyan-bg)] text-[var(--accent-cyan)]' : 'text-[var(--text-muted)] hover:text-[var(--text)]'
          }`}
          title="Tab Metrik"
        >
          <span className="text-[10px] font-mono font-bold">M</span>
        </button>

        <button
          type="button"
          aria-label="Buka Tab Tuning"
          onClick={() => {
            handleToggleCollapse();
            handleTabChange('tuning');
          }}
          className={`p-2 rounded-lg transition-colors text-xs ${
            activeTab === 'tuning' ? 'bg-[var(--accent-cyan-bg)] text-[var(--accent-cyan)]' : 'text-[var(--text-muted)] hover:text-[var(--text)]'
          }`}
          title="Tab Tuning"
        >
          <span className="text-[10px] font-mono font-bold">T</span>
        </button>

        <button
          type="button"
          aria-label="Buka Tab Sinyal"
          onClick={() => {
            handleToggleCollapse();
            handleTabChange('signal');
          }}
          className={`p-2 rounded-lg transition-colors text-xs ${
            activeTab === 'signal' ? 'bg-[var(--accent-cyan-bg)] text-[var(--accent-cyan)]' : 'text-[var(--text-muted)] hover:text-[var(--text)]'
          }`}
          title="Tab Sinyal"
        >
          <span className="text-[10px] font-mono font-bold">S</span>
        </button>

        <div className="mt-auto flex flex-col items-center gap-2">
          {/* Theme Toggle */}
          <button
            type="button"
            aria-label="Ganti Tema"
            onClick={toggleTheme}
            className="p-2 rounded-lg hover:bg-[var(--hover-bg)] text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
            title="Toggle Tema"
          >
            {isDark ? <Sun size={14} className="text-[var(--accent-amber)]" /> : <Moon size={14} className="text-[var(--accent-purple)]" />}
          </button>
        </div>
      </aside>
    );
  }

  // ── 6. Full Sidebar View ──
  return (
    <aside
      aria-label="Sidebar Kontrol PID & Telemetri"
      data-sidebar-panel="true"
      className="h-full flex flex-row relative select-none flex-shrink-0 z-20"
      style={{ width: `${currentWidth}px` }}
    >
      {/* Inner Sidebar Container (Track A2 Width Invariant: w-full min-w-0 flex-1) */}
      <div className="w-full h-full min-w-0 flex-1 flex flex-col bg-[var(--panel-bg)] border-r border-[var(--border)] overflow-hidden">
        {/* ── Sticky Header: App Title, Theme, Robot Selector ── */}
        <SidebarHeader
          selectedRobot={state.selectedRobot}
          onSelectRobot={actions.selectRobot}
          isDark={isDark}
          onToggleTheme={toggleTheme}
          showExport={showExport}
          onToggleExport={() => setShowExport((prev) => !prev)}
          onCollapse={handleToggleCollapse}
          exportTriggerRef={exportTriggerRef}
        />

        {/* ── Sticky RunBar: Start/Pause, Step, Reset, Speed, Clock ── */}
        <RunBar
          isRunning={state.isRunning}
          onToggleRunning={actions.toggleRunning}
          onStepForward={actions.stepForward}
          onReset={actions.reset}
          onDisturbance={handleDisturbance}
          speedMultiplier={state.speedMultiplier}
          onSetSpeed={actions.setSpeedMultiplier}
          time={state.time}
        />

        {/* ── Sticky MiniMetricsBar: Single-Line Telemetry Strip ── */}
        <MiniMetricsBar metrics={state.metrics} />

        {/* ── Sticky Tab Bar: 4 Accessible Tabs ── */}
        <SidebarTabs
          activeTab={activeTab}
          onTabChange={handleTabChange}
          metrics={state.metrics}
          recommendationsCount={state.recommendations.length}
          sidebarWidth={currentWidth}
        />

        {/* ── Scrollable Body with Isolated Internal Scroll ── */}
        <div className="flex-1 overflow-y-auto overscroll-contain custom-scrollbar">
          {activeTab === 'control' && (
            <ControlTab
              selectedRobot={state.selectedRobot}
              setpoint={state.setpoint}
              onSetSetpoint={actions.setSetpoint}
              pidConfig={state.pidConfig}
              onSetPIDGains={actions.setPIDGains}
              pTerm={state.controllerState.pTerm}
              iTerm={state.controllerState.iTerm}
              dTerm={state.controllerState.dTerm}
              plant={state.plant}
              onSetPlant={actions.setPlant}
              onApplyPreset={handleApplyPreset}
            />
          )}

          {activeTab === 'metrics' && (
            <MetricsTab
              metrics={state.metrics}
              recommendations={state.recommendations}
              onApplyGains={(gains) => {
                actions.setPIDGains(gains);
              }}
              simTime={state.time}
              isRunning={state.isRunning}
            />
          )}

          {activeTab === 'tuning' && (
            <TuningTab
              isAutoTuning={state.isAutoTuning}
              onRunAutoTune={actions.runAutoTune}
              tuningResults={state.tuningResults}
              recommendations={state.recommendations}
              currentGains={state.pidConfig}
              onApplyGains={handleApplyGains}
            />
          )}

          {activeTab === 'signal' && (
            <SignalTab
              pidConfig={state.pidConfig}
              onSetPIDConfig={actions.setPIDConfig}
              plant={state.plant}
              onSetPlant={actions.setPlant}
              noiseEnabled={noiseEnabled}
              onToggleNoise={setNoiseEnabled}
              noiseSigma={noiseSigma}
              onChangeNoiseSigma={setNoiseSigma}
            />
          )}
        </div>
      </div>

      {/* ── Code Export Drawer (Rendered via portal, does not disrupt sidebar width) ── */}
      <CodeExportDrawer
        isOpen={showExport}
        onClose={() => setShowExport(false)}
        selectedRobot={state.selectedRobot}
        pidConfig={state.pidConfig}
        plant={state.plant}
        setpoint={state.setpoint}
        triggerRef={exportTriggerRef}
      />

      {/* ── Desktop Resizable Drag Handle (Double-click resets to default 380px) ── */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Ubah Lebar Sidebar"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onDoubleClick={() => handleWidthChange(380)}
        className={`w-2 -mr-1 h-full cursor-col-resize relative z-30 group touch-none flex items-center justify-center transition-colors ${
          isResizing ? 'bg-[var(--accent-cyan-bg)]' : 'hover:bg-[var(--hover-bg)]'
        }`}
        title="Tarik untuk mengubah lebar sidebar (320px - 560px). Dobel klik untuk reset ke 380px."
      >
        <div
          className={`w-0.5 h-8 rounded-full transition-colors ${
            isResizing ? 'bg-[var(--accent-cyan)]' : 'bg-[var(--border)] group-hover:bg-[var(--accent-cyan)]'
          }`}
        />
      </div>
    </aside>
  );
}
