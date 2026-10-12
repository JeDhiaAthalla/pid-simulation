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
  getHoverFeedforward,
} from '@/lib/physicsEngine';
import {
  TuningResult,
  TuningRecommendation,
  generateRecommendations,
} from '@/lib/tuner';
import { runTunerInWorker } from '@/lib/tunerService';

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
  appliedMethodId: string | null;

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
    ringBufferRef?: React.MutableRefObject<TelemetryRingBuffer>;
    disturbanceRef: React.MutableRefObject<{ magnitude: number; endTime: number }>;
  };
}

export interface SimulationHookActions {
  start: () => void;
  stop: () => void;
  reset: () => void;
  resetPlant: () => void;
  toggleRunning: () => void;

  setSetpoint: (sp: number) => void;
  setPIDGains: (gains: Partial<PIDGains>) => void;
  setPIDConfig: (config: Partial<PIDConfig>) => void;
  setPlant: (params: Partial<PlantParameters>) => void;

  selectRobot: (robot: RobotDefinition) => void;
  applyGains: (gains: PIDGains, methodId?: string | null) => void;
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
    Kp: initialRobot.defaultPID?.Kp ?? 2.0,
    Ki: initialRobot.defaultPID?.Ki ?? 0.5,
    Kd: initialRobot.defaultPID?.Kd ?? 0.3,
    setpointWeight: initialRobot.defaultPID?.setpointWeight ?? 1.0,
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
  const [appliedMethodId, setAppliedMethodId] = useState<string | null>(null);

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
    const stepAmp = Math.abs(setpoint - stepInitialValueRef.current);
    const minStepThr = Math.max(0.02 * Math.abs(setpoint), 1e-4);
    const isValidStep = stepAmp >= minStepThr;

    let metrics = dataRef.current.length > 20
      ? computeStepResponseMetrics(dataRef.current, setpoint, {
          stepStartTime: stepStartTimeRef.current,
          initialValue: stepInitialValueRef.current,
          actuatorLimits: plant.actuatorLimits,
        })
      : displayState.metrics;

    if (!isValidStep) {
      metrics = {
        ...metrics,
        riseTime: null,
        peakOvershoot: null,
        isStepValid: false,
        stepAmplitude: stepAmp,
      };
    } else {
      metrics = {
        ...metrics,
        isStepValid: true,
        stepAmplitude: stepAmp,
      };
    }

    setDisplayState({
      time: timeRef.current,
      processVariable: currentPV,
      controlEffort: currentU,
      error: currentError,
      controllerState: { ...controllerStateRef.current },
      dataHistory: dataRef.current,
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
    const uFf = getHoverFeedforward(plant);
    controllerStateRef.current = {
      ...createControllerState(),
      controlOutput: uFf,
      controlOutputUnsat: uFf,
    };
    timeRef.current = 0;
    ringBufferRef.current.clear();
    dataRef.current = [];
    disturbanceRef.current = { magnitude: 0, endTime: 0 };
    setDisplayState({
      time: 0,
      processVariable: plantStateRef.current.measuredOutput ?? 0,
      controlEffort: uFf,
      error: setpoint - (plantStateRef.current.measuredOutput ?? 0),
      controllerState: controllerStateRef.current,
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
  }, [stop, plant, setpoint]);

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

    const stepAmp = Math.abs(setpoint - stepInitialValueRef.current);
    const minStepThr = Math.max(0.02 * Math.abs(setpoint), 1e-4);
    const isValidStep = stepAmp >= minStepThr;

    let metrics = dataRef.current.length > 20
      ? computeStepResponseMetrics(dataRef.current, setpoint, {
          stepStartTime: stepStartTimeRef.current,
          initialValue: stepInitialValueRef.current,
          actuatorLimits: plant.actuatorLimits,
        })
      : displayState.metrics;

    if (!isValidStep) {
      metrics = {
        ...metrics,
        riseTime: null,
        peakOvershoot: null,
        isStepValid: false,
        stepAmplitude: stepAmp,
      };
    } else {
      metrics = {
        ...metrics,
        isStepValid: true,
        stepAmplitude: stepAmp,
      };
    }

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

  // PID Gains (Auto-reset appliedMethodId on manual adjustment)
  const setPIDGains = useCallback((gains: Partial<PIDGains>) => {
    setAppliedMethodId(null);
    setPIDConfigState((prev) => ({ ...prev, ...gains }));
  }, []);

  const setPIDConfig = useCallback((config: Partial<PIDConfig>) => {
    setPIDConfigState((prev) => ({ ...prev, ...config }));
  }, []);

  const applyGains = useCallback((gains: PIDGains, methodId?: string | null) => {
    setAppliedMethodId(methodId ?? null);
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

  // Robot selection (Purge history on archetype switch)
  const selectRobot = useCallback((robot: RobotDefinition) => {
    stop();
    setAppliedMethodId(null);
    stepStartTimeRef.current = 0;
    stepInitialValueRef.current = 0;
    ringBufferRef.current.clear();
    dataRef.current = [];
    timeRef.current = 0;
    disturbanceRef.current = { magnitude: 0, endTime: 0 };
    plantStateRef.current = createPlantState(robot.defaultPlant);
    controllerStateRef.current = createControllerState();
    setSelectedRobot(robot);
    setPlant({ ...robot.defaultPlant });
    setSetpointState(robot.defaultSetpoint);
    if (robot.defaultPID) {
      setPIDConfigState((prev) => ({
        ...prev,
        Kp: robot.defaultPID!.Kp ?? prev.Kp,
        Ki: robot.defaultPID!.Ki ?? prev.Ki,
        Kd: robot.defaultPID!.Kd ?? prev.Kd,
        setpointWeight: robot.defaultPID!.setpointWeight ?? 1.0,
      }));
    } else {
      setPIDConfigState((prev) => ({
        ...prev,
        setpointWeight: 1.0,
      }));
    }
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
  }, [stop]);

  // Effect Watcher: Purge history & state if robot changes
  const prevRobotIdRef = useRef<string>(initialRobot.id);
  useEffect(() => {
    if (prevRobotIdRef.current !== selectedRobot.id) {
      prevRobotIdRef.current = selectedRobot.id;
      stop();
      timeRef.current = 0;
      stepStartTimeRef.current = 0;
      stepInitialValueRef.current = 0;
      ringBufferRef.current.clear();
      dataRef.current = [];
      disturbanceRef.current = { magnitude: 0, endTime: 0 };
      plantStateRef.current = createPlantState(selectedRobot.defaultPlant);
      controllerStateRef.current = createControllerState();
      setDisplayState((prev) => ({
        ...prev,
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
      }));
    }
  }, [selectedRobot.id, selectedRobot.defaultPlant, stop]);

  // Disturbance
  const injectDisturbance = useCallback((magnitude: number, duration: number) => {
    disturbanceRef.current = {
      magnitude,
      endTime: timeRef.current + duration,
    };
  }, []);

  // Auto-tune (BUG-02 Fix: Offloaded to dedicated background Web Worker)
  const runAutoTune = useCallback(() => {
    setIsAutoTuning(true);

    runTunerInWorker(plant, setpoint, pidConfig)
      .then((results) => {
        setTuningResults(results);

        const recs = generateRecommendations(
          displayState.metrics,
          pidConfig,
          plant
        );
        setRecommendations(recs);
      })
      .catch((err) => {
        console.error('Auto-tune worker error:', err);
      })
      .finally(() => {
        setIsAutoTuning(false);
      });
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
    appliedMethodId,
    activeDisturbance: displayState.activeDisturbance,
    selectedRobot,
    speedMultiplier,
    engineRef: {
      plantStateRef,
      controllerStateRef,
      timeRef,
      dataRef,
      ringBufferRef,
      disturbanceRef,
    },
  };

  const actions: SimulationHookActions = {
    start,
    stop,
    reset,
    resetPlant: reset,
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
