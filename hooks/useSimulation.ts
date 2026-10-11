// ============================================================================
// useSimulation — Core Simulation Loop Hook
// Decoupled tick loop with zero layout-thrashing via requestAnimationFrame
// ============================================================================

'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import {
  DataPoint,
  PIDConfig,
  PIDGains,
  PlantParameters,
  StepResponseMetrics,
  ControllerState,
  PlantState,
} from '@/types/simulation';
import { RobotDefinition } from '@/types/robots';
import {
  createPlantState,
  createControllerState,
  simulationStep,
  computeStepResponseMetrics,
  TelemetryRingBuffer,
} from '@/lib/physicsEngine';
import {
  TuningResult,
  TuningRecommendation,
  getAllTuningResults,
  generateRecommendations,
} from '@/lib/tuner';

const DEFAULT_DT = 0.005; // 5ms simulation timestep (200 Hz)
const MAX_DATA_POINTS = 2000;

export interface SimulationHookState {
  // Core state
  isRunning: boolean;
  time: number;
  processVariable: number;
  setpoint: number;
  controlEffort: number;
  error: number;

  // PID
  pidConfig: PIDConfig;
  controllerState: ControllerState;

  // Plant
  plant: PlantParameters;

  // Data
  dataHistory: DataPoint[];
  metrics: StepResponseMetrics;

  // Tuning
  tuningResults: TuningResult[];
  recommendations: TuningRecommendation[];
  isAutoTuning: boolean;

  // Disturbance
  activeDisturbance: number;

  // Robot
  selectedRobot: RobotDefinition;

  // Speed
  speedMultiplier: number;

  // Direct engine refs (Zero React state thrashing)
  engineRef?: {
    plantStateRef: React.MutableRefObject<PlantState>;
    controllerStateRef: React.MutableRefObject<ControllerState>;
    timeRef: React.MutableRefObject<number>;
    dataRef: React.MutableRefObject<DataPoint[]>;
    disturbanceRef: React.MutableRefObject<{ magnitude: number; endTime: number }>;
  };
}

export interface SimulationHookActions {
  start: () => void;
  stop: () => void;
  reset: () => void;
  toggleRunning: () => void;

  setSetpoint: (sp: number) => void;
  setPIDGains: (gains: Partial<PIDGains>) => void;
  setPIDConfig: (config: Partial<PIDConfig>) => void;
  setPlant: (params: Partial<PlantParameters>) => void;

  selectRobot: (robot: RobotDefinition) => void;
  applyGains: (gains: PIDGains) => void;
  injectDisturbance: (magnitude: number, duration: number) => void;
  runAutoTune: () => void;
  setSpeedMultiplier: (m: number) => void;
  stepForward: () => void;
}

export function useSimulation(
  initialRobot: RobotDefinition
): [SimulationHookState, SimulationHookActions] {
  // Refs for animation loop (avoid re-render on every tick)
  const plantStateRef = useRef<PlantState>(createPlantState(initialRobot.defaultPlant));
  const controllerStateRef = useRef<ControllerState>(createControllerState());
  const timeRef = useRef(0);
  const ringBufferRef = useRef<TelemetryRingBuffer>(new TelemetryRingBuffer(MAX_DATA_POINTS));
  const dataRef = useRef<DataPoint[]>([]);
  const disturbanceRef = useRef<{ magnitude: number; endTime: number }>({
    magnitude: 0,
    endTime: 0,
  });
  const rafRef = useRef<number | null>(null);
  const lastRealTimeRef = useRef<number>(0);

  // React state (updated at throttled rate for UI)
  const [isRunning, setIsRunning] = useState(false);
  const [selectedRobot, setSelectedRobot] = useState<RobotDefinition>(initialRobot);
  const [plant, setPlant] = useState<PlantParameters>({ ...initialRobot.defaultPlant });
  const [setpoint, setSetpointState] = useState(initialRobot.defaultSetpoint);
  const [speedMultiplier, setSpeedMultiplier] = useState(1);

  const [pidConfig, setPIDConfigState] = useState<PIDConfig>({
    Kp: 2.0,
    Ki: 0.5,
    Kd: 0.3,
    derivativeFilterN: 20,
    integralClamp: [-100, 100],
    derivativeOnMeasurement: true,
    antiWindupKb: 0.5,
    dt: DEFAULT_DT,
  });

  // Track step start time and initial PV to ensure accurate transient metrics (Track C1)
  const stepStartTimeRef = useRef<number>(0);
  const stepInitialValueRef = useRef<number>(0);

  const [displayState, setDisplayState] = useState({
    time: 0,
    processVariable: 0,
    controlEffort: 0,
    error: 0,
    controllerState: createControllerState(),
    dataHistory: [] as DataPoint[],
    metrics: {
      riseTime: null,
      peakOvershoot: null,
      settlingTime: null,
      steadyStateError: null,
      peakTime: null,
      peakValue: null,
      oscillationFrequency: null,
      isStable: false,
      dampingAssessment: 'unknown',
    } as StepResponseMetrics,
    activeDisturbance: 0,
  });

  const [tuningResults, setTuningResults] = useState<TuningResult[]>([]);
  const [recommendations, setRecommendations] = useState<TuningRecommendation[]>([]);
  const [isAutoTuning, setIsAutoTuning] = useState(false);

  // Animation loop
  const tick = useCallback(function tickFn() {
    const now = performance.now();
    const realDt = Math.min((now - lastRealTimeRef.current) / 1000, 0.05); // Cap at 50ms
    lastRealTimeRef.current = now;

    const simDt = pidConfig.dt;
    const stepsPerFrame = Math.max(1, Math.round((realDt * speedMultiplier) / simDt));

    let currentPV = 0;
    let currentU = 0;
    let currentError = 0;

    let lastSavedTime = dataRef.current.length > 0 ? dataRef.current[dataRef.current.length - 1].time : -1;

    for (let s = 0; s < stepsPerFrame; s++) {
      const t = timeRef.current;

      // Disturbance
      let dist = 0;
      if (t < disturbanceRef.current.endTime) {
        dist = disturbanceRef.current.magnitude;
      }

      const result = simulationStep(
        setpoint,
        plantStateRef.current,
        controllerStateRef.current,
        plant,
        pidConfig,
        dist
      );

      plantStateRef.current = result.plantState;
      controllerStateRef.current = result.controllerState;
      currentPV = result.processVariable;
      currentU = result.controlEffort;
      currentError = setpoint - currentPV;
      timeRef.current += simDt;

      // Store data into circular buffer at 100 Hz sampling
      if (ringBufferRef.current.length === 0 || t - lastSavedTime >= 0.01) {
        ringBufferRef.current.push({
          time: t,
          setpoint,
          processVariable: currentPV,
          controlEffort: currentU,
          error: currentError,
          pTerm: controllerStateRef.current.pTerm,
          iTerm: controllerStateRef.current.iTerm,
          dTerm: controllerStateRef.current.dTerm,
        });
        lastSavedTime = t;
      }
    }

    // Produce chronological snapshot for UI rendering once per animation frame
    dataRef.current = ringBufferRef.current.toArray();

    // Update display state at ~30fps (throttled)
    const metrics = dataRef.current.length > 20
      ? computeStepResponseMetrics(dataRef.current, setpoint, {
          stepStartTime: stepStartTimeRef.current,
          initialValue: stepInitialValueRef.current,
          actuatorLimits: plant.actuatorLimits,
        })
      : displayState.metrics;

    setDisplayState({
      time: timeRef.current,
      processVariable: currentPV,
      controlEffort: currentU,
      error: currentError,
      controllerState: { ...controllerStateRef.current },
      dataHistory: [...dataRef.current],
      metrics,
      activeDisturbance: timeRef.current < disturbanceRef.current.endTime ? disturbanceRef.current.magnitude : 0,
    });

    rafRef.current = requestAnimationFrame(tickFn);
  }, [setpoint, plant, pidConfig, speedMultiplier, displayState.metrics]);

  // Start/Stop
  const start = useCallback(() => {
    if (rafRef.current !== null) return;
    lastRealTimeRef.current = performance.now();
    setIsRunning(true);
    rafRef.current = requestAnimationFrame(tick);
  }, [tick]);

  const stop = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    setIsRunning(false);
  }, []);

  const toggleRunning = useCallback(() => {
    if (isRunning) stop();
    else start();
  }, [isRunning, start, stop]);

  const reset = useCallback(() => {
    stop();
    stepStartTimeRef.current = 0;
    stepInitialValueRef.current = 0;
    plantStateRef.current = createPlantState(plant);
    controllerStateRef.current = createControllerState();
    timeRef.current = 0;
    ringBufferRef.current.clear();
    dataRef.current = [];
    disturbanceRef.current = { magnitude: 0, endTime: 0 };
    setDisplayState({
      time: 0,
      processVariable: 0,
      controlEffort: 0,
      error: 0,
      controllerState: createControllerState(),
      dataHistory: [],
      metrics: {
        riseTime: null,
        peakOvershoot: null,
        settlingTime: null,
        steadyStateError: null,
        peakTime: null,
        peakValue: null,
        oscillationFrequency: null,
        isStable: false,
        dampingAssessment: 'unknown',
        sustainedOscillation: false,
        settlingStatus: 'insufficient_data',
        saturationFraction: 0,
      },
      activeDisturbance: 0,
    });
  }, [stop, plant]);

  // Step Forward (1 physics tick Δt)
  const stepForward = useCallback(() => {
    stop();
    const t = timeRef.current;
    let dist = 0;
    if (t < disturbanceRef.current.endTime) {
      dist = disturbanceRef.current.magnitude;
    }

    const result = simulationStep(
      setpoint,
      plantStateRef.current,
      controllerStateRef.current,
      plant,
      pidConfig,
      dist
    );

    plantStateRef.current = result.plantState;
    controllerStateRef.current = result.controllerState;
    timeRef.current += pidConfig.dt;

    dataRef.current.push({
      time: timeRef.current,
      setpoint,
      processVariable: result.processVariable,
      controlEffort: result.controlEffort,
      error: setpoint - result.processVariable,
      pTerm: result.controllerState.pTerm,
      iTerm: result.controllerState.iTerm,
      dTerm: result.controllerState.dTerm,
    });
    if (dataRef.current.length > 2000) dataRef.current.shift();

    const metrics = dataRef.current.length > 20
      ? computeStepResponseMetrics(dataRef.current, setpoint, {
          stepStartTime: stepStartTimeRef.current,
          initialValue: stepInitialValueRef.current,
          actuatorLimits: plant.actuatorLimits,
        })
      : displayState.metrics;

    setDisplayState({
      time: timeRef.current,
      processVariable: result.processVariable,
      controlEffort: result.controlEffort,
      error: setpoint - result.processVariable,
      controllerState: { ...result.controllerState },
      dataHistory: [...dataRef.current],
      metrics,
      activeDisturbance: dist,
    });
  }, [stop, setpoint, plant, pidConfig, displayState.metrics]);

  // Setpoint — Record transition time and initial PV, reset transient metrics (Track C1)
  const setSetpoint = useCallback((sp: number) => {
    stepStartTimeRef.current = timeRef.current;
    stepInitialValueRef.current = plantStateRef.current.measuredOutput ?? 0;
    setSetpointState(sp);
    setDisplayState((prev) => ({
      ...prev,
      metrics: {
        riseTime: null,
        peakOvershoot: null,
        settlingTime: null,
        steadyStateError: null,
        peakTime: null,
        peakValue: null,
        oscillationFrequency: null,
        isStable: false,
        dampingAssessment: 'unknown',
        sustainedOscillation: false,
        settlingStatus: 'insufficient_data',
        saturationFraction: 0,
      },
    }));
  }, []);

  // PID Gains
  const setPIDGains = useCallback((gains: Partial<PIDGains>) => {
    setPIDConfigState((prev) => ({ ...prev, ...gains }));
  }, []);

  const setPIDConfig = useCallback((config: Partial<PIDConfig>) => {
    setPIDConfigState((prev) => ({ ...prev, ...config }));
  }, []);

  const applyGains = useCallback((gains: PIDGains) => {
    setPIDConfigState((prev) => ({ ...prev, ...gains }));
  }, []);

  // Plant
  const setPlantParams = useCallback((params: Partial<PlantParameters>) => {
    setPlant((prev) => {
      const next = { ...prev, ...params };
      plantStateRef.current = createPlantState(next);
      return next;
    });
  }, []);

  // Robot selection
  const selectRobot = useCallback((robot: RobotDefinition) => {
    stop();
    stepStartTimeRef.current = 0;
    stepInitialValueRef.current = 0;
    setSelectedRobot(robot);
    setPlant({ ...robot.defaultPlant });
    setSetpointState(robot.defaultSetpoint);
    plantStateRef.current = createPlantState(robot.defaultPlant);
    controllerStateRef.current = createControllerState();
    timeRef.current = 0;
    dataRef.current = [];
    setDisplayState({
      time: 0,
      processVariable: 0,
      controlEffort: 0,
      error: 0,
      controllerState: createControllerState(),
      dataHistory: [],
      metrics: {
        riseTime: null,
        peakOvershoot: null,
        settlingTime: null,
        steadyStateError: null,
        peakTime: null,
        peakValue: null,
        oscillationFrequency: null,
        isStable: false,
        dampingAssessment: 'unknown',
      },
      activeDisturbance: 0,
    });
  }, [stop]);

  // Disturbance
  const injectDisturbance = useCallback((magnitude: number, duration: number) => {
    disturbanceRef.current = {
      magnitude,
      endTime: timeRef.current + duration,
    };
  }, []);

  // Auto-tune
  const runAutoTune = useCallback(() => {
    setIsAutoTuning(true);

    // Run in a microtask to not block the UI
    setTimeout(() => {
      const results = getAllTuningResults(plant, setpoint, pidConfig);
      setTuningResults(results);

      const recs = generateRecommendations(
        displayState.metrics,
        pidConfig,
        plant
      );
      setRecommendations(recs);
      setIsAutoTuning(false);
    }, 50);
  }, [plant, setpoint, pidConfig, displayState.metrics]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

  // Re-start loop when tick changes and simulation is running
  useEffect(() => {
    if (isRunning) {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
      lastRealTimeRef.current = performance.now();
      rafRef.current = requestAnimationFrame(tick);
    }
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [tick, isRunning]);

  const state: SimulationHookState = {
    isRunning,
    time: displayState.time,
    processVariable: displayState.processVariable,
    setpoint,
    controlEffort: displayState.controlEffort,
    error: displayState.error,
    pidConfig,
    controllerState: displayState.controllerState,
    plant,
    dataHistory: displayState.dataHistory,
    metrics: displayState.metrics,
    tuningResults,
    recommendations,
    isAutoTuning,
    activeDisturbance: displayState.activeDisturbance,
    selectedRobot,
    speedMultiplier,
    engineRef: {
      plantStateRef,
      controllerStateRef,
      timeRef,
      dataRef,
      disturbanceRef,
    },
  };

  const actions: SimulationHookActions = {
    start,
    stop,
    reset,
    toggleRunning,
    setSetpoint,
    setPIDGains,
    setPIDConfig,
    setPlant: setPlantParams,
    selectRobot,
    applyGains,
    injectDisturbance,
    runAutoTune,
    setSpeedMultiplier,
    stepForward,
  };

  return [state, actions];
}
