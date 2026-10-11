// ============================================================================
// Physics Engine v2 — Semi-Fixed Timestep, NaN Guard, Gaussian Noise,
// Circular Dead-Time Buffer (Zero-Copy), Unit-Aware Gravity
// ============================================================================

import {
  PlantParameters,
  PlantState,
  PIDConfig,
  PIDGains,
  ControllerState,
  DataPoint,
  StepResponseMetrics,
  SimulationStatus,
  NoiseConfig,
} from '@/types/simulation';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Fixed physics timestep (seconds). Never changes regardless of frame rate. */
export const PHYSICS_DT = 0.005; // 5 ms → 200 Hz

/** Maximum accumulated time per frame (prevents spiral-of-death on tab switch). */
const MAX_ACCUMULATOR = 0.2; // 200 ms cap

/** Default divergence threshold — if |x[0]| exceeds this, system is runaway. */
const DEFAULT_DIVERGENCE_LIMIT = 1e6;

// ---------------------------------------------------------------------------
// Utility: Clamp
// ---------------------------------------------------------------------------
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// ---------------------------------------------------------------------------
// Utility: Box-Muller Gaussian White Noise
// ---------------------------------------------------------------------------
let _spareNormal: number | null = null;

export function gaussianNoise(sigma: number): number {
  if (_spareNormal !== null) {
    const n = _spareNormal * sigma;
    _spareNormal = null;
    return n;
  }
  let u: number, v: number, s: number;
  do {
    u = Math.random() * 2 - 1;
    v = Math.random() * 2 - 1;
    s = u * u + v * v;
  } while (s >= 1 || s === 0);
  const mul = Math.sqrt(-2.0 * Math.log(s) / s);
  _spareNormal = v * mul;
  return u * mul * sigma;
}

// ---------------------------------------------------------------------------
// NaN / Infinity Safety Guard
// ---------------------------------------------------------------------------
function isSafe(x: number): boolean {
  return Number.isFinite(x);
}

function sanitizeState(x: number[]): number[] {
  return x.map((v) => (isSafe(v) ? v : 0));
}

// ---------------------------------------------------------------------------
// Hover Feedforward Helper
// ---------------------------------------------------------------------------
/**
 * Calculates hover feedforward thrust for thrust-model integrating plants (e.g. quadcopter).
 * Returns clamp(mass * gravityAccel, u_min, u_max) when mass > 0, otherwise 0.
 */
export function getHoverFeedforward(plant: PlantParameters): number {
  if (plant.mass !== undefined && plant.mass > 0) {
    const g = plant.gravityAccel ?? 9.81;
    const ff = plant.mass * g;
    return clamp(ff, plant.actuatorLimits[0], plant.actuatorLimits[1]);
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Plant State Initialization
// Uses Float64Array for dead-time buffer (zero-copy circular writes).
// ---------------------------------------------------------------------------
export function createPlantState(plant: PlantParameters): PlantState {
  const capacity = Math.max(2, Math.ceil(plant.deadTime / PHYSICS_DT) + 1);
  return {
    x: plant.order === 1 ? [0] : [0, 0],
    measuredOutput: 0,
    deadTimeBuffer: new Float64Array(capacity),
    deadTimeIndex: 0,
    deadTimeCapacity: capacity,
  };
}

// ---------------------------------------------------------------------------
// Second-Order Plant ODE: ẍ + 2ζωn·ẋ + ωn²·x = K·ωn²·u
// With friction and unit-aware gravity torque, plus thrust-model branch.
// ---------------------------------------------------------------------------
function plantDerivatives(
  x: number[],
  u: number,
  plant: PlantParameters,
  gravityInRadians: boolean
): number[] {
  // Branch A: Thrust-model integrating plant (e.g. quadcopter altitude: m·z'' = u - m·g - c·z')
  if (plant.mass !== undefined && plant.mass > 0) {
    const m = plant.mass;
    const c = plant.dragCoefficient ?? 0.5;
    const g = plant.gravityAccel ?? 9.81;
    const velocity = x.length > 1 ? x[1] : 0;
    const accel = (u - m * g - c * velocity) / m;
    return [velocity, isSafe(accel) ? accel : 0];
  }

  const { dampingRatio: z, naturalFrequency: wn, gain: K, friction, gravityTorque } = plant;

  if (plant.order === 1) {
    // First order: τ·ẋ + x = K·u
    const tau = plant.timeConstant > 0 ? plant.timeConstant : 0.01;
    const frictionTerm = friction * Math.sign(x[0]) * Math.abs(x[0]);
    const dx = (K * u - x[0] - frictionTerm) / tau;
    return [isSafe(dx) ? dx : 0];
  }

  // Second order
  const velocity = x[1];
  const frictionForce = friction * Math.sign(velocity) * Math.abs(velocity);

  // Gravity: if the archetype operates in radians internally (e.g. inverted pendulum),
  // use sin(x[0]) directly. Otherwise convert degrees → radians for the trig.
  const gravityLoad = gravityTorque > 0
    ? gravityTorque * Math.sin(gravityInRadians ? x[0] : x[0] * Math.PI / 180)
    : 0;

  const accel =
    K * wn * wn * u -
    2 * z * wn * velocity -
    wn * wn * x[0] -
    frictionForce -
    gravityLoad;

  return [velocity, isSafe(accel) ? accel : 0];
}

// ---------------------------------------------------------------------------
// RK4 Integrator — Zero per-stage allocation
// ---------------------------------------------------------------------------
export function rk4Step(
  x: number[],
  u: number,
  dt: number,
  plant: PlantParameters,
  gravityInRadians: boolean = false
): number[] {
  if (x.length === 1) {
    const k1 = plantDerivatives(x, u, plant, gravityInRadians)[0];
    const x2 = [x[0] + 0.5 * dt * k1];
    const k2 = plantDerivatives(x2, u, plant, gravityInRadians)[0];
    const x3 = [x[0] + 0.5 * dt * k2];
    const k3 = plantDerivatives(x3, u, plant, gravityInRadians)[0];
    const x4 = [x[0] + dt * k3];
    const k4 = plantDerivatives(x4, u, plant, gravityInRadians)[0];

    const res0 = x[0] + (dt / 6) * (k1 + 2 * k2 + 2 * k3 + k4);
    return [isSafe(res0) ? res0 : 0];
  }

  const k1 = plantDerivatives(x, u, plant, gravityInRadians);
  const x2 = [x[0] + 0.5 * dt * k1[0], x[1] + 0.5 * dt * k1[1]];
  const k2 = plantDerivatives(x2, u, plant, gravityInRadians);
  const x3 = [x[0] + 0.5 * dt * k2[0], x[1] + 0.5 * dt * k2[1]];
  const k3 = plantDerivatives(x3, u, plant, gravityInRadians);
  const x4 = [x[0] + dt * k3[0], x[1] + dt * k3[1]];
  const k4 = plantDerivatives(x4, u, plant, gravityInRadians);

  const res0 = x[0] + (dt / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]);
  const res1 = x[1] + (dt / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]);

  return [isSafe(res0) ? res0 : 0, isSafe(res1) ? res1 : 0];
}

// ---------------------------------------------------------------------------
// Dead-Time Buffer — Circular Write (Zero-Copy, In-Place Mutation)
// ---------------------------------------------------------------------------
export function applyDeadTime(
  output: number,
  state: PlantState,
  _dt: number
): number {
  void _dt;
  const cap = state.deadTimeCapacity;
  if (cap <= 1) return output;

  // Write current output into ring buffer
  state.deadTimeBuffer[state.deadTimeIndex] = output;

  // Advance write head
  state.deadTimeIndex = (state.deadTimeIndex + 1) % cap;

  // Read from the oldest entry (which is now at the write head position)
  const readIdx = state.deadTimeIndex % cap;
  const delayed = state.deadTimeBuffer[readIdx];

  return isSafe(delayed) ? delayed : output;
}

// ---------------------------------------------------------------------------
// PID Controller — Discrete Parallel Form with Industrial Enhancements
// ---------------------------------------------------------------------------
export function createControllerState(): ControllerState {
  return {
    error: 0,
    prevError: 0,
    integral: 0,
    prevMeasurement: 0,
    filteredDerivative: 0,
    pTerm: 0,
    iTerm: 0,
    dTerm: 0,
    controlOutput: 0,
    controlOutputUnsat: 0,
    isSaturated: false,
  };
}

export function pidStep(
  setpoint: number,
  measurement: number,
  config: PIDConfig,
  state: ControllerState,
  actuatorLimits: [number, number],
  feedforward: number = 0
): ControllerState {
  const dt = config.dt;

  // Guard against NaN inputs
  if (!isSafe(setpoint) || !isSafe(measurement)) {
    return { ...state, error: 0, pTerm: 0, iTerm: 0, dTerm: 0, controlOutput: 0, controlOutputUnsat: 0 };
  }

  const error = setpoint - measurement;

  // ── P-term ──
  const pTerm = config.Kp * error;

  // ── D-term ──
  let rawDerivative: number;
  if (config.derivativeOnMeasurement) {
    // Derivative-on-measurement: avoids derivative kick
    rawDerivative = -(measurement - state.prevMeasurement) / dt;
  } else {
    rawDerivative = (error - state.prevError) / dt;
  }
  if (!isSafe(rawDerivative)) rawDerivative = 0;

  // Low-pass filter on derivative: α = N·dt / (1 + N·dt)
  const alpha =
    config.derivativeFilterN > 0
      ? (config.derivativeFilterN * dt) / (1 + config.derivativeFilterN * dt)
      : 1;
  let filteredDerivative = alpha * rawDerivative + (1 - alpha) * state.filteredDerivative;
  if (!isSafe(filteredDerivative)) filteredDerivative = 0;

  const dTerm = config.Kd * filteredDerivative;

  // ── I-term with Conditional Integration Anti-Windup ──
  // Check tentative unsaturated control output before updating integral
  const tentativeUnsat = feedforward + pTerm + config.Ki * state.integral + dTerm;
  const isHighSaturated = tentativeUnsat >= actuatorLimits[1] && error > 0;
  const isLowSaturated = tentativeUnsat <= actuatorLimits[0] && error < 0;

  let integral = state.integral;
  if (!isHighSaturated && !isLowSaturated) {
    // Only integrate when not saturating in the direction of error
    integral += error * dt;
  }

  // Mandatory output-unit clamping: |Ki * integral| <= I_max
  // I_max = 0.5 * min(u_max - u_ff, u_ff - u_min)
  if (config.Ki > 0) {
    const headroomHigh = Math.max(0, actuatorLimits[1] - feedforward);
    const headroomLow = Math.max(0, feedforward - actuatorLimits[0]);
    const maxHeadroom = Math.min(headroomHigh, headroomLow);
    if (maxHeadroom > 0) {
      const iMax = 0.5 * maxHeadroom;
      const iClampLimit = iMax / config.Ki;
      integral = clamp(integral, -iClampLimit, iClampLimit);
    }
  }

  // Configured integralClamp limits (backward-compatible)
  integral = clamp(integral, config.integralClamp[0], config.integralClamp[1]);
  if (!isSafe(integral)) integral = 0;

  const iTerm = config.Ki * integral;

  // ── Total control output ──
  let controlOutputUnsat = feedforward + pTerm + iTerm + dTerm;
  if (!isSafe(controlOutputUnsat)) controlOutputUnsat = 0;

  const controlOutput = clamp(controlOutputUnsat, actuatorLimits[0], actuatorLimits[1]);
  const isSaturated = Math.abs(controlOutput - controlOutputUnsat) > 1e-6;

  return {
    error,
    prevError: error,
    integral,
    prevMeasurement: measurement,
    filteredDerivative,
    pTerm,
    iTerm,
    dTerm,
    controlOutput,
    controlOutputUnsat,
    isSaturated,
  };
}

// ---------------------------------------------------------------------------
// Full Simulation Step: PID → Plant → Dead Time → Noise → Output
// CRITICAL FIX: Plant integrator state x[] is NEVER overwritten by delayed
// output. The delayed+noisy value is stored in plantState.measuredOutput
// and that is what the PID reads. The RK4 integrator always uses raw x[].
// ---------------------------------------------------------------------------
export function simulationStep(
  setpoint: number,
  plantState: PlantState,
  controllerState: ControllerState,
  plant: PlantParameters,
  pidConfig: PIDConfig,
  disturbance: number = 0,
  noiseConfig?: NoiseConfig,
  gravityInRadians: boolean = false,
  divergenceLimit: number = DEFAULT_DIVERGENCE_LIMIT,
): {
  plantState: PlantState;
  controllerState: ControllerState;
  processVariable: number;
  controlEffort: number;
  status: SimulationStatus;
} {
  const dt = pidConfig.dt;

  // PID reads the MEASURED output (after dead time + noise), not raw plant state
  const measurement = plantState.measuredOutput;

  // Calculate hover feedforward (e.g. for quadcopter m*g)
  const ff = getHoverFeedforward(plant);

  // PID step with feedforward
  const newCtrl = pidStep(setpoint, measurement, pidConfig, controllerState, plant.actuatorLimits, ff);

  // Apply control effort + disturbance
  const u = newCtrl.controlOutput + disturbance;

  // Integrate plant ODE (RK4) using the RAW internal state
  const newX = rk4Step(plantState.x, u, dt, plant, gravityInRadians);

  // ── Divergence check ──
  const rawOutput = newX[0];
  if (!isSafe(rawOutput) || Math.abs(rawOutput) > divergenceLimit) {
    // Freeze physics — return frozen state with runaway status
    return {
      plantState: {
        ...plantState,
        x: sanitizeState(plantState.x),
      },
      controllerState: createControllerState(),
      processVariable: plantState.measuredOutput,
      controlEffort: 0,
      status: 'runaway',
    };
  }

  // ── Dead-time delay (in-place circular buffer mutation) ──
  const deadTimeOutput = plant.deadTime > 0
    ? applyDeadTime(rawOutput, plantState, dt)
    : rawOutput;

  // ── Sensor noise injection ──
  let measuredPV = deadTimeOutput;
  if (noiseConfig?.enabled && noiseConfig.sigma > 0) {
    measuredPV += gaussianNoise(noiseConfig.sigma);
  }

  // Build new plant state — x[] holds raw integrator state, measuredOutput holds what PID sees
  const updatedPlantState: PlantState = {
    x: newX,
    measuredOutput: measuredPV,
    deadTimeBuffer: plantState.deadTimeBuffer, // same typed array reference (zero-copy)
    deadTimeIndex: plantState.deadTimeIndex,    // already advanced by applyDeadTime
    deadTimeCapacity: plantState.deadTimeCapacity,
  };

  // Determine status: 'stable' only if |error| <= thr AND PV rate is small
  const thr = Math.max(0.02 * Math.abs(setpoint), 0.05);
  const velocity = newX.length > 1
    ? Math.abs(newX[1])
    : Math.abs(rawOutput - plantState.x[0]) / (dt > 0 ? dt : 0.005);
  let status: SimulationStatus = 'running';
  if (Math.abs(newCtrl.error) <= thr && velocity < 0.05) {
    status = 'stable';
  }

  return {
    plantState: updatedPlantState,
    controllerState: newCtrl,
    processVariable: measuredPV,
    controlEffort: u,
    status,
  };
}

// ---------------------------------------------------------------------------
// Semi-Fixed Timestep Accumulator
// Call this from requestAnimationFrame. It accumulates real wall-clock delta,
// then ticks physics at fixed PHYSICS_DT steps. Returns interpolation alpha
// for smooth rendering between discrete physics states.
// ---------------------------------------------------------------------------
export interface AccumulatorState {
  accumulator: number;
  prevTime: number;
}

export function createAccumulator(): AccumulatorState {
  return { accumulator: 0, prevTime: 0 };
}

/**
 * Advance the accumulator by the real frame delta.
 * Returns how many fixed physics steps to execute this frame.
 */
export function advanceAccumulator(
  acc: AccumulatorState,
  nowMs: number,
  speedMultiplier: number
): { steps: number; interpolationAlpha: number } {
  if (acc.prevTime === 0) {
    acc.prevTime = nowMs;
    return { steps: 0, interpolationAlpha: 0 };
  }

  const realDeltaSec = (nowMs - acc.prevTime) / 1000;
  acc.prevTime = nowMs;

  // Clamp to prevent spiral-of-death (e.g. tab was backgrounded)
  const clampedDelta = Math.min(realDeltaSec, MAX_ACCUMULATOR);
  acc.accumulator += clampedDelta * speedMultiplier;

  const steps = Math.floor(acc.accumulator / PHYSICS_DT);
  acc.accumulator -= steps * PHYSICS_DT;

  // Interpolation alpha for smooth rendering between physics ticks
  const interpolationAlpha = acc.accumulator / PHYSICS_DT;

  return { steps, interpolationAlpha };
}

// ---------------------------------------------------------------------------
// Step Response Metrics Calculator
// ---------------------------------------------------------------------------
export interface StepResponseOptions {
  stepStartTime?: number;
  initialValue?: number;
  actuatorLimits?: [number, number];
}

export function computeStepResponseMetrics(
  data: DataPoint[],
  setpoint: number,
  options?: StepResponseOptions
): StepResponseMetrics {
  const nullMetrics: StepResponseMetrics = {
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
  };

  if (!data || data.length < 2) return nullMetrics;

  const finalValue = setpoint;
  const initialValue = options?.initialValue ?? data[0].processVariable;
  const t0 = options?.stepStartTime ?? data[0].time;
  const amplitude = Math.max(Math.abs(finalValue - initialValue), 1e-9);

  // Actuator saturation fraction calculation
  let saturationFraction = 0;
  if (options?.actuatorLimits) {
    const [uMin, uMax] = options.actuatorLimits;
    let satCount = 0;
    for (let i = 0; i < data.length; i++) {
      const u = data[i].controlEffort;
      if (u <= uMin + 1e-4 || u >= uMax - 1e-4) {
        satCount++;
      }
    }
    saturationFraction = satCount / data.length;
  }

  // ── 2% Band (Minimum 0.05 threshold) ──
  const thr = Math.max(0.02 * Math.abs(finalValue), 0.05);

  // ── Rise Time (10% → 90%) ──
  let riseTime: number | null = null;
  const low = initialValue + 0.1 * (finalValue - initialValue);
  const high = initialValue + 0.9 * (finalValue - initialValue);
  let t10: number | null = null;
  let t90: number | null = null;
  const goingUp = finalValue >= initialValue;

  for (const dp of data) {
    if (t10 === null && (goingUp ? dp.processVariable >= low : dp.processVariable <= low)) {
      t10 = dp.time;
    }
    if (t90 === null && (goingUp ? dp.processVariable >= high : dp.processVariable <= high)) {
      t90 = dp.time;
    }
    if (t10 !== null && t90 !== null) break;
  }
  if (t10 !== null && t90 !== null) riseTime = Math.max(0, t90 - t10);

  // ── Peak Overshoot ──
  let peakValue: number | null = null;
  let peakTime: number | null = null;

  if (goingUp) {
    let maxPV = -Infinity;
    for (const dp of data) {
      if (dp.processVariable > maxPV) {
        maxPV = dp.processVariable;
        peakTime = dp.time;
      }
    }
    peakValue = maxPV;
  } else {
    let minPV = Infinity;
    for (const dp of data) {
      if (dp.processVariable < minPV) {
        minPV = dp.processVariable;
        peakTime = dp.time;
      }
    }
    peakValue = minPV;
  }

  const peakOvershoot = peakValue !== null
    ? ((Math.abs(peakValue - finalValue)) / amplitude) * 100
    : null;

  // ── Sustained Oscillation Detection (Last 1/3 of the Window) ──
  let sustainedOscillation = false;
  const oneThirdIdx = Math.floor((2 * data.length) / 3);
  const windowCount = data.length - oneThirdIdx;

  if (windowCount >= 6) {
    const extrema: number[] = [];
    for (let i = oneThirdIdx + 1; i < data.length - 1; i++) {
      const prevDev = Math.abs(data[i - 1].processVariable - finalValue);
      const currDev = Math.abs(data[i].processVariable - finalValue);
      const nextDev = Math.abs(data[i + 1].processVariable - finalValue);
      if (currDev > prevDev && currDev > nextDev && currDev > thr) {
        extrema.push(currDev);
      }
    }

    let tailCrossings = 0;
    for (let i = oneThirdIdx + 1; i < data.length; i++) {
      const prevDiff = data[i - 1].processVariable - finalValue;
      const currDiff = data[i].processVariable - finalValue;
      if (prevDiff * currDiff < 0) {
        tailCrossings++;
      }
    }

    const lastSampleOutside = Math.abs(data[data.length - 1].processVariable - finalValue) > thr;

    if (extrema.length >= 2) {
      const firstExtremum = extrema[0];
      const lastExtremum = extrema[extrema.length - 1];
      if (firstExtremum > 0 && lastExtremum / firstExtremum >= 0.7) {
        sustainedOscillation = true;
      }
    } else if (tailCrossings >= 3 && lastSampleOutside) {
      sustainedOscillation = true;
    }
  }

  // ── Robust Settling Time Scan (Backwards Scan) ──
  let settlingTime: number | null = null;
  let settlingStatus: StepResponseMetrics['settlingStatus'] = 'unsettled';

  // Find index j of the last sample outside [finalValue - thr, finalValue + thr]
  let j = -1;
  for (let i = data.length - 1; i >= 0; i--) {
    if (Math.abs(data[i].processVariable - finalValue) > thr) {
      j = i;
      break;
    }
  }

  if (j === data.length - 1) {
    // Last sample is outside the band
    settlingTime = Infinity;
    settlingStatus = 'unsettled';
  } else if (j === -1) {
    // No samples outside the band at all
    settlingTime = Math.max(0, data[0].time - t0);
    settlingStatus = 'settled';
  } else {
    // Samples inside band tail must cover at least max(5 samples, 5% of window)
    const tailCount = data.length - 1 - j;
    const minTailRequired = Math.max(5, Math.floor(0.05 * data.length));
    if (tailCount >= minTailRequired) {
      settlingTime = Math.max(0, data[j + 1].time - t0);
      settlingStatus = 'settled';
    } else {
      settlingTime = Infinity;
      settlingStatus = 'unsettled';
    }
  }

  // If sustained oscillation is detected, override settling
  if (sustainedOscillation) {
    settlingTime = Infinity;
    settlingStatus = 'unsettled';
  }

  // ── Steady-State Error ──
  const tailCount = Math.min(20, data.length);
  const tail = data.slice(-tailCount);
  const avgFinal = tail.reduce((s, d) => s + d.processVariable, 0) / tail.length;
  const steadyStateError = finalValue - avgFinal;

  // ── Oscillation Frequency Detection (Across full history) ──
  let oscillationFrequency: number | null = null;
  const crossings: number[] = [];
  for (let i = 1; i < data.length; i++) {
    const prev = data[i - 1].processVariable - finalValue;
    const curr = data[i].processVariable - finalValue;
    if (prev * curr < 0) crossings.push(data[i].time);
  }
  if (crossings.length >= 4) {
    const periods: number[] = [];
    for (let i = 2; i < crossings.length; i += 2) {
      periods.push(crossings[i] - crossings[i - 2]);
    }
    const avgPeriod = periods.reduce((s, p) => s + p, 0) / periods.length;
    if (avgPeriod > 0) oscillationFrequency = 1 / avgPeriod;
  }

  // ── Stability Assessment ──
  let isStable = !sustainedOscillation && settlingStatus === 'settled' && settlingTime !== null && Number.isFinite(settlingTime);
  let dampingAssessment: StepResponseMetrics['dampingAssessment'] = 'unknown';

  const lastPV = data[data.length - 1].processVariable;
  if (sustainedOscillation || !isSafe(lastPV) || Math.abs(lastPV - finalValue) > amplitude * 10 || settlingTime === Infinity) {
    dampingAssessment = 'unstable';
    isStable = false;
  } else if (peakOvershoot !== null) {
    if (peakOvershoot < 0.5) dampingAssessment = 'overdamped';
    else if (peakOvershoot < 5) dampingAssessment = 'critically_damped';
    else dampingAssessment = 'underdamped';
  }

  return {
    riseTime,
    peakOvershoot,
    settlingTime,
    steadyStateError,
    peakTime,
    peakValue,
    oscillationFrequency,
    isStable,
    dampingAssessment,
    sustainedOscillation,
    settlingStatus,
    saturationFraction,
  };
}

// ---------------------------------------------------------------------------
// Run a fast-forward micro-simulation for tuning optimization.
// Pure function — safe to call from a Web Worker context.
// ---------------------------------------------------------------------------
export function runMicroSimulation(
  plant: PlantParameters,
  gains: PIDGains,
  setpoint: number,
  horizon: number,
  dt: number = 0.002,
  gravityInRadians: boolean = false,
): { data: DataPoint[]; cost: number; metrics: StepResponseMetrics } {
  const config: PIDConfig = {
    ...gains,
    derivativeFilterN: 20,
    integralClamp: [-1000, 1000],
    derivativeOnMeasurement: true,
    antiWindupKb: 0.5,
    dt,
  };

  let pState = createPlantState(plant);
  let cState = createControllerState();
  const data: DataPoint[] = [];

  const steps = Math.ceil(horizon / dt);

  let costError = 0;
  let costControl = 0;
  let costControlRate = 0;
  let prevU = 0;
  let diverged = false;

  for (let i = 0; i < steps; i++) {
    const t = i * dt;
    const sp = t < 0.01 ? 0 : setpoint;

    const result = simulationStep(sp, pState, cState, plant, config, 0, undefined, gravityInRadians);

    if (result.status === 'runaway') {
      diverged = true;
      break;
    }

    pState = result.plantState;
    cState = result.controllerState;

    const e = sp - result.processVariable;
    costError += t * e * e * dt;        // ITAE: time-weighted
    costControl += result.controlEffort * result.controlEffort * dt;
    const du = result.controlEffort - prevU;
    costControlRate += du * du * dt;
    prevU = result.controlEffort;

    // Subsample for data storage (every 10 steps)
    if (i % 10 === 0) {
      data.push({
        time: t,
        setpoint: sp,
        processVariable: result.processVariable,
        controlEffort: result.controlEffort,
        error: e,
        pTerm: cState.pTerm,
        iTerm: cState.iTerm,
        dTerm: cState.dTerm,
      });
    }
  }

  const metrics = computeStepResponseMetrics(data, setpoint, {
    stepStartTime: 0.01,
    initialValue: 0,
    actuatorLimits: plant.actuatorLimits,
  });

  // Penalize divergence, sustained oscillation, and saturation in cost
  const SATURATION_PENALTY_WEIGHT = 500;
  const UNSETTLED_PENALTY = 1e5;
  const SUSTAINED_OSCILLATION_PENALTY = 1e6;

  const baseCost = costError + 0.01 * costControl + 0.001 * costControlRate;
  let cost = diverged ? baseCost * 1000 + 1e8 : baseCost;

  if (metrics.saturationFraction) {
    cost += metrics.saturationFraction * SATURATION_PENALTY_WEIGHT;
  }
  if (metrics.sustainedOscillation) {
    cost += SUSTAINED_OSCILLATION_PENALTY;
  } else if (!metrics.isStable || metrics.settlingTime === null || !Number.isFinite(metrics.settlingTime)) {
    cost += UNSETTLED_PENALTY;
  }

  return { data, cost, metrics };
}

// ---------------------------------------------------------------------------
// Telemetry Ring Buffer — Zero-Allocation Fixed-Capacity Circular Buffer
// ---------------------------------------------------------------------------
export class TelemetryRingBuffer {
  readonly capacity: number;
  private _head: number = 0;
  private _length: number = 0;
  private _time: Float64Array;
  private _setpoint: Float64Array;
  private _processVariable: Float64Array;
  private _controlEffort: Float64Array;
  private _error: Float64Array;
  private _pTerm: Float64Array;
  private _iTerm: Float64Array;
  private _dTerm: Float64Array;

  constructor(capacity: number = 600) {
    this.capacity = capacity;
    this._time = new Float64Array(capacity);
    this._setpoint = new Float64Array(capacity);
    this._processVariable = new Float64Array(capacity);
    this._controlEffort = new Float64Array(capacity);
    this._error = new Float64Array(capacity);
    this._pTerm = new Float64Array(capacity);
    this._iTerm = new Float64Array(capacity);
    this._dTerm = new Float64Array(capacity);
  }

  get length(): number {
    return this._length;
  }

  clear(): void {
    this._head = 0;
    this._length = 0;
  }

  push(point: DataPoint): void {
    const idx = (this._head + this._length) % this.capacity;
    this._time[idx] = point.time;
    this._setpoint[idx] = point.setpoint;
    this._processVariable[idx] = point.processVariable;
    this._controlEffort[idx] = point.controlEffort;
    this._error[idx] = point.error;
    this._pTerm[idx] = point.pTerm;
    this._iTerm[idx] = point.iTerm;
    this._dTerm[idx] = point.dTerm;

    if (this._length < this.capacity) {
      this._length++;
    } else {
      // Overwrite oldest sample: advance head
      this._head = (this._head + 1) % this.capacity;
    }
  }

  forEach(fn: (dp: DataPoint, index: number) => void): void {
    for (let i = 0; i < this._length; i++) {
      const idx = (this._head + i) % this.capacity;
      fn(
        {
          time: this._time[idx],
          setpoint: this._setpoint[idx],
          processVariable: this._processVariable[idx],
          controlEffort: this._controlEffort[idx],
          error: this._error[idx],
          pTerm: this._pTerm[idx],
          iTerm: this._iTerm[idx],
          dTerm: this._dTerm[idx],
        },
        i
      );
    }
  }

  toArray(): DataPoint[] {
    const arr = new Array<DataPoint>(this._length);
    for (let i = 0; i < this._length; i++) {
      const idx = (this._head + i) % this.capacity;
      arr[i] = {
        time: this._time[idx],
        setpoint: this._setpoint[idx],
        processVariable: this._processVariable[idx],
        controlEffort: this._controlEffort[idx],
        error: this._error[idx],
        pTerm: this._pTerm[idx],
        iTerm: this._iTerm[idx],
        dTerm: this._dTerm[idx],
      };
    }
    return arr;
  }
}
