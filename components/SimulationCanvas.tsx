// ============================================================================
// SimulationCanvas — Enterprise-Grade Interactive Dual-Viewport Canvas
// Refactored Architecture:
// 1. Interactive Draggable Split-Pane with Pointer Capture & Auto-Buffer Resize
// 2. Oscilloscope Horizontal Time-Panning & 2D Physics Viewport Camera Drag
// 3. Conflict Resolution: Left-drag Disturbance vs Right/Middle/Mode Camera Pan
// 4. Mechanical Precision Graphics for all 11 Canonical Robot Archetypes
// 5. Zero React State-Thrashing (Pure mutable useRef tick loop at 60/120 FPS)
// ============================================================================

'use client';

import React, {
  useRef,
  useEffect,
  useCallback,
  useState,
  useImperativeHandle,
  forwardRef,
} from 'react';
import {
  GripVertical,
  GripHorizontal,
  RotateCcw,
  Zap,
  Monitor,
  Layers,
  Move,
  Crosshair,
  AlertTriangle,
  Compass,
} from 'lucide-react';
import {
  DataPoint,
  StepResponseMetrics,
  SimulationStatus,
  PlantParameters,
  PIDConfig,
  ControllerState,
  PlantState,
  RobotType,
  RobotDefinition,
  NoiseConfig,
} from '@/types/simulation';
import { ROBOTS } from '@/types/robots';
import {
  simulationStep,
  advanceAccumulator,
  createAccumulator,
  createPlantState,
  createControllerState,
  computeStepResponseMetrics,
  PHYSICS_DT,
  AccumulatorState,
  clamp,
} from '@/lib/physicsEngine';

// ---------------------------------------------------------------------------
// External Engine Handle Interface (Zero State Thrashing)
// ---------------------------------------------------------------------------
export interface SimulationEngineRef {
  plantStateRef: React.MutableRefObject<PlantState>;
  controllerStateRef: React.MutableRefObject<ControllerState>;
  timeRef: React.MutableRefObject<number>;
  dataRef: React.MutableRefObject<DataPoint[]>;
  disturbanceRef: React.MutableRefObject<{ magnitude: number; endTime: number }>;
  accumulatorRef?: React.MutableRefObject<AccumulatorState>;
  metricsRef?: React.MutableRefObject<StepResponseMetrics>;
  statusRef?: React.MutableRefObject<SimulationStatus>;
  setpointRef?: React.MutableRefObject<number>;
  pidConfigRef?: React.MutableRefObject<PIDConfig>;
  plantRef?: React.MutableRefObject<PlantParameters>;
  isRunningRef?: React.MutableRefObject<boolean>;
  speedMultiplierRef?: React.MutableRefObject<number>;
  noiseConfigRef?: React.MutableRefObject<NoiseConfig | undefined>;
}

export interface SimulationCanvasHandle {
  injectDisturbance: (magnitude: number, duration?: number) => void;
  reset: () => void;
  resetViewports: () => void;
  centerRobot: () => void;
  getLiveSnapshot: () => {
    time: number;
    pv: number;
    sp: number;
    u: number;
    error: number;
    metrics: StepResponseMetrics;
    status: SimulationStatus;
  };
}

export interface SimulationCanvasProps {
  /** Optional direct connection to Stage 1 engine refs */
  engineRef?: SimulationEngineRef;

  /** Robot definition archetype */
  robot?: RobotDefinition;
  robotType?: RobotType;

  /** Fallback physics parameters if running internal engine */
  plant?: PlantParameters;
  pidConfig?: PIDConfig;
  setpoint?: number;
  isRunning?: boolean;
  speedMultiplier?: number;
  isDark?: boolean;
  noiseConfig?: NoiseConfig;

  /** Interaction callbacks (throttled/decoupled from rAF) */
  onDisturbance?: (magnitude: number, duration: number) => void;
  onMetricsUpdate?: (metrics: StepResponseMetrics) => void;
  onStatusChange?: (status: SimulationStatus) => void;

  /** Display layout mode */
  mode?: 'dual' | 'oscilloscope' | 'animation' | 'tabbed';
  className?: string;
}

// ---------------------------------------------------------------------------
// Color Palettes (Swiss Industrial Precision & Deep Slate)
// ---------------------------------------------------------------------------
const THEME = {
  dark: {
    bgOsc: '#090D16',
    bgRob: '#0A0F1A',
    gridMajor: 'rgba(34, 197, 94, 0.12)',
    gridMinor: 'rgba(34, 197, 94, 0.04)',
    axis: 'rgba(34, 197, 94, 0.3)',
    setpoint: '#FBBF24',
    pv: '#06B6D4',
    pvGlow: 'rgba(6, 182, 212, 0.45)',
    control: '#A78BFA',
    error: '#F87171',
    text: '#94A3B8',
    textBright: '#F1F5F9',
    textMuted: '#64748B',
    band: 'rgba(16, 185, 129, 0.07)',
    marker: '#10B981',
    hudBg: 'rgba(15, 23, 42, 0.88)',
    hudBorder: 'rgba(51, 65, 85, 0.65)',
    cardBg: 'rgba(30, 41, 59, 0.75)',
    ground: '#1E293B',
    groundLine: '#334155',
    metal: '#94A3B8',
    metalDark: '#1E293B',
    accent: '#06B6D4',
    accentGlow: 'rgba(6, 182, 212, 0.28)',
    warning: '#F59E0B',
    danger: '#EF4444',
    success: '#10B981',
    water: '#0E4DA4',
    waterLight: '#1E6FD9',
    sky: '#0F172A',
    particle: '#06B6D4',
    shockwave: '#F59E0B',
    dividerBg: 'rgba(30, 41, 59, 0.9)',
    dividerHandle: 'rgba(148, 163, 184, 0.5)',
    dividerActive: '#06B6D4',
  },
  light: {
    bgOsc: '#F8FAFC',
    bgRob: '#F1F5F9',
    gridMajor: 'rgba(15, 23, 42, 0.08)',
    gridMinor: 'rgba(15, 23, 42, 0.03)',
    axis: 'rgba(15, 23, 42, 0.2)',
    setpoint: '#D97706',
    pv: '#0891B2',
    pvGlow: 'rgba(8, 145, 178, 0.25)',
    control: '#7C3AED',
    error: '#DC2626',
    text: '#64748B',
    textBright: '#0F172A',
    textMuted: '#94A3B8',
    band: 'rgba(16, 185, 129, 0.05)',
    marker: '#16A34A',
    hudBg: 'rgba(255, 255, 255, 0.92)',
    hudBorder: 'rgba(203, 213, 225, 0.85)',
    cardBg: 'rgba(241, 245, 249, 0.85)',
    ground: '#E2E8F0',
    groundLine: '#CBD5E1',
    metal: '#475569',
    metalDark: '#1E293B',
    accent: '#0891B2',
    accentGlow: 'rgba(8, 145, 178, 0.2)',
    warning: '#D97706',
    danger: '#DC2626',
    success: '#16A34A',
    water: '#3B82F6',
    waterLight: '#60A5FA',
    sky: '#F8FAFC',
    particle: '#0891B2',
    shockwave: '#D97706',
    dividerBg: 'rgba(226, 232, 240, 0.9)',
    dividerHandle: 'rgba(100, 116, 139, 0.5)',
    dividerActive: '#0891B2',
  },
};

type ThemeColors = typeof THEME.dark;

// ---------------------------------------------------------------------------
// Particle & Shockwave Models
// ---------------------------------------------------------------------------
interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color?: string;
}

interface DisturbanceRipple {
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  alpha: number;
  magnitude: number;
  text: string;
}

function niceRound(value: number): number {
  if (value <= 0) return 1;
  const exp = Math.floor(Math.log10(value));
  const mantissa = value / Math.pow(10, exp);
  let nice = 1;
  if (mantissa <= 1) nice = 1;
  else if (mantissa <= 2) nice = 2;
  else if (mantissa <= 5) nice = 5;
  else nice = 10;
  return nice * Math.pow(10, exp);
}

// ============================================================================
// SimulationCanvas Component
// ============================================================================
export const SimulationCanvas = forwardRef<SimulationCanvasHandle, SimulationCanvasProps>(
  function SimulationCanvas(
    {
      engineRef,
      robot,
      robotType: propRobotType,
      plant: propPlant,
      pidConfig: propPIDConfig,
      setpoint: propSetpoint = 1.0,
      isRunning: propIsRunning = false,
      speedMultiplier: propSpeedMultiplier = 1.0,
      isDark = true,
      noiseConfig: propNoiseConfig,
      onDisturbance,
      onMetricsUpdate,
      onStatusChange,
      mode = 'dual',
      className = '',
    },
    ref
  ) {
    // ── DOM Canvas Container References ──
    const mainContainerRef = useRef<HTMLDivElement>(null);
    const oscContainerRef = useRef<HTMLDivElement>(null);
    const oscCanvasRef = useRef<HTMLCanvasElement>(null);
    const robContainerRef = useRef<HTMLDivElement>(null);
    const robCanvasRef = useRef<HTMLCanvasElement>(null);
    const dividerRef = useRef<HTMLDivElement>(null);

    // ── Viewport Dimensions ──
    const oscSizeRef = useRef({ width: 640, height: 320 });
    const robSizeRef = useRef({ width: 640, height: 320 });

    // ── Resizable Split-Pane State (Persisted in state for fluid flex-ratio) ──
    const [splitRatio, setSplitRatio] = useState<number>(0.5); // 0.5 = 50:50
    const [isDraggingSplit, setIsDraggingSplit] = useState<boolean>(false);
    const [isVerticalStack, setIsVerticalStack] = useState<boolean>(false);

    // ── Interaction Modes for Canvas 2 (2D Physics) ──
    // 'disturbance': Left click pushes robot; 'camera': Left click pans viewport
    const [robotInteractionMode, setRobotInteractionMode] = useState<'disturbance' | 'camera'>('disturbance');

    // ── Navigation Tabs ──
    const [activeTab, setActiveTab] = useState<'dual' | 'oscilloscope' | 'animation'>(
      mode === 'tabbed' ? 'dual' : mode
    );
    const [isRunaway, setIsRunaway] = useState<boolean>(false);

    // ── Interactive Viewport Panning Refs (Zero React State Thrashing) ──
    // Oscilloscope time-axis pan offset in seconds (0 = live real-time)
    const oscPanOffsetRef = useRef<number>(0);
    const isOscPanningRef = useRef<boolean>(false);
    const oscPanStartRef = useRef<{ clientX: number; initialOffset: number }>({ clientX: 0, initialOffset: 0 });

    // 2D Physics Viewport Camera: follow, relative offset in screen pixels, smoothed altitude (Track B2)
    const cameraRef = useRef<{
      follow: boolean;
      offset: { x: number; y: number };
      smoothedPV: number;
    }>({
      follow: true,
      offset: { x: 0, y: 0 },
      smoothedPV: 0,
    });
    const isCameraPanningRef = useRef<boolean>(false);
    const cameraPanStartRef = useRef<{ clientX: number; clientY: number; initOffsetX: number; initOffsetY: number }>({
      clientX: 0,
      clientY: 0,
      initOffsetX: 0,
      initOffsetY: 0,
    });
    const prefersReducedMotionRef = useRef<boolean>(false);

    // Track step start time and initial PV for accurate computeStepResponseMetrics (Track C1)
    const stepStartTimeRef = useRef<number>(0);
    const stepInitialValueRef = useRef<number>(0);
    const lastSetpointTrackRef = useRef<number>(propSetpoint);

    // ── Resolve Initial Robot Archetype ──
    const initialRobot =
      robot ||
      ROBOTS.find((r) => r.id === (propRobotType || 'quadcopter')) ||
      ROBOTS[0];

    // ── Internal Engine References (Used if external engineRef is not supplied) ──
    const internalPlantRef = useRef<PlantParameters>(propPlant || initialRobot.defaultPlant);
    const internalPIDRef = useRef<PIDConfig>(
      propPIDConfig || {
        Kp: 2.5,
        Ki: 0.6,
        Kd: 0.35,
        derivativeFilterN: 20,
        integralClamp: [-100, 100],
        derivativeOnMeasurement: true,
        antiWindupKb: 0.5,
        dt: PHYSICS_DT,
      }
    );
    const internalPlantStateRef = useRef<PlantState>(
      createPlantState(propPlant || initialRobot.defaultPlant)
    );
    const internalControllerStateRef = useRef<ControllerState>(createControllerState());
    const internalTimeRef = useRef<number>(0);
    const internalDataRef = useRef<DataPoint[]>([]);
    const internalDisturbanceRef = useRef<{ magnitude: number; endTime: number }>({
      magnitude: 0,
      endTime: 0,
    });
    const internalAccumulatorRef = useRef<AccumulatorState>(createAccumulator());
    const internalMetricsRef = useRef<StepResponseMetrics>({
      riseTime: null,
      peakOvershoot: null,
      settlingTime: null,
      steadyStateError: null,
      peakTime: null,
      peakValue: null,
      oscillationFrequency: null,
      isStable: false,
      dampingAssessment: 'unknown',
    });
    const internalStatusRef = useRef<SimulationStatus>('idle');
    const internalSetpointRef = useRef<number>(propSetpoint);
    const internalIsRunningRef = useRef<boolean>(propIsRunning);
    const internalSpeedRef = useRef<number>(propSpeedMultiplier);
    const internalNoiseRef = useRef<NoiseConfig | undefined>(propNoiseConfig);
    const internalRobotDefRef = useRef<RobotDefinition>(initialRobot);

    // ── FX State (Particles, Ripples, Smooth Y-axis Zoom) ──
    const particlesRef = useRef<Particle[]>([]);
    const ripplesRef = useRef<DisturbanceRipple[]>([]);
    const smoothYRangeRef = useRef<{ min: number; max: number }>({ min: -0.2, max: 2.0 });
    const lastMetricsCalcTimeRef = useRef<number>(0);
    const lastStatusCallbackTimeRef = useRef<number>(0);
    const rafIdRef = useRef<number | null>(null);

    // ── Synchronize Props to Mutable Refs ──
    useEffect(() => {
      if (Math.abs(propSetpoint - lastSetpointTrackRef.current) > 1e-4) {
        lastSetpointTrackRef.current = propSetpoint;
        stepStartTimeRef.current = engineRef?.timeRef?.current ?? internalTimeRef.current;
        stepInitialValueRef.current =
          engineRef?.plantStateRef?.current.measuredOutput ??
          internalPlantStateRef.current.measuredOutput ??
          0;
      }
      internalSetpointRef.current = propSetpoint;
    }, [propSetpoint, engineRef]);

    useEffect(() => { internalIsRunningRef.current = propIsRunning; }, [propIsRunning]);
    useEffect(() => { internalSpeedRef.current = propSpeedMultiplier; }, [propSpeedMultiplier]);
    useEffect(() => { if (propPIDConfig) internalPIDRef.current = propPIDConfig; }, [propPIDConfig]);
    useEffect(() => {
      if (propPlant) {
        internalPlantRef.current = propPlant;
        internalPlantStateRef.current = createPlantState(propPlant);
      }
    }, [propPlant]);
    useEffect(() => { internalNoiseRef.current = propNoiseConfig; }, [propNoiseConfig]);
    useEffect(() => {
      const selected = robot || ROBOTS.find((r) => r.id === propRobotType) || internalRobotDefRef.current;
      internalRobotDefRef.current = selected;
    }, [robot, propRobotType]);

    // Keyboard shortcut 'C' for robot centering & Prefers reduced motion detection
    useEffect(() => {
      const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
      prefersReducedMotionRef.current = mediaQuery.matches;
      const mediaHandler = (e: MediaQueryListEvent) => {
        prefersReducedMotionRef.current = e.matches;
      };
      mediaQuery.addEventListener('change', mediaHandler);

      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'c' || e.key === 'C') {
          if (
            document.activeElement?.tagName === 'INPUT' ||
            document.activeElement?.tagName === 'TEXTAREA'
          ) {
            return;
          }
          cameraRef.current.follow = true;
          cameraRef.current.offset = { x: 0, y: 0 };
        }
      };
      window.addEventListener('keydown', handleKeyDown);

      return () => {
        mediaQuery.removeEventListener('change', mediaHandler);
        window.removeEventListener('keydown', handleKeyDown);
      };
    }, []);

    // Check responsive layout orientation for split divider
    useEffect(() => {
      const checkOrientation = () => {
        setIsVerticalStack(window.innerWidth < 1024);
      };
      checkOrientation();
      window.addEventListener('resize', checkOrientation);
      return () => window.removeEventListener('resize', checkOrientation);
    }, []);

    // ── Disturbance Injection (Direct to ref) ──
    const injectDisturbanceImpulse = useCallback(
      (magnitude: number, duration: number = 0.35) => {
        const targetDisturbanceRef = engineRef?.disturbanceRef || internalDisturbanceRef;
        const targetTimeRef = engineRef?.timeRef || internalTimeRef;

        targetDisturbanceRef.current = {
          magnitude,
          endTime: targetTimeRef.current + duration,
        };

        const w = robSizeRef.current.width;
        const h = robSizeRef.current.height;
        const cam = cameraRef.current.offset;

        ripplesRef.current.push({
          x: w * 0.5 + cam.x + (Math.random() - 0.5) * 30,
          y: h * 0.5 + cam.y + (Math.random() - 0.5) * 30,
          radius: 12,
          maxRadius: Math.min(w, h) * 0.45,
          alpha: 1.0,
          magnitude,
          text: `⚡ GANGGUAN: ${magnitude > 0 ? '+' : ''}${magnitude.toFixed(1)} N`,
        });

        for (let i = 0; i < 24; i++) {
          const angle = Math.random() * Math.PI * 2;
          const speed = 30 + Math.random() * 90;
          particlesRef.current.push({
            x: w * 0.5 + cam.x,
            y: h * 0.5 + cam.y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            life: 1.0,
            maxLife: 0.4 + Math.random() * 0.4,
            size: 2 + Math.random() * 3,
            color: '#F59E0B',
          });
        }

        if (onDisturbance) onDisturbance(magnitude, duration);
      },
      [engineRef, onDisturbance]
    );

    // ── Emergency Reset ──
    const handleReset = useCallback(() => {
      const plantToReset = engineRef?.plantRef?.current || internalPlantRef.current;
      const targetPlantStateRef = engineRef?.plantStateRef || internalPlantStateRef;
      const targetControllerRef = engineRef?.controllerStateRef || internalControllerStateRef;
      const targetTimeRef = engineRef?.timeRef || internalTimeRef;
      const targetDataRef = engineRef?.dataRef || internalDataRef;
      const targetDisturbanceRef = engineRef?.disturbanceRef || internalDisturbanceRef;
      const targetAccumulatorRef = engineRef?.accumulatorRef || internalAccumulatorRef;
      const targetStatusRef = engineRef?.statusRef || internalStatusRef;

      targetPlantStateRef.current = createPlantState(plantToReset);
      targetControllerRef.current = createControllerState();
      targetTimeRef.current = 0;
      targetDataRef.current = [];
      targetDisturbanceRef.current = { magnitude: 0, endTime: 0 };
      if (targetAccumulatorRef) targetAccumulatorRef.current = createAccumulator();
      if (targetStatusRef) targetStatusRef.current = 'idle';

      smoothYRangeRef.current = { min: -0.2, max: 2.0 };
      particlesRef.current = [];
      ripplesRef.current = [];
      oscPanOffsetRef.current = 0;
      cameraRef.current = { follow: true, offset: { x: 0, y: 0 }, smoothedPV: 0 };
      stepStartTimeRef.current = 0;
      stepInitialValueRef.current = 0;
      setIsRunaway(false);
    }, [engineRef]);

    // ── Reset Viewports Panning & Camera (Track B2) ──
    const handleResetViewports = useCallback(() => {
      oscPanOffsetRef.current = 0;
      cameraRef.current = { follow: true, offset: { x: 0, y: 0 }, smoothedPV: cameraRef.current.smoothedPV };
      setSplitRatio(0.5);
    }, []);

    // ── Center Robot Viewport Camera (Track B2: Shortcut C / Crosshair button) ──
    const handleCenterRobot = useCallback(() => {
      cameraRef.current = { follow: true, offset: { x: 0, y: 0 }, smoothedPV: cameraRef.current.smoothedPV };
    }, []);

    // ── Imperative Handle ──
    useImperativeHandle(
      ref,
      () => ({
        injectDisturbance: injectDisturbanceImpulse,
        reset: handleReset,
        resetViewports: handleResetViewports,
        centerRobot: handleCenterRobot,
        getLiveSnapshot: () => {
          const data = engineRef?.dataRef.current || internalDataRef.current;
          const lastPoint = data.length > 0 ? data[data.length - 1] : null;
          const time = engineRef?.timeRef.current || internalTimeRef.current;
          const metrics = engineRef?.metricsRef?.current || internalMetricsRef.current;
          const status = engineRef?.statusRef?.current || internalStatusRef.current;
          const sp = engineRef?.setpointRef?.current ?? internalSetpointRef.current;

          return {
            time,
            pv: lastPoint?.processVariable ?? 0,
            sp: lastPoint?.setpoint ?? sp,
            u: lastPoint?.controlEffort ?? 0,
            error: lastPoint?.error ?? 0,
            metrics,
            status,
          };
        },
      }),
      [engineRef, injectDisturbanceImpulse, handleReset, handleResetViewports, handleCenterRobot]
    );

    // ========================================================================
    // 1. DRAGGABLE SPLIT DIVIDER LOGIC (Pointer Capture + Safety Clamping)
    // ========================================================================
    const handleDividerPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      setIsDraggingSplit(true);
    };

    const handleDividerPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isDraggingSplit || !mainContainerRef.current) return;
      e.preventDefault();

      const rect = mainContainerRef.current.getBoundingClientRect();

      let newRatio: number;
      if (!isVerticalStack) {
        // Horizontal Split (Desktop)
        const offsetX = e.clientX - rect.left;
        newRatio = offsetX / rect.width;
      } else {
        // Vertical Split (Mobile/Stacked)
        const offsetY = e.clientY - rect.top;
        newRatio = offsetY / rect.height;
      }

      // Safety clamping between 20% and 80%
      const clamped = clamp(newRatio, 0.2, 0.8);
      setSplitRatio(clamped);

      // Trigger immediate canvas buffer sync
      if (oscContainerRef.current) {
        oscSizeRef.current = {
          width: Math.max(160, Math.floor(oscContainerRef.current.clientWidth)),
          height: Math.max(120, Math.floor(oscContainerRef.current.clientHeight)),
        };
      }
      if (robContainerRef.current) {
        robSizeRef.current = {
          width: Math.max(160, Math.floor(robContainerRef.current.clientWidth)),
          height: Math.max(120, Math.floor(robContainerRef.current.clientHeight)),
        };
      }
    };

    const handleDividerPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {}
      setIsDraggingSplit(false);
    };

    const handleDividerDoubleClick = () => {
      // Quick Action: Reset split ratio back to exact 50:50
      setSplitRatio(0.5);
    };

    // ========================================================================
    // 2. OSCILLOSCOPE TIME-AXIS PANNING (Click-drag horizontally to review past)
    // ========================================================================
    const handleOscPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      isOscPanningRef.current = true;
      oscPanStartRef.current = {
        clientX: e.clientX,
        initialOffset: oscPanOffsetRef.current,
      };
    };

    const handleOscPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!isOscPanningRef.current) return;
      e.preventDefault();

      const deltaX = e.clientX - oscPanStartRef.current.clientX;
      const plotW = oscSizeRef.current.width - 62; // approximate plot width
      const data = engineRef?.dataRef.current || internalDataRef.current;
      const timeSpan = data.length > 1 ? Math.max(data[data.length - 1].time - data[0].time, 1) : 10;

      // Convert pixel delta into seconds
      const deltaSec = (deltaX / plotW) * (timeSpan * 0.8);
      const newOffset = oscPanStartRef.current.initialOffset + deltaSec;

      // Can only pan backwards in time (offset <= 0), min bound to total time span
      oscPanOffsetRef.current = clamp(newOffset, -Math.max(timeSpan - 1, 0), 0);
    };

    const handleOscPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {}
      isOscPanningRef.current = false;
    };

    const handleOscDoubleClick = () => {
      // Double click resets to live streaming
      oscPanOffsetRef.current = 0;
    };

    // ========================================================================
    // 3. 2D PHYSICS CAMERA PAN VS DISTURBANCE INTERACTION RESOLUTION
    // ========================================================================
    const handleRobotPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      const canvas = robCanvasRef.current;
      if (!canvas) return;
      canvas.setPointerCapture(e.pointerId);

      const isRightClick = e.button === 2;
      const isMiddleClick = e.button === 1;
      const isSpaceOrShift = e.shiftKey || e.altKey;
      const isCameraMode = robotInteractionMode === 'camera' || isRightClick || isMiddleClick || isSpaceOrShift;

      if (isCameraMode) {
        // Start Camera Panning (Track B2: relative offset to robot)
        isCameraPanningRef.current = true;
        cameraPanStartRef.current = {
          clientX: e.clientX,
          clientY: e.clientY,
          initOffsetX: cameraRef.current.offset.x,
          initOffsetY: cameraRef.current.offset.y,
        };
      } else {
        // Inject Disturbance (Primary Left Click)
        const rect = canvas.getBoundingClientRect();
        const touchX = e.clientX - rect.left - cameraRef.current.offset.x;
        const normOffsetX = (touchX - rect.width / 2) / (rect.width / 2);

        const currentPlant = engineRef?.plantRef?.current || internalPlantRef.current;
        const sign = normOffsetX < 0 ? -1 : 1;
        const forceMagnitude = sign * Math.max(1.8, Math.abs(normOffsetX) * currentPlant.gain * 5.0);

        injectDisturbanceImpulse(forceMagnitude, 0.4);

        ripplesRef.current.push({
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
          radius: 8,
          maxRadius: Math.min(rect.width, rect.height) * 0.38,
          alpha: 1.0,
          magnitude: forceMagnitude,
          text: `💥 ${forceMagnitude > 0 ? '+' : ''}${forceMagnitude.toFixed(1)} N`,
        });
      }
    };

    const handleRobotPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!isCameraPanningRef.current) return;
      e.preventDefault();

      const dx = e.clientX - cameraPanStartRef.current.clientX;
      const dy = e.clientY - cameraPanStartRef.current.clientY;

      const w = robSizeRef.current.width;
      const h = robSizeRef.current.height;

      // Track B2 / B3: Clamp camera offset so robot center is always >= 48px inside canvas edges
      const minX = 48 - w / 2;
      const maxX = w / 2 - 48;
      const minY = 48 - h / 2;
      const maxY = h / 2 - 48;

      cameraRef.current.offset = {
        x: clamp(cameraPanStartRef.current.initOffsetX + dx, minX, maxX),
        y: clamp(cameraPanStartRef.current.initOffsetY + dy, minY, maxY),
      };
    };

    const handleRobotPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {}
      isCameraPanningRef.current = false;
    };

    const handleRobotDoubleClick = () => {
      // Double click resets camera back to robot center (Track B2)
      cameraRef.current.follow = true;
      cameraRef.current.offset = { x: 0, y: 0 };
    };

    // ── Resize Observer for High-DPI Canvas Resizing ──
    useEffect(() => {
      const oscContainer = oscContainerRef.current;
      const robContainer = robContainerRef.current;

      const observer = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const { width, height } = entry.contentRect;
          const w = Math.max(160, Math.floor(width));
          const h = Math.max(120, Math.floor(height));

          if (entry.target === oscContainer) {
            oscSizeRef.current = { width: w, height: h };
          } else if (entry.target === robContainer) {
            robSizeRef.current = { width: w, height: h };
          }
        }
      });

      if (oscContainer) observer.observe(oscContainer);
      if (robContainer) observer.observe(robContainer);

      return () => observer.disconnect();
    }, [activeTab, splitRatio]);

    // ========================================================================
    // PRIMARY RENDER & PHYSICS LOOP (Synchronized requestAnimationFrame)
    // Runs with ZERO React useState calls inside tick loop.
    // ========================================================================
    useEffect(() => {
      let isMounted = true;

      const tick = (nowMs: number) => {
        if (!isMounted) return;

        const isRunning = engineRef?.isRunningRef?.current ?? internalIsRunningRef.current;
        const speed = engineRef?.speedMultiplierRef?.current ?? internalSpeedRef.current;
        const setpoint = engineRef?.setpointRef?.current ?? internalSetpointRef.current;
        const pidConfig = engineRef?.pidConfigRef?.current || internalPIDRef.current;
        const plant = engineRef?.plantRef?.current || internalPlantRef.current;
        const noiseConfig = engineRef?.noiseConfigRef?.current || internalNoiseRef.current;
        const robotDef = internalRobotDefRef.current;

        // Resolve Engine Refs
        const plantStateRef = engineRef?.plantStateRef || internalPlantStateRef;
        const controllerStateRef = engineRef?.controllerStateRef || internalControllerStateRef;
        const timeRef = engineRef?.timeRef || internalTimeRef;
        const dataRef = engineRef?.dataRef || internalDataRef;
        const disturbanceRef = engineRef?.disturbanceRef || internalDisturbanceRef;
        const accumulatorRef = engineRef?.accumulatorRef || internalAccumulatorRef;
        const statusRef = engineRef?.statusRef || internalStatusRef;
        const metricsRef = engineRef?.metricsRef || internalMetricsRef;

        // 1. Semi-Fixed Timestep Physics Step
        if (isRunning && statusRef.current !== 'runaway') {
          const { steps } = advanceAccumulator(accumulatorRef.current, nowMs, speed);

          for (let s = 0; s < steps; s++) {
            const t = timeRef.current;
            let activeDist = 0;
            if (t < disturbanceRef.current.endTime) {
              activeDist = disturbanceRef.current.magnitude;
            }

            const stepResult = simulationStep(
              setpoint,
              plantStateRef.current,
              controllerStateRef.current,
              plant,
              pidConfig,
              activeDist,
              noiseConfig,
              robotDef.gravityInRadians ?? false,
              robotDef.divergenceLimit ?? 1e6
            );

            plantStateRef.current = stepResult.plantState;
            controllerStateRef.current = stepResult.controllerState;
            statusRef.current = stepResult.status;

            if (stepResult.status === 'runaway') {
              setIsRunaway(true);
              break;
            }

            const pv = stepResult.processVariable;
            const u = stepResult.controlEffort;
            const error = setpoint - pv;
            timeRef.current += PHYSICS_DT;

            const history = dataRef.current;
            if (history.length === 0 || t - history[history.length - 1].time >= 0.01) {
              history.push({
                time: t,
                setpoint,
                processVariable: pv,
                controlEffort: u,
                error,
                pTerm: stepResult.controllerState.pTerm,
                iTerm: stepResult.controllerState.iTerm,
                dTerm: stepResult.controllerState.dTerm,
              });
              if (history.length > 2500) history.shift();
            }
          }
        }

        // 2. Periodic Response Metrics Calculation (Throttled outside rAF)
        const historyData = dataRef.current;
        if (nowMs - lastMetricsCalcTimeRef.current > 120 && historyData.length > 10) {
          lastMetricsCalcTimeRef.current = nowMs;
          const computed = computeStepResponseMetrics(historyData, setpoint, {
            stepStartTime: stepStartTimeRef.current,
            initialValue: stepInitialValueRef.current,
            actuatorLimits: plant.actuatorLimits,
          });
          metricsRef.current = computed;
          if (onMetricsUpdate) onMetricsUpdate(computed);
        }

        if (nowMs - lastStatusCallbackTimeRef.current > 250 && onStatusChange) {
          lastStatusCallbackTimeRef.current = nowMs;
          onStatusChange(statusRef.current);
        }

        // 3. Update Particulate Dynamics & Ripples
        const dt = 0.016;
        const currentParticles = particlesRef.current;
        for (let i = currentParticles.length - 1; i >= 0; i--) {
          const p = currentParticles[i];
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.vy += 45 * dt;
          p.life -= dt / p.maxLife;
          if (p.life <= 0) currentParticles.splice(i, 1);
        }

        const currentRipples = ripplesRef.current;
        for (let i = currentRipples.length - 1; i >= 0; i--) {
          const r = currentRipples[i];
          r.radius += (r.maxRadius - r.radius) * 0.12 + 1.8;
          r.alpha -= 0.025;
          if (r.alpha <= 0 || r.radius >= r.maxRadius) currentRipples.splice(i, 1);
        }

        // 4. Render Canvas 1: Oscilloscope with Panning
        if (activeTab === 'dual' || activeTab === 'oscilloscope') {
          renderOscilloscope(
            oscCanvasRef.current,
            oscSizeRef.current.width,
            oscSizeRef.current.height,
            isDark ? THEME.dark : THEME.light,
            historyData,
            metricsRef.current,
            setpoint,
            timeRef.current,
            statusRef.current,
            smoothYRangeRef.current,
            oscPanOffsetRef.current
          );
        }

        // 5. Render Canvas 2: 2D Robot Viewport with Camera Follow & Relative Panning (Track B2)
        if (activeTab === 'dual' || activeTab === 'animation') {
          const lastPoint = historyData.length > 0 ? historyData[historyData.length - 1] : null;
          const livePV = lastPoint?.processVariable ?? plantStateRef.current.measuredOutput ?? 0;
          const liveU = lastPoint?.controlEffort ?? controllerStateRef.current.controlOutput ?? 0;

          // Camera follow smoothing (lerp 0.15, respects prefers-reduced-motion)
          const lerpFactor = prefersReducedMotionRef.current ? 1.0 : 0.15;
          if (cameraRef.current.follow) {
            cameraRef.current.smoothedPV += (livePV - cameraRef.current.smoothedPV) * lerpFactor;
          }

          renderRobotViewport(
            robCanvasRef.current,
            robSizeRef.current.width,
            robSizeRef.current.height,
            isDark ? THEME.dark : THEME.light,
            robotDef.id,
            livePV,
            setpoint,
            liveU,
            timeRef.current,
            currentParticles,
            currentRipples,
            statusRef.current,
            disturbanceRef.current.endTime > timeRef.current,
            cameraRef.current
          );
        }

        rafIdRef.current = requestAnimationFrame(tick);
      };

      rafIdRef.current = requestAnimationFrame(tick);

      return () => {
        isMounted = false;
        if (rafIdRef.current !== null) {
          cancelAnimationFrame(rafIdRef.current);
          rafIdRef.current = null;
        }
      };
    }, [engineRef, activeTab, isDark, onMetricsUpdate, onStatusChange]);

    const activeColors = isDark ? THEME.dark : THEME.light;

    return (
      <div
        className={`w-full h-full flex flex-col relative select-none ${className}`}
        style={{ backgroundColor: activeColors.bgOsc }}
      >
        {/* ── TOP CONTROL HUD & INTERACTION BAR (Z-35) ── */}
        <div
          className="flex flex-wrap items-center justify-between gap-1.5 px-3 py-1.5 border-b z-35 text-xs font-mono shrink-0 overflow-x-auto min-w-0"
          style={{
            backgroundColor: activeColors.hudBg,
            borderColor: activeColors.hudBorder,
            color: activeColors.text,
          }}
        >
          {/* Left: Viewport Mode Tabs */}
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setActiveTab('dual')}
              className={`px-2.5 py-1 rounded transition-colors flex items-center gap-1 text-[11px] font-semibold ${
                activeTab === 'dual'
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 shadow-sm'
                  : 'hover:bg-white/5 opacity-70 hover:opacity-100'
              }`}
              title="Tampilkan Bersebelahan (Bisa Digeser Boundary)"
            >
              <Layers size={12} />
              <span>Dual Split</span>
            </button>
            <button
              onClick={() => setActiveTab('oscilloscope')}
              className={`px-2.5 py-1 rounded transition-colors flex items-center gap-1 text-[11px] font-semibold ${
                activeTab === 'oscilloscope'
                  ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/40 shadow-sm'
                  : 'hover:bg-white/5 opacity-70 hover:opacity-100'
              }`}
              title="Fokus Penuh Oscilloscope"
            >
              <Monitor size={12} />
              <span>Oscilloscope</span>
            </button>
            <button
              onClick={() => setActiveTab('animation')}
              className={`px-2.5 py-1 rounded transition-colors flex items-center gap-1 text-[11px] font-semibold ${
                activeTab === 'animation'
                  ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40 shadow-sm'
                  : 'hover:bg-white/5 opacity-70 hover:opacity-100'
              }`}
              title="Fokus Penuh Kinematika 2D"
            >
              <span>{internalRobotDefRef.current.icon}</span>
              <span>2D Physics</span>
            </button>
          </div>

          {/* Center: Camera / Disturbance Mode Toggle for Canvas 2 */}
          {(activeTab === 'dual' || activeTab === 'animation') && (
            <div className="hidden sm:flex items-center bg-black/25 border border-white/10 rounded-md p-0.5 text-[10px]">
              <button
                onClick={() => setRobotInteractionMode('disturbance')}
                className={`px-2 py-0.5 rounded transition-all flex items-center gap-1 ${
                  robotInteractionMode === 'disturbance'
                    ? 'bg-amber-500/20 text-amber-400 font-bold border border-amber-500/30'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Klik kiri mendorong robot (injeksi gaya gangguan)"
              >
                <Zap size={10} />
                <span>Klik: Dorong</span>
              </button>
              <button
                onClick={() => setRobotInteractionMode('camera')}
                className={`px-2 py-0.5 rounded transition-all flex items-center gap-1 ${
                  robotInteractionMode === 'camera'
                    ? 'bg-cyan-500/20 text-cyan-400 font-bold border border-cyan-500/30'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Klik kiri menggeser kamera viewport (Pan)"
              >
                <Move size={10} />
                <span>Klik: Pan Kamera</span>
              </button>
            </div>
          )}

          {/* Right: Quick Disturbance, Camera Centering/Reset & Engine Panic Buttons */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              onClick={() => injectDisturbanceImpulse(4.5, 0.35)}
              className="px-2.5 py-1 rounded bg-amber-500/15 hover:bg-amber-500/25 text-amber-400 border border-amber-500/30 text-[10px] flex items-center gap-1 transition-all active:scale-95 shadow-sm"
              title="Injeksi gangguan gaya +4.5N seketika"
            >
              <Zap size={11} className="animate-pulse" />
              <span>+4.5N Push</span>
            </button>
            <button
              onClick={handleCenterRobot}
              className="px-2 py-1 rounded bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-400 border border-cyan-500/30 text-[10px] flex items-center gap-1 transition-all active:scale-95 shadow-sm"
              title="Pusatkan kamera pada robot (Shortcut: C)"
            >
              <Crosshair size={11} />
              <span>Pusatkan</span>
            </button>
            <button
              onClick={handleResetViewports}
              className="px-2 py-1 rounded bg-slate-700/30 hover:bg-slate-700/50 text-slate-300 border border-white/10 text-[10px] flex items-center gap-1 transition-all active:scale-95"
              title="Reset zoom/pan kamera dan rasio split 50:50"
            >
              <Compass size={11} />
              <span className="hidden md:inline">Reset View</span>
            </button>
            <button
              onClick={handleReset}
              className="px-2 py-1 rounded bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/30 text-[10px] flex items-center gap-1 transition-all active:scale-95"
              title="Reset state fisis plant ke 0"
            >
              <RotateCcw size={11} />
              <span>Reset Plant</span>
            </button>
          </div>
        </div>

        {/* ── RUNAWAY SAFETY OVERLAY BANNER (Layman Safety Catch) ── */}
        {isRunaway && (
          <div className="absolute top-11 inset-x-4 z-50 bg-rose-950/95 border border-rose-500 text-rose-200 px-4 py-3 rounded-xl shadow-2xl backdrop-blur-md flex items-center justify-between animate-bounce">
            <div className="flex items-center gap-3">
              <AlertTriangle className="text-rose-400 shrink-0" size={24} />
              <div>
                <p className="font-bold text-sm">Sistem Kehilangan Kendali (Physics Divergence)</p>
                <p className="text-xs text-rose-300">
                  Gaya dorong terlalu kuat atau gain PID tidak stabil. Klik tombol pulihkan untuk mereset robot.
                </p>
              </div>
            </div>
            <button
              onClick={handleReset}
              className="px-4 py-1.5 rounded-lg bg-rose-500 hover:bg-rose-600 text-white font-bold text-xs shadow-lg active:scale-95 transition-all"
            >
              Pulihkan Robot
            </button>
          </div>
        )}

        {/* ── DUAL VIEWPORT CONTAINER (With Draggable Split-Pane) ── */}
        <div
          ref={mainContainerRef}
          className={`flex-1 w-full h-full relative overflow-hidden flex ${
            isVerticalStack ? 'flex-col' : 'flex-row'
          }`}
        >
          {/* VIEWPORT 1: OSCILLOSCOPE (Time-Series Plotting with Historical Drag Pan) */}
          <div
            ref={oscContainerRef}
            className={`relative h-full overflow-hidden transition-none ${
              activeTab === 'animation' ? 'hidden' : 'flex'
            }`}
            style={{
              flex: activeTab === 'dual' ? `${splitRatio} 1 0%` : '1 1 100%',
              minWidth: activeTab === 'dual' && !isVerticalStack ? '20%' : undefined,
              maxWidth: activeTab === 'dual' && !isVerticalStack ? '80%' : undefined,
              minHeight: activeTab === 'dual' && isVerticalStack ? '20%' : undefined,
              maxHeight: activeTab === 'dual' && isVerticalStack ? '80%' : undefined,
              touchAction: 'none',
            }}
          >
            <canvas
              ref={oscCanvasRef}
              onPointerDown={handleOscPointerDown}
              onPointerMove={handleOscPointerMove}
              onPointerUp={handleOscPointerUp}
              onDoubleClick={handleOscDoubleClick}
              className="w-full h-full block cursor-ew-resize active:cursor-grabbing"
              style={{ display: 'block', touchAction: 'none' }}
              title="Tarik horizontal untuk menggeser rekaman masa lalu (Pan). Dobel klik untuk live."
            />
          </div>

          {/* DRAGGABLE SPLIT DIVIDER HANDLE (Visible only in Dual Mode) */}
          {activeTab === 'dual' && (
            <div
              ref={dividerRef}
              onPointerDown={handleDividerPointerDown}
              onPointerMove={handleDividerPointerMove}
              onPointerUp={handleDividerPointerUp}
              onDoubleClick={handleDividerDoubleClick}
              className={`z-30 select-none flex items-center justify-center transition-colors group ${
                isVerticalStack
                  ? 'h-2 w-full cursor-row-resize border-y'
                  : 'w-2 h-full cursor-col-resize border-x'
              }`}
              style={{
                backgroundColor: isDraggingSplit ? activeColors.dividerActive : activeColors.dividerBg,
                borderColor: isDraggingSplit ? activeColors.dividerActive : activeColors.hudBorder,
                touchAction: 'none',
              }}
              title="Tarik untuk mengubah ukuran split. Dobel klik untuk reset 50:50."
            >
              <div
                className={`flex items-center justify-center rounded-full transition-transform group-hover:scale-125 ${
                  isDraggingSplit ? 'bg-cyan-400 text-slate-900 shadow-md' : 'bg-slate-700 text-slate-400'
                }`}
                style={{ width: isVerticalStack ? '36px' : '6px', height: isVerticalStack ? '6px' : '36px' }}
              >
                {isVerticalStack ? <GripHorizontal size={10} /> : <GripVertical size={10} />}
              </div>
            </div>
          )}

          {/* VIEWPORT 2: 2D ROBOT PHYSICS (Kinematic 2D Physics + Camera Drag Pan) */}
          <div
            ref={robContainerRef}
            className={`relative h-full overflow-hidden transition-none ${
              activeTab === 'oscilloscope' ? 'hidden' : 'flex'
            }`}
            style={{
              flex: activeTab === 'dual' ? `${1 - splitRatio} 1 0%` : '1 1 100%',
              minWidth: activeTab === 'dual' && !isVerticalStack ? '20%' : undefined,
              maxWidth: activeTab === 'dual' && !isVerticalStack ? '80%' : undefined,
              minHeight: activeTab === 'dual' && isVerticalStack ? '20%' : undefined,
              maxHeight: activeTab === 'dual' && isVerticalStack ? '80%' : undefined,
              touchAction: 'none',
            }}
          >
            <canvas
              ref={robCanvasRef}
              onPointerDown={handleRobotPointerDown}
              onPointerMove={handleRobotPointerMove}
              onPointerUp={handleRobotPointerUp}
              onDoubleClick={handleRobotDoubleClick}
              onContextMenu={(e) => e.preventDefault()}
              className={`w-full h-full block ${
                robotInteractionMode === 'camera'
                  ? 'cursor-grab active:cursor-grabbing'
                  : 'cursor-crosshair active:cursor-grabbing'
              }`}
              style={{ display: 'block', touchAction: 'none' }}
              title="Klik kiri: Injeksi gangguan. Klik kanan / Shift+Tarik: Pan kamera. Dobel klik: Reset kamera."
            />
          </div>
        </div>
      </div>
    );
  }
);

// ============================================================================
// Canvas 1: Multi-Trace Oscilloscope with Interactive Time-Axis Panning
// ============================================================================
function renderOscilloscope(
  canvas: HTMLCanvasElement | null,
  w: number,
  h: number,
  c: ThemeColors,
  data: DataPoint[],
  metrics: StepResponseMetrics,
  setpoint: number,
  simTime: number,
  status: SimulationStatus,
  smoothYRange: { min: number; max: number },
  panOffsetSec: number
) {
  if (!canvas || w <= 0 || h <= 0) return;

  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
  }

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // Background
  ctx.fillStyle = c.bgOsc;
  ctx.fillRect(0, 0, w, h);

  const padding = { top: 64, right: 18, bottom: 30, left: 48 };
  const plotW = Math.max(10, w - padding.left - padding.right);
  const plotH = Math.max(10, h - padding.top - padding.bottom);

  if (data.length < 2) {
    ctx.fillStyle = c.textMuted;
    ctx.font = '12px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('📡 Menunggu streaming data simulasi...', w / 2, h / 2);
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.fillText('Tekan tombol Play di dashboard untuk memulai', w / 2, h / 2 + 20);
    return;
  }

  // Calculate Time Window with Pan Offset
  const rawTMax = data[data.length - 1].time;
  const tMax = rawTMax + panOffsetSec;
  const rawTimeSpan = Math.max(rawTMax - data[0].time, 0.1);
  const timeWindowSpan = Math.min(rawTimeSpan, 15); // Show latest 15s window by default
  const tMin = Math.max(tMax - timeWindowSpan, 0);
  const timeSpan = Math.max(tMax - tMin, 0.1);

  // Auto-Scale Y Axis
  let targetYMin = Math.min(setpoint, 0);
  let targetYMax = Math.max(setpoint, 0.1);

  const dataLen = data.length;
  for (let i = 0; i < dataLen; i += Math.max(1, Math.floor(dataLen / 100))) {
    const pt = data[i];
    if (pt.time >= tMin && pt.time <= tMax) {
      if (pt.processVariable < targetYMin) targetYMin = pt.processVariable;
      if (pt.processVariable > targetYMax) targetYMax = pt.processVariable;
    }
  }

  const margin = Math.max((targetYMax - targetYMin) * 0.18, 0.4);
  targetYMin -= margin;
  targetYMax += margin;

  smoothYRange.min += (targetYMin - smoothYRange.min) * 0.08;
  smoothYRange.max += (targetYMax - smoothYRange.max) * 0.08;

  const yMin = smoothYRange.min;
  const yMax = smoothYRange.max;
  const ySpan = Math.max(yMax - yMin, 0.001);

  const mapX = (t: number) => padding.left + ((t - tMin) / timeSpan) * plotW;
  const mapY = (val: number) => padding.top + (1 - (val - yMin) / ySpan) * plotH;

  // ── Grid Lines ──
  const dyGrid = niceRound(ySpan / 5);
  ctx.strokeStyle = c.gridMinor;
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 4]);

  let yVal = Math.ceil(yMin / dyGrid) * dyGrid;
  while (yVal <= yMax) {
    const yPos = mapY(yVal);
    ctx.beginPath();
    ctx.moveTo(padding.left, yPos);
    ctx.lineTo(padding.left + plotW, yPos);
    ctx.stroke();

    ctx.fillStyle = c.textMuted;
    ctx.font = '9px "JetBrains Mono", monospace';
    ctx.textAlign = 'right';
    ctx.fillText(yVal.toFixed(1), padding.left - 5, yPos + 3);
    yVal += dyGrid;
  }

  const dxGrid = niceRound(timeSpan / 6);
  let tVal = Math.ceil(tMin / dxGrid) * dxGrid;
  while (tVal <= tMax) {
    const xPos = mapX(tVal);
    ctx.beginPath();
    ctx.moveTo(xPos, padding.top);
    ctx.lineTo(xPos, padding.top + plotH);
    ctx.stroke();

    ctx.fillStyle = c.textMuted;
    ctx.font = '9px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`${tVal.toFixed(1)}s`, xPos, h - 8);
    tVal += dxGrid;
  }
  ctx.setLineDash([]);

  // ── 2% Settling Band ──
  if (Math.abs(setpoint) > 1e-4) {
    const bandHeight = Math.abs(setpoint) * 0.02;
    const bandTop = mapY(setpoint + bandHeight);
    const bandBot = mapY(setpoint - bandHeight);
    ctx.fillStyle = c.band;
    ctx.fillRect(padding.left, Math.min(bandTop, bandBot), plotW, Math.abs(bandBot - bandTop));
  }

  // ── Zero Baseline ──
  if (yMin <= 0 && yMax >= 0) {
    const zeroY = mapY(0);
    ctx.strokeStyle = c.axis;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padding.left, zeroY);
    ctx.lineTo(padding.left + plotW, zeroY);
    ctx.stroke();
  }

  // ── Setpoint Line (SP) ──
  const spY = mapY(setpoint);
  ctx.strokeStyle = c.setpoint;
  ctx.lineWidth = 1.6;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(padding.left, spY);
  ctx.lineTo(padding.left + plotW, spY);
  ctx.stroke();
  ctx.setLineDash([]);

  // ── Signal Trace Curves ──
  const renderCurve = (
    key: keyof DataPoint,
    strokeColor: string,
    width: number,
    alpha: number = 1.0,
    scale: number = 1.0
  ) => {
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = width;
    ctx.globalAlpha = alpha;
    ctx.beginPath();

    let started = false;
    for (let i = 0; i < dataLen; i++) {
      const pt = data[i];
      if (pt.time < tMin - 0.2 || pt.time > tMax + 0.2) continue;

      const val = (pt[key] as number) * scale;
      const px = mapX(pt.time);
      const py = mapY(val);

      if (!started) {
        ctx.moveTo(px, py);
        started = true;
      } else {
        ctx.lineTo(px, py);
      }
    }
    ctx.stroke();
    ctx.globalAlpha = 1.0;
  };

  // Trace 1: Output u(t) (Violet)
  renderCurve('controlEffort', c.control, 1.2, 0.75, 0.25);

  // Trace 2: Error e(t) (Rose)
  renderCurve('error', c.error, 1.0, 0.45, 1.0);

  // Trace 3: Process Variable PV (Cyan with Glow)
  ctx.shadowColor = c.pvGlow;
  ctx.shadowBlur = 8;
  renderCurve('processVariable', c.pv, 2.2, 1.0, 1.0);
  ctx.shadowBlur = 0;

  // ── Peak Overshoot Marker ──
  if (metrics.peakTime !== null && metrics.peakValue !== null) {
    if (metrics.peakTime >= tMin && metrics.peakTime <= tMax) {
      const px = mapX(metrics.peakTime);
      const py = mapY(metrics.peakValue);
      ctx.fillStyle = c.marker;
      ctx.beginPath();
      ctx.arc(px, py, 4, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = c.textBright;
      ctx.font = 'bold 9px "JetBrains Mono", monospace';
      ctx.textAlign = 'left';
      ctx.fillText(`Peak: ${metrics.peakValue.toFixed(2)} (${metrics.peakTime.toFixed(2)}s)`, px + 6, py - 4);
    }
  }

  // ── Historical Time-Panning Tag ──
  if (panOffsetSec < -0.05) {
    ctx.fillStyle = 'rgba(245, 158, 11, 0.9)';
    ctx.fillRect(padding.left + 4, padding.top + 6, 210, 20);
    ctx.fillStyle = '#0F172A';
    ctx.font = 'bold 9px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`⏪ REWIND (${Math.abs(panOffsetSec).toFixed(1)}s lalu) - Dobel klik LIVE`, padding.left + 8, padding.top + 20);
  }

  // ── HUD METRICS HEADER ──
  renderHUDMetrics(ctx, w, c, metrics, status, data[data.length - 1], setpoint, simTime);
}

// ---------------------------------------------------------------------------
// HUD Telemetry Overlay on Canvas 1
// ---------------------------------------------------------------------------
function renderHUDMetrics(
  ctx: CanvasRenderingContext2D,
  w: number,
  c: ThemeColors,
  metrics: StepResponseMetrics,
  status: SimulationStatus,
  lastPoint: DataPoint | undefined,
  setpoint: number,
  simTime: number
) {
  ctx.fillStyle = c.hudBg;
  ctx.fillRect(8, 8, w - 16, 48);
  ctx.strokeStyle = c.hudBorder;
  ctx.lineWidth = 1;
  ctx.strokeRect(8, 8, w - 16, 48);

  let statusText = 'STABIL (SETTLED)';
  let badgeColor = c.success;

  const currentErr = lastPoint ? Math.abs(lastPoint.error) : 0;
  const isUnsettled =
    metrics.settlingTime === null ||
    !Number.isFinite(metrics.settlingTime) ||
    (metrics.steadyStateError !== null && Math.abs(metrics.steadyStateError) > 0.05 * Math.max(Math.abs(setpoint), 1)) ||
    currentErr > 0.05 * Math.max(Math.abs(setpoint), 1);

  if (status === 'runaway') {
    statusText = 'RUNAWAY (TERHEMPAS)';
    badgeColor = c.danger;
  } else if (status === 'idle') {
    statusText = 'STANDBY';
    badgeColor = c.textMuted;
  } else if (isUnsettled || status === 'running') {
    statusText = 'TRANSIEN (MENDEKATI TARGET)';
    badgeColor = c.warning;
  } else if (status === 'oscillating' || metrics.dampingAssessment === 'underdamped') {
    statusText = 'UNDERDAMPED (MEMBAL)';
    badgeColor = c.warning;
  }

  ctx.fillStyle = badgeColor;
  ctx.beginPath();
  ctx.arc(22, 23, 4, 0, Math.PI * 2);
  ctx.fill();

  ctx.font = 'bold 10px "JetBrains Mono", monospace';
  ctx.textAlign = 'left';
  ctx.fillStyle = badgeColor;
  ctx.fillText(statusText, 32, 26);

  const pvVal = lastPoint ? lastPoint.processVariable.toFixed(2) : '0.00';
  const uVal = lastPoint ? lastPoint.controlEffort.toFixed(2) : '0.00';
  const errVal = lastPoint ? lastPoint.error.toFixed(2) : '0.00';

  ctx.font = '9px "JetBrains Mono", monospace';
  ctx.fillStyle = c.text;
  ctx.fillText(
    `SP:${setpoint.toFixed(2)}  PV:${pvVal}  u(t):${uVal}  e:${errVal}  t:${simTime.toFixed(2)}s`,
    32,
    44
  );

  if (w > 480) {
    const trStr = metrics.riseTime !== null ? `${metrics.riseTime.toFixed(2)}s` : '--';
    const mpStr = metrics.peakOvershoot !== null ? `${metrics.peakOvershoot.toFixed(1)}%` : '--';
    const tsStr =
      metrics.settlingTime !== null
        ? Number.isFinite(metrics.settlingTime)
          ? `${metrics.settlingTime.toFixed(2)}s`
          : '∞ / unsettled'
        : '--';
    const essStr = metrics.steadyStateError !== null ? metrics.steadyStateError.toFixed(3) : '--';

    ctx.textAlign = 'right';
    ctx.fillStyle = c.textBright;
    ctx.font = '9px "JetBrains Mono", monospace';
    ctx.fillText(`Tr:${trStr}  Mp:${mpStr}  Ts:${tsStr}  Ess:${essStr}`, w - 18, 26);

    ctx.fillStyle = c.setpoint;
    ctx.fillText('■ SP', w - 160, 44);
    ctx.fillStyle = c.pv;
    ctx.fillText('■ PV', w - 120, 44);
    ctx.fillStyle = c.control;
    ctx.fillText('■ u(t)', w - 80, 44);
    ctx.fillStyle = c.error;
    ctx.fillText('■ e(t)', w - 40, 44);
  }
}

// ============================================================================
// Canvas 2: 2D Robot Physics Viewport with Camera Drag Panning & Centering
// ============================================================================

export interface RobotCameraState {
  follow: boolean;
  offset: { x: number; y: number };
  smoothedPV: number;
}

export interface ComputedCameraResult {
  robotScreenX: number;
  robotScreenY: number;
  pixelsPerMeter: number;
  clampedOffset: { x: number; y: number };
}

/**
 * Pure camera function satisfying Track B2/B3 invariants:
 * - In follow mode with zero offset: robot center is exactly (w/2, h/2) (0px error, within +/-2px)
 * - Under extreme pan in all 4 directions: robot center is clamped >= minMargin (48px) inside canvas
 * - Vertical span dynamically encloses 0, setpoint, and PV with 15% margin
 */
export function computeRobotCamera(
  w: number,
  h: number,
  pv: number,
  sp: number,
  camera: RobotCameraState,
  minMargin: number = 48
): ComputedCameraResult {
  const maxOffsetX = Math.max(0, w / 2 - minMargin);
  const maxOffsetY = Math.max(0, h / 2 - minMargin);
  const clampedX = Math.max(-maxOffsetX, Math.min(maxOffsetX, camera.offset.x));
  const clampedY = Math.max(-maxOffsetY, Math.min(maxOffsetY, camera.offset.y));

  const maxDist = Math.max(
    Math.abs(pv - 0),
    Math.abs(sp - 0),
    Math.abs(pv - sp),
    2.0
  );
  // Auto-framing with 15% margin
  const pixelsPerMeter = (h * 0.35) / maxDist;

  const relativeY = camera.follow ? (pv - camera.smoothedPV) * pixelsPerMeter : 0;
  const robotScreenX = w / 2 + clampedX;
  const robotScreenY = h / 2 + clampedY - relativeY;

  return {
    robotScreenX,
    robotScreenY,
    pixelsPerMeter,
    clampedOffset: { x: clampedX, y: clampedY },
  };
}

function getArchetypeHUD(
  robotType: RobotType,
  pv: number,
  sp: number,
  u: number
): { title: string; telemetry: string } {
  switch (robotType) {
    case 'line_follower':
      return {
        title: 'DIFFERENTIAL LINE FOLLOWER ROBOT',
        telemetry: `Pos: ${pv.toFixed(2)}m | Target: ${sp.toFixed(2)}m`,
      };
    case 'ackermann_vehicle':
      return {
        title: 'ACKERMANN STEERING VEHICLE',
        telemetry: `Pos: ${pv.toFixed(2)}m | Target: ${sp.toFixed(2)}m`,
      };
    case 'mecanum_platform':
      return {
        title: 'MECANUM OMNI PLATFORM POSITIONING',
        telemetry: `Pos: ${pv.toFixed(2)}m | Target: ${sp.toFixed(2)}m`,
      };
    case 'self_balancing':
      return {
        title: 'TWO-WHEELED SELF-BALANCING INVERTED PENDULUM',
        telemetry: `θ = ${pv.toFixed(2)}° | Torque: ${u.toFixed(2)}N⋅m`,
      };
    case 'gantry_crane':
      return {
        title: 'GANTRY CRANE CART-POLE SWAY CONTROLLER',
        telemetry: `Cart: ${pv.toFixed(2)}m | Target: ${sp.toFixed(2)}m`,
      };
    case 'quadcopter':
      return {
        title: 'QUADCOPTER DRONE ALTITUDE & THRUST DYNAMICS',
        telemetry: `Alt: ${pv.toFixed(2)}m | Thrust: ${u.toFixed(1)}N`,
      };
    case 'vtol_birotor':
      return {
        title: 'VTOL BI-ROTOR PITCH ATTITUDE STABILIZATION',
        telemetry: `Pitch: ${pv.toFixed(1)}° | Thrust: ${u.toFixed(1)}N`,
      };
    case 'single_joint':
      return {
        title: '1-DOF ARTICULATED ROBOTIC ARM LINK',
        telemetry: `θ = ${pv.toFixed(1)}° | Target: ${sp.toFixed(1)}°`,
      };
    case 'scara_arm':
      return {
        title: '2-DOF SCARA INDUSTRIAL MANIPULATOR',
        telemetry: `Reach: ${pv.toFixed(2)}m | Target: ${sp.toFixed(2)}m`,
      };
    case 'underwater_rov':
      return {
        title: 'UNDERWATER ROV DEPTH CONTROLLER',
        telemetry: `Depth: ${pv.toFixed(2)}m | Buoyancy: ${u.toFixed(1)}N`,
      };
    default:
      return {
        title: 'GENERALIZED 2ND-ORDER MASS-SPRING-DAMPER',
        telemetry: `Pos: ${pv.toFixed(2)}m | Target: ${sp.toFixed(2)}m`,
      };
  }
}

function renderRobotViewport(
  canvas: HTMLCanvasElement | null,
  w: number,
  h: number,
  c: ThemeColors,
  robotType: RobotType,
  pv: number,
  sp: number,
  u: number,
  time: number,
  particles: Particle[],
  ripples: DisturbanceRipple[],
  status: SimulationStatus,
  hasDisturbance: boolean,
  camera: RobotCameraState
) {
  if (!canvas || w <= 0 || h <= 0) return;

  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
  }

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // Background
  ctx.fillStyle = c.bgRob;
  ctx.fillRect(0, 0, w, h);

  // Pure camera computation with 48px boundary clamp (Track B2)
  const camResult = computeRobotCamera(w, h, pv, sp, camera, 48);

  // Save base transform before camera pan
  ctx.save();
  ctx.translate(camResult.clampedOffset.x, camResult.clampedOffset.y);

  // Dispatch to Mechanical Precision Robot Archetypes
  switch (robotType) {
    case 'line_follower':
      drawLineFollower(ctx, w, h, c, pv, sp, u, time);
      break;
    case 'ackermann_vehicle':
      drawAckermannVehicle(ctx, w, h, c, pv, sp, u, time);
      break;
    case 'mecanum_platform':
      drawMecanumPlatform(ctx, w, h, c, pv, sp, u, time);
      break;
    case 'self_balancing':
      drawSelfBalancing(ctx, w, h, c, pv, sp, u, time);
      break;
    case 'gantry_crane':
      drawGantryCrane(ctx, w, h, c, pv, sp, u, time);
      break;
    case 'quadcopter':
      drawQuadcopter(ctx, w, h, c, pv, sp, u, time, particles, camera);
      break;
    case 'vtol_birotor':
      drawVTOL(ctx, w, h, c, pv, sp, u, time);
      break;
    case 'single_joint':
      drawSingleJoint(ctx, w, h, c, pv, sp, u, time);
      break;
    case 'scara_arm':
      drawSCARA(ctx, w, h, c, pv, sp, u, time);
      break;
    case 'underwater_rov':
      drawROV(ctx, w, h, c, pv, sp, u, time, particles);
      break;
    default:
      drawCustomPlant(ctx, w, h, c, pv, sp, u, time);
  }

  // Draw Particles (in world coordinates)
  for (const p of particles) {
    ctx.globalAlpha = Math.max(0, p.life);
    ctx.fillStyle = p.color || c.particle;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1.0;

  // Draw Shockwave Disturbance Ripples
  for (const r of ripples) {
    ctx.strokeStyle = `rgba(245, 158, 11, ${Math.max(0, r.alpha)})`;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(r.x, r.y, r.radius, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = `rgba(245, 158, 11, ${Math.max(0, r.alpha)})`;
    ctx.font = 'bold 10px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(r.text, r.x, r.y - r.radius - 6);
  }

  ctx.restore(); // Restore camera pan

  // ── Track B2: Uniform Screen-Space HUD (Delta is 0px before and after pan) ──
  const hud = getArchetypeHUD(robotType, pv, sp, u);
  ctx.fillStyle = c.text;
  ctx.font = 'bold 11px "JetBrains Mono", monospace';
  ctx.textAlign = 'center';
  ctx.fillText(hud.title, w / 2, 22);

  ctx.fillStyle = c.accent;
  ctx.font = 'bold 11px "JetBrains Mono", monospace';
  ctx.fillText(hud.telemetry, w / 2, 40);

  // Active Disturbance Flash Tag
  if (hasDisturbance) {
    ctx.fillStyle = 'rgba(245, 158, 11, 0.15)';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = c.warning;
    ctx.font = 'bold 12px "JetBrains Mono", monospace';
    ctx.textAlign = 'right';
    ctx.fillText('⚡ DISTURBANCE ACTIVE', w - 16, 26);
  }

  // Camera Pan Status Badge (Track B2: Follow ON/OFF with coordinates)
  const isPanned = Math.abs(camera.offset.x) > 1 || Math.abs(camera.offset.y) > 1;
  if (isPanned || !camera.follow) {
    ctx.fillStyle = 'rgba(6, 182, 212, 0.2)';
    ctx.strokeStyle = c.accent;
    ctx.lineWidth = 1;
    ctx.strokeRect(10, h - 34, 210, 22);
    ctx.fillRect(10, h - 34, 210, 22);

    ctx.fillStyle = c.textBright;
    ctx.font = '9px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    const followStr = camera.follow ? 'Follow: ON' : 'Follow: OFF';
    const coordStr = `(${camera.offset.x > 0 ? '+' : ''}${Math.round(camera.offset.x)}px, ${camera.offset.y > 0 ? '+' : ''}${Math.round(camera.offset.y)}px)`;
    ctx.fillText(`Kamera: ${followStr} | ${coordStr}`, 16, h - 20);
  }

  // Footer Navigation Hint
  ctx.fillStyle = c.textMuted;
  ctx.font = '9px "JetBrains Mono", monospace';
  ctx.textAlign = 'center';
  ctx.fillText('👆 Klik Kiri: Dorong | Klik Kanan/Shift+Tarik: Pan | C: Pusatkan | Dobel Klik: Reset', w / 2, h - 8);
}

// ============================================================================
// MECHANICAL PRECISION 2D KINEMATICS RENDERERS (Strict Anti-Slop)
// ============================================================================

// ── 1. Line Follower / Differential Drive ──
function drawLineFollower(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  c: ThemeColors,
  pv: number,
  sp: number,
  u: number,
  t: number
) {
  const groundY = h * 0.72;

  // Textured Track Surface
  ctx.fillStyle = c.ground;
  ctx.fillRect(0, groundY, w, h - groundY);
  ctx.strokeStyle = c.groundLine;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(0, groundY);
  ctx.lineTo(w, groundY);
  ctx.stroke();

  // Winding Track Ribbon with dashed yellow center
  ctx.strokeStyle = '#1E293B';
  ctx.lineWidth = 32;
  ctx.beginPath();
  for (let x = -50; x < w + 50; x += 10) {
    const trackY = groundY - 2 + Math.sin((x + t * 40) * 0.018) * 16;
    if (x === -50) ctx.moveTo(x, trackY);
    else ctx.lineTo(x, trackY);
  }
  ctx.stroke();

  ctx.strokeStyle = c.warning;
  ctx.lineWidth = 3;
  ctx.setLineDash([12, 8]);
  ctx.beginPath();
  for (let x = -50; x < w + 50; x += 10) {
    const trackY = groundY - 2 + Math.sin((x + t * 40) * 0.018) * 16;
    if (x === -50) ctx.moveTo(x, trackY);
    else ctx.lineTo(x, trackY);
  }
  ctx.stroke();
  ctx.setLineDash([]);

  // Robot Position (pv = lateral offset mm)
  const robotX = w / 2 + pv * 5.5;
  const robotY = groundY - 22;
  const bodyW = 56;
  const bodyH = 24;

  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(robotX - bodyW / 2 + 3, robotY + 4, bodyW, bodyH);

  // PCB Chassis (Industrial Green FR4 with Gold Traces)
  ctx.fillStyle = '#064E3B';
  ctx.strokeStyle = c.accent;
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.roundRect(robotX - bodyW / 2, robotY, bodyW, bodyH, 5);
  ctx.fill();
  ctx.stroke();

  // Microcontroller & Copper Traces
  ctx.fillStyle = '#1E293B';
  ctx.fillRect(robotX - 10, robotY + 4, 20, 14);
  ctx.strokeStyle = '#D97706';
  ctx.lineWidth = 0.8;
  ctx.strokeRect(robotX - 10, robotY + 4, 20, 14);

  // Active IR Sensor Array (5 LEDs)
  for (let i = -2; i <= 2; i++) {
    const sx = robotX + i * 8;
    const sy = robotY + bodyH + 3;
    const isTarget = Math.abs(pv - i * 3) < 3.5;

    ctx.fillStyle = isTarget ? c.success : c.danger;
    ctx.shadowColor = isTarget ? c.success : 'transparent';
    ctx.shadowBlur = isTarget ? 6 : 0;
    ctx.beginPath();
    ctx.arc(sx, sy, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  // Dual DC Motor Wheels with Rubber Tread
  for (const wx of [robotX - bodyW / 2 + 7, robotX + bodyW / 2 - 7]) {
    ctx.fillStyle = '#0F172A';
    ctx.beginPath();
    ctx.arc(wx, robotY + bodyH, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = c.metal;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Wheel spokes rotating with time
    const ang = t * 15;
    ctx.strokeStyle = c.accent;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(wx + Math.cos(ang) * 5, robotY + bodyH + Math.sin(ang) * 5);
    ctx.lineTo(wx - Math.cos(ang) * 5, robotY + bodyH - Math.sin(ang) * 5);
    ctx.stroke();
  }
}

// ── 2. Ackermann Steering Vehicle ──
function drawAckermannVehicle(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  c: ThemeColors,
  pv: number,
  sp: number,
  u: number,
  t: number
) {
  const groundY = h * 0.74;
  ctx.fillStyle = c.ground;
  ctx.fillRect(0, groundY, w, h - groundY);

  const cx = w / 2;
  const cy = groundY - 38;
  const heading = (pv * Math.PI) / 180;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(heading);

  // Aerodynamic Car Chassis
  ctx.fillStyle = '#1E293B';
  ctx.strokeStyle = c.accent;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(-36, -18, 72, 36, 7);
  ctx.fill();
  ctx.stroke();

  // Cockpit Windshield
  ctx.fillStyle = c.accentGlow;
  ctx.beginPath();
  ctx.roundRect(-12, -14, 26, 28, 4);
  ctx.fill();

  // Headlight Cones projecting forward
  ctx.fillStyle = 'rgba(251, 191, 36, 0.12)';
  ctx.beginPath();
  ctx.moveTo(36, -12);
  ctx.lineTo(95, -28);
  ctx.lineTo(95, 28);
  ctx.lineTo(36, 12);
  ctx.closePath();
  ctx.fill();

  // Ackermann Front Steerable Wheels vs Rear Drive Axle
  const steerAngle = clamp(u * 0.6, -0.65, 0.65);
  const wheels = [
    { x: -25, y: -20, steer: false },
    { x: -25, y: 20, steer: false },
    { x: 25, y: -20, steer: true },
    { x: 25, y: 20, steer: true },
  ];

  for (const wh of wheels) {
    ctx.save();
    ctx.translate(wh.x, wh.y);
    if (wh.steer) ctx.rotate(steerAngle);
    ctx.fillStyle = '#0F172A';
    ctx.fillRect(-7, -4, 14, 8);
    ctx.strokeStyle = c.metal;
    ctx.lineWidth = 1;
    ctx.strokeRect(-7, -4, 14, 8);
    ctx.restore();
  }
  ctx.restore();

  // Target Heading Vector
  ctx.strokeStyle = c.warning;
  ctx.lineWidth = 1.4;
  ctx.setLineDash([5, 4]);
  const targetAngle = (sp * Math.PI) / 180;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + Math.cos(targetAngle) * 75, cy + Math.sin(targetAngle) * 75);
  ctx.stroke();
  ctx.setLineDash([]);
}

// ── 3. Mecanum / Omni-Directional Platform ──
function drawMecanumPlatform(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  c: ThemeColors,
  pv: number,
  sp: number,
  u: number,
  t: number
) {
  const groundY = h * 0.72;
  ctx.fillStyle = c.ground;
  ctx.fillRect(0, groundY, w, h - groundY);

  // Arena Grid Pattern
  ctx.strokeStyle = c.groundLine;
  ctx.lineWidth = 0.6;
  for (let x = 0; x < w; x += 35) {
    ctx.beginPath(); ctx.moveTo(x, groundY); ctx.lineTo(x, h); ctx.stroke();
  }

  const cx = w / 2 + pv * 28;
  const cy = groundY - 34;

  // Platform Chassis
  ctx.fillStyle = c.metalDark;
  ctx.strokeStyle = c.accent;
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.roundRect(cx - 42, cy - 28, 84, 56, 8);
  ctx.fill();
  ctx.stroke();

  // 4 Mecanum Wheels with 45-degree Angled Rollers
  const wheelHubs = [
    { x: cx - 40, y: cy - 28, angle: Math.PI / 4 },
    { x: cx + 26, y: cy - 28, angle: -Math.PI / 4 },
    { x: cx - 40, y: cy + 14, angle: -Math.PI / 4 },
    { x: cx + 26, y: cy + 14, angle: Math.PI / 4 },
  ];

  for (const wh of wheelHubs) {
    ctx.fillStyle = '#0F172A';
    ctx.beginPath();
    ctx.roundRect(wh.x, wh.y, 14, 14, 3);
    ctx.fill();
    ctx.strokeStyle = c.metal;
    ctx.lineWidth = 1;
    ctx.stroke();

    // 45 deg roller marks
    ctx.strokeStyle = c.warning;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(wh.x + 2, wh.y + 2);
    ctx.lineTo(wh.x + 12, wh.y + 12);
    ctx.stroke();
  }

  // Target Goal Waypoint
  const targetX = w / 2 + sp * 28;
  ctx.strokeStyle = c.warning;
  ctx.lineWidth = 1.8;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.arc(targetX, cy, 16, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
}

// ── 4. Two-Wheeled Self-Balancing Robot ──
function drawSelfBalancing(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  c: ThemeColors,
  pv: number,
  sp: number,
  u: number,
  t: number
) {
  const groundY = h * 0.8;
  ctx.fillStyle = c.ground;
  ctx.fillRect(0, groundY, w, h - groundY);
  ctx.strokeStyle = c.groundLine;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(0, groundY);
  ctx.lineTo(w, groundY);
  ctx.stroke();

  const cx = w / 2;
  const wheelY = groundY - 16;
  const tiltAngle = (pv * Math.PI) / 180;
  const bodyLength = Math.min(h * 0.4, 130);

  // Rubber Wheel with Spokes
  ctx.fillStyle = '#0F172A';
  ctx.beginPath();
  ctx.arc(cx - 20, wheelY, 16, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = c.accent;
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(cx + 20, wheelY, 16, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Inverted Pendulum Assembly
  ctx.save();
  ctx.translate(cx, wheelY);
  ctx.rotate(tiltAngle);

  // Rigid Anodized Aluminum Beam
  const grad = ctx.createLinearGradient(-12, 0, 12, 0);
  grad.addColorStop(0, '#1E293B');
  grad.addColorStop(0.5, '#475569');
  grad.addColorStop(1, '#1E293B');
  ctx.fillStyle = grad;
  ctx.strokeStyle = c.accent;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(-12, -bodyLength, 24, bodyLength, 5);
  ctx.fill();
  ctx.stroke();

  // Top Sensor Pod with Glowing Eyes
  ctx.fillStyle = '#0F172A';
  ctx.beginPath();
  ctx.roundRect(-16, -bodyLength - 12, 32, 16, 6);
  ctx.fill();
  ctx.strokeStyle = c.accent;
  ctx.stroke();

  ctx.fillStyle = c.pv;
  ctx.shadowColor = c.pvGlow;
  ctx.shadowBlur = 6;
  ctx.beginPath();
  ctx.arc(-7, -bodyLength - 4, 3, 0, Math.PI * 2);
  ctx.arc(7, -bodyLength - 4, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;

  // Center of Mass Hazard Badge
  ctx.fillStyle = c.danger;
  ctx.beginPath();
  ctx.arc(0, -bodyLength * 0.62, 4, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();

  // Angle Protractor Arc
  ctx.strokeStyle = c.accent;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, wheelY, 32, -Math.PI / 2, -Math.PI / 2 + tiltAngle, tiltAngle < 0);
  ctx.stroke();
}

// ── 5. Gantry Crane / Cart-Pole ──
function drawGantryCrane(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  c: ThemeColors,
  pv: number,
  sp: number,
  u: number,
  t: number
) {
  const railY = h * 0.28;
  const cartW = 64;
  const cartH = 26;
  const cableLen = Math.min(h * 0.38, 125);

  // Structural Overhead I-Beam Rail
  ctx.strokeStyle = '#334155';
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.moveTo(20, railY);
  ctx.lineTo(w - 20, railY);
  ctx.stroke();

  // Rail Top Highlight
  ctx.strokeStyle = c.metal;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(20, railY - 4);
  ctx.lineTo(w - 20, railY - 4);
  ctx.stroke();

  // Trolley Cart Position
  const cartX = w / 2 + pv * 32;
  const cartY = railY;

  // Steel Trolley Chassis
  ctx.fillStyle = '#1E293B';
  ctx.strokeStyle = c.accent;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(cartX - cartW / 2, cartY, cartW, cartH, 4);
  ctx.fill();
  ctx.stroke();

  // Suspended Cable with Dynamic Sway
  const swayAngle = Math.sin(t * 3.4 + pv * 0.12) * 0.14 * (1 + Math.abs(u) * 0.05);
  const bobX = cartX + Math.sin(swayAngle) * cableLen;
  const bobY = cartY + cartH + Math.cos(swayAngle) * cableLen;

  ctx.strokeStyle = c.metal;
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.moveTo(cartX, cartY + cartH);
  ctx.lineTo(bobX, bobY);
  ctx.stroke();

  // Crane Hook & Container Payload
  ctx.fillStyle = c.warning;
  ctx.strokeStyle = '#0F172A';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(bobX - 14, bobY - 10, 28, 20, 3);
  ctx.fill();
  ctx.stroke();

  // Target Ghost Guide
  const targetX = w / 2 + sp * 32;
  ctx.strokeStyle = c.success;
  ctx.lineWidth = 1.2;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(targetX, railY);
  ctx.lineTo(targetX, railY + cartH + cableLen + 20);
  ctx.stroke();
  ctx.setLineDash([]);
}

// ── 6. Quadcopter Drone (Precision CAD / Carbon Fiber) ──
function drawQuadcopter(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  c: ThemeColors,
  pv: number,
  sp: number,
  u: number,
  t: number,
  particles: Particle[],
  camera?: RobotCameraState
) {
  // Track B2: Dynamic vertical world range containing 0, SP, and PV with 15% margin
  const maxAlt = Math.max(pv, sp, 1.0);
  const minAlt = Math.min(pv, sp, 0.0);
  const span = Math.max(4.0, maxAlt - minAlt);
  const pixelsPerMeter = (h * 0.35) / span;

  // Drone vertically centered at h / 2, with smooth follow
  const smoothedAlt = camera?.smoothedPV ?? pv;
  const droneX = w / 2;
  const droneY = h / 2 - (pv - smoothedAlt) * pixelsPerMeter;
  const groundY = droneY + pv * pixelsPerMeter;
  const targetY = droneY - (sp - pv) * pixelsPerMeter;

  // Ground Surface
  ctx.fillStyle = c.ground;
  ctx.fillRect(0, groundY, w, Math.max(h - groundY, 40));

  // Altitude Ruler Grid
  ctx.strokeStyle = c.groundLine;
  ctx.lineWidth = 0.5;
  ctx.fillStyle = c.textMuted;
  ctx.font = '8px "JetBrains Mono", monospace';
  ctx.textAlign = 'right';

  const rulerStep = span > 25 ? 10 : 5;
  const maxRulerAlt = Math.ceil((maxAlt * 1.25) / rulerStep) * rulerStep;
  for (let alt = 0; alt <= maxRulerAlt; alt += rulerStep) {
    const y = groundY - alt * pixelsPerMeter;
    if (y >= -80 && y <= h + 80) {
      ctx.beginPath();
      ctx.moveTo(25, y);
      ctx.lineTo(w, y);
      ctx.stroke();
      ctx.fillText(`${alt}m`, 22, y + 3);
    }
  }

  // Target Altitude Guide
  ctx.strokeStyle = c.warning;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(25, targetY);
  ctx.lineTo(w - 10, targetY);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = c.warning;
  ctx.fillText(`Target: ${sp.toFixed(1)}m`, w - 12, targetY - 4);

  // Drone Position
  const tilt = Math.sin(t * 2.8) * 0.045;

  ctx.save();
  ctx.translate(droneX, droneY);
  ctx.rotate(tilt);

  // Carbon-Fiber Weave Arms
  ctx.strokeStyle = '#0F172A';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(-46, 0);
  ctx.lineTo(46, 0);
  ctx.stroke();

  ctx.strokeStyle = c.accent;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(-46, 0);
  ctx.lineTo(46, 0);
  ctx.stroke();

  // Central Avionics Hub
  ctx.fillStyle = '#1E293B';
  ctx.strokeStyle = c.accent;
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.roundRect(-16, -7, 32, 14, 5);
  ctx.fill();
  ctx.stroke();

  // LED Navigation Beacons
  ctx.fillStyle = '#10B981'; // Green starboard
  ctx.beginPath(); ctx.arc(-14, 0, 2, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#EF4444'; // Red port
  ctx.beginPath(); ctx.arc(14, 0, 2, 0, Math.PI * 2); ctx.fill();

  // Spinning Rotor Blur Discs with Motor Bell
  for (const rx of [-46, 46]) {
    ctx.fillStyle = '#334155';
    ctx.beginPath();
    ctx.arc(rx, 0, 4.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = `${c.accent}95`;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.ellipse(rx, 0, 20, 3.5, t * 28 + (rx > 0 ? 1 : 0), 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();

  // Dynamic Thrust Particle Wash
  if (u > 0.4 && Math.random() < 0.65) {
    particles.push({
      x: droneX - 46 + (Math.random() - 0.5) * 8,
      y: droneY + 6,
      vx: (Math.random() - 0.5) * 16,
      vy: 28 + Math.random() * 35,
      life: 1.0,
      maxLife: 0.35,
      size: 1.8 + Math.random() * 1.5,
      color: '#06B6D4',
    });
    particles.push({
      x: droneX + 46 + (Math.random() - 0.5) * 8,
      y: droneY + 6,
      vx: (Math.random() - 0.5) * 16,
      vy: 28 + Math.random() * 35,
      life: 1.0,
      maxLife: 0.35,
      size: 1.8 + Math.random() * 1.5,
      color: '#06B6D4',
    });
  }
}

// ── 7. VTOL Bi-Rotor Aircraft ──
function drawVTOL(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  c: ThemeColors,
  pv: number,
  sp: number,
  u: number,
  t: number
) {
  const cx = w / 2;
  const cy = h * 0.48;
  const pitchAngle = (pv * Math.PI) / 180;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(pitchAngle);

  // Airfoil Wing Profile
  ctx.fillStyle = '#1E293B';
  ctx.beginPath();
  ctx.moveTo(-54, -3);
  ctx.lineTo(54, -3);
  ctx.lineTo(48, 6);
  ctx.lineTo(-48, 6);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = c.accent;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Nacelles with Angle Deflection
  const nacelleTilt = u * 0.055;
  for (const side of [-1, 1]) {
    ctx.save();
    ctx.translate(side * 48, -3);
    ctx.rotate(nacelleTilt * side);

    ctx.strokeStyle = c.metal;
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -14); ctx.stroke();

    ctx.strokeStyle = `${c.accent}85`;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.ellipse(0, -14, 18, 2.5, t * 24 + side, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}

// ── 8. Single-Joint Robotic Arm ──
function drawSingleJoint(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  c: ThemeColors,
  pv: number,
  sp: number,
  u: number,
  t: number
) {
  const cx = w / 2;
  const cy = h * 0.58;
  const armLen = Math.min(w * 0.28, h * 0.34, 125);

  // Cast Metal Pedestal Base
  ctx.fillStyle = c.ground;
  ctx.fillRect(cx - 34, cy, 68, 24);
  ctx.strokeStyle = c.groundLine;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(cx - 34, cy, 68, 24);

  // Target Angle Ray
  const targetRad = (sp * Math.PI) / 180;
  ctx.strokeStyle = c.warning;
  ctx.lineWidth = 1.2;
  ctx.setLineDash([5, 4]);
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(
    cx + Math.cos(-targetRad + Math.PI / 2) * armLen,
    cy - Math.sin(-targetRad + Math.PI / 2) * armLen
  );
  ctx.stroke();
  ctx.setLineDash([]);

  // Arm Linkage
  const angle = (pv * Math.PI) / 180;
  const endX = cx + Math.cos(-angle + Math.PI / 2) * armLen;
  const endY = cy - Math.sin(-angle + Math.PI / 2) * armLen;

  ctx.strokeStyle = c.accent;
  ctx.lineWidth = 9;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(endX, endY);
  ctx.stroke();

  // Central Servo Motor Hub with Degree Marks
  ctx.fillStyle = '#0F172A';
  ctx.strokeStyle = c.accent;
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.arc(cx, cy, 11, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Gripper Tool Tip
  ctx.fillStyle = c.warning;
  ctx.beginPath();
  ctx.arc(endX, endY, 6.5, 0, Math.PI * 2);
  ctx.fill();
}

// ── 9. SCARA 2-DOF Robotic Arm ──
function drawSCARA(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  c: ThemeColors,
  pv: number,
  sp: number,
  u: number,
  t: number
) {
  const cx = w * 0.36;
  const cy = h * 0.62;
  const L1 = Math.min(w * 0.18, 85);
  const L2 = Math.min(w * 0.15, 70);

  ctx.fillStyle = c.ground;
  ctx.roundRect(cx - 24, cy, 48, 16, 4);
  ctx.fill();

  const theta1 = -Math.PI / 4 + (pv / 500) * Math.PI * 0.6;
  const theta2 = Math.PI / 3 + Math.sin(t * 0.5) * 0.15;

  const j1x = cx + Math.cos(theta1) * L1;
  const j1y = cy + Math.sin(theta1) * L1;
  const j2x = j1x + Math.cos(theta1 + theta2) * L2;
  const j2y = j1y + Math.sin(theta1 + theta2) * L2;

  // Link 1
  ctx.strokeStyle = c.accent;
  ctx.lineWidth = 8;
  ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(j1x, j1y); ctx.stroke();

  // Link 2
  ctx.strokeStyle = c.metalDark;
  ctx.lineWidth = 6;
  ctx.beginPath(); ctx.moveTo(j1x, j1y); ctx.lineTo(j2x, j2y); ctx.stroke();

  // Joints
  for (const [jx, jy, r] of [
    [cx, cy, 8],
    [j1x, j1y, 6],
    [j2x, j2y, 5],
  ] as [number, number, number][]) {
    ctx.fillStyle = c.metal;
    ctx.strokeStyle = c.accent;
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(jx, jy, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
}

// ── 10. Underwater ROV Submarine ──
function drawROV(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  c: ThemeColors,
  pv: number,
  sp: number,
  u: number,
  t: number,
  particles: Particle[]
) {
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, c.water);
  grad.addColorStop(1, '#021526');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // Depth Markers
  ctx.fillStyle = 'rgba(255,255,255,0.3)';
  ctx.font = '8px "JetBrains Mono", monospace';
  ctx.textAlign = 'right';
  for (let d = 0; d <= 50; d += 10) {
    const y = 30 + (d / 50) * (h - 55);
    ctx.fillText(`${d}m`, 22, y + 3);
  }

  const rovY = 30 + (pv / 50) * (h - 55);
  const rovX = w / 2 + Math.sin(t * 0.7) * 8;

  // Pressure Hull
  ctx.fillStyle = '#1E293B';
  ctx.strokeStyle = c.accent;
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.roundRect(rovX - 28, rovY - 14, 56, 28, 7);
  ctx.fill();
  ctx.stroke();

  // Glass Viewport with Glowing Beams
  ctx.fillStyle = c.accentGlow;
  ctx.beginPath();
  ctx.arc(rovX + 14, rovY, 6.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = `rgba(6, 182, 212, ${0.08 + Math.sin(t * 3) * 0.02})`;
  ctx.beginPath();
  ctx.moveTo(rovX + 18, rovY - 3);
  ctx.lineTo(rovX + 90, rovY - 34);
  ctx.lineTo(rovX + 90, rovY + 28);
  ctx.closePath();
  ctx.fill();

  // Bubbles
  if (Math.abs(u) > 0.4 && Math.random() < 0.55) {
    particles.push({
      x: rovX - 28,
      y: rovY + (Math.random() - 0.5) * 8,
      vx: -18 - Math.random() * 20,
      vy: -12 - Math.random() * 15,
      life: 1.0,
      maxLife: 0.45,
      size: 1.6 + Math.random() * 2,
      color: '#BAE6FD',
    });
  }
}

// ── 11. Custom Plant: Mass-Spring-Damper System ──
function drawCustomPlant(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  c: ThemeColors,
  pv: number,
  sp: number,
  u: number,
  t: number
) {
  const cx = w / 2;
  const cy = h / 2;
  const cartX = cx + pv * 32;
  const cartY = cy;
  const cartW = 64;
  const cartH = 32;

  // Ground Track
  ctx.strokeStyle = c.groundLine;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(cx - 130, cy + cartH / 2);
  ctx.lineTo(cx + 130, cy + cartH / 2);
  ctx.stroke();

  // Precision Mass Block
  ctx.fillStyle = '#1E293B';
  ctx.strokeStyle = c.accent;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(cartX - cartW / 2, cartY - cartH / 2, cartW, cartH, 4);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = c.textBright;
  ctx.font = 'bold 10px "JetBrains Mono", monospace';
  ctx.textAlign = 'center';
  ctx.fillText('MASS (m)', cartX, cartY + 4);

  // Target Guideline
  const targetX = cx + sp * 32;
  ctx.strokeStyle = c.warning;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(targetX, cy - 38);
  ctx.lineTo(targetX, cy + 38);
  ctx.stroke();
  ctx.setLineDash([]);
}

export default SimulationCanvas;
