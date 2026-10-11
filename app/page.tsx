// ============================================================================
// Main Application Page — PID Control Simulation HUD
// Responsive multi-panel layout with Stage 2 SimulationCanvas & Redesigned Sidebar
// ============================================================================

'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { Sliders, X, ChevronUp } from 'lucide-react';
import { useSimulation } from '@/hooks/useSimulation';
import { ROBOTS } from '@/types/robots';
import SimulationCanvas from '@/components/SimulationCanvas';
import ControlDashboard from '@/components/ControlDashboard';
import { RunBar } from '@/components/dashboard/RunBar';

export default function Home() {
  const [isDark, setIsDark] = useState(true);
  const [isMobile, setIsMobile] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(380);
  const [isPanelCollapsed, setIsPanelCollapsed] = useState(false);
  const [isMobileDrawerOpen, setIsMobileDrawerOpen] = useState(false);

  const initialRobot = ROBOTS.find((r) => r.id === 'quadcopter') || ROBOTS[0];
  const [state, actions] = useSimulation(initialRobot);

  // Responsive breakpoint detection & SSR-safe localStorage restoration (Rule U6)
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 1024);
    checkMobile();
    window.addEventListener('resize', checkMobile);

    // Read persisted localStorage after initial paint to prevent hydration mismatch and cascading renders
    const rafId = requestAnimationFrame(() => {
      try {
        const savedWidth = localStorage.getItem('pid_sim_sidebar_width');
        if (savedWidth) {
          const parsed = parseInt(savedWidth, 10);
          if (!isNaN(parsed) && parsed >= 320 && parsed <= 560) {
            setSidebarWidth(parsed);
          } else {
            setSidebarWidth(380);
          }
        }
        const savedCollapsed = localStorage.getItem('pid_sim_sidebar_collapsed');
        if (savedCollapsed !== null) {
          setIsPanelCollapsed(savedCollapsed === 'true');
        }
      } catch {
        // Ignore localStorage errors
      }
    });

    const handleWindowResize = () => {
      checkMobile();
      setSidebarWidth((prev) => Math.max(320, Math.min(560, prev)));
    };
    window.addEventListener('resize', handleWindowResize);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', handleWindowResize);
      window.removeEventListener('resize', checkMobile);
    };
  }, []);

  const toggleTheme = useCallback(() => {
    setIsDark((prev) => !prev);
  }, []);

  const handleDisturbance = useCallback(() => {
    actions.injectDisturbance(state.plant.gain * 3.5, 0.35);
  }, [actions, state.plant.gain]);

  const handleSidebarWidthChange = useCallback((newWidth: number) => {
    const clamped = Math.max(320, Math.min(560, newWidth));
    setSidebarWidth(clamped);
    try {
      localStorage.setItem('pid_sim_sidebar_width', clamped.toString());
    } catch {
      // Ignore localStorage errors
    }
  }, []);

  const handleToggleCollapse = useCallback(() => {
    setIsPanelCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('pid_sim_sidebar_collapsed', JSON.stringify(next));
      } catch {
        // Ignore localStorage errors
      }
      return next;
    });
  }, []);

  return (
    <div className={`${isDark ? '' : 'light'} h-dvh w-screen overflow-hidden`}>
      {/* ── DESKTOP LAYOUT (≥ 1024px) ── */}
      {!isMobile ? (
        <div className="h-full w-full flex flex-row overflow-hidden min-w-0">
          {/* Left Panel — Controls & Telemetry */}
          <div
            className="h-full flex-shrink-0 flex flex-col relative z-20 min-w-0"
            style={{
              width: isPanelCollapsed ? '48px' : `${sidebarWidth}px`,
              transition: isPanelCollapsed ? 'width 0.2s ease' : 'none',
            }}
          >
            <ControlDashboard
              state={state}
              actions={actions}
              isDark={isDark}
              toggleTheme={toggleTheme}
              isCollapsed={isPanelCollapsed}
              onToggleCollapse={handleToggleCollapse}
              sidebarWidth={sidebarWidth}
              onWidthChange={handleSidebarWidthChange}
            />
          </div>

          {/* Right Area — Unified Dual-Viewport SimulationCanvas */}
          <div className="flex-1 h-full overflow-hidden p-3 flex flex-col min-w-0">
            <SimulationCanvas
              engineRef={state.engineRef}
              robot={state.selectedRobot}
              plant={state.plant}
              pidConfig={state.pidConfig}
              setpoint={state.setpoint}
              isRunning={state.isRunning}
              speedMultiplier={state.speedMultiplier}
              isDark={isDark}
              onDisturbance={handleDisturbance}
              mode="dual"
              className="h-full rounded-xl border border-[var(--border)] overflow-hidden shadow-2xl"
            />
          </div>
        </div>
      ) : (
        /* ── MOBILE / TABLET LAYOUT (< 1024px) ── */
        <div className="flex flex-col h-full overflow-hidden relative">
          {/* Top/Main — Unified SimulationCanvas with Built-in Tabbed Viewports */}
          <div className="flex-1 flex flex-col overflow-hidden min-h-0">
            <SimulationCanvas
              engineRef={state.engineRef}
              robot={state.selectedRobot}
              plant={state.plant}
              pidConfig={state.pidConfig}
              setpoint={state.setpoint}
              isRunning={state.isRunning}
              speedMultiplier={state.speedMultiplier}
              isDark={isDark}
              onDisturbance={handleDisturbance}
              mode="tabbed"
              className="h-full border-b border-[var(--border)]"
            />
          </div>

          {/* Sticky Mobile RunBar (Always visible) */}
          <div className="bg-[var(--panel-bg)] border-t border-[var(--border)] flex flex-col z-10 shadow-lg flex-shrink-0">
            <div className="px-3 pt-2 pb-1 flex items-center justify-between border-b border-white/5">
              <div className="flex items-center gap-1.5 text-xs font-mono font-bold text-slate-300 truncate">
                <span>{state.selectedRobot.icon}</span>
                <span className="truncate">{state.selectedRobot.name}</span>
              </div>

              <button
                type="button"
                onClick={() => setIsMobileDrawerOpen(true)}
                className="px-2.5 py-1 rounded-md bg-cyan-500/15 border border-cyan-500/30 text-cyan-400 text-[11px] font-bold font-mono hover:bg-cyan-500/25 flex items-center gap-1.5 active:scale-95 transition-all"
              >
                <Sliders size={12} />
                <span>Kontrol & Metrik</span>
                <ChevronUp size={12} />
              </button>
            </div>

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
          </div>

          {/* Mobile Drawer Overlay */}
          {isMobileDrawerOpen && (
            <div className="fixed inset-0 z-50 flex flex-col bg-black/60 backdrop-blur-sm animate-in fade-in duration-150">
              <div className="h-12 w-full flex items-center justify-between px-4 bg-[var(--panel-bg)]/95 border-b border-[var(--border)]">
                <span className="font-mono text-xs font-bold text-cyan-400">
                  PENGATURAN KONTROL & METRIK
                </span>
                <button
                  type="button"
                  aria-label="Tutup Panel Kontrol"
                  onClick={() => setIsMobileDrawerOpen(false)}
                  className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="flex-1 overflow-hidden bg-[var(--panel-bg)] flex flex-col">
                <ControlDashboard
                  state={state}
                  actions={actions}
                  isDark={isDark}
                  toggleTheme={toggleTheme}
                  isCollapsed={false}
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
