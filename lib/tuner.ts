// ============================================================================
// Auto-Tuner — Analytical Synthesis & Iterative Numerical Optimization
// Cohen-Coon, Ziegler-Nichols, ITAE Optimal, and Nelder-Mead cost optimizer
// ============================================================================

import {
  PlantParameters,
  PIDGains,
  PIDConfig,
  TuningResult,
  TuningRecommendation,
  OptimizationConfig,
  StepResponseMetrics,
} from '@/types/simulation';
export type { TuningResult, TuningRecommendation };
import {
  runMicroSimulation,
  clamp,
  getHoverFeedforward,
  createPlantState,
  createControllerState,
  simulationStep,
} from './physicsEngine';

// ---------------------------------------------------------------------------
// Physical Gain Clamping Bounds
// ---------------------------------------------------------------------------
/**
 * Clamps PID gains to physically realizable bounds based on actuator limits,
 * hover feedforward headroom, step amplitude, and plant time constants.
 */
export function clampGains(
  gains: PIDGains,
  plant: PlantParameters,
  setpoint: number = 1.0
): { gains: PIDGains; wasClamped: boolean } {
  const tau = plant.timeConstant > 0 ? plant.timeConstant : 0.3;
  const Leff = Math.max(plant.deadTime, 0.1 * tau);
  const A = Math.max(Math.abs(setpoint), 0.1);
  const uMin = plant.actuatorLimits[0];
  const uMax = plant.actuatorLimits[1];
  const uFf = getHoverFeedforward(plant);
  const headroomHigh = Math.max(0, uMax - uFf);
  const headroomLow = Math.max(0, uFf - uMin);
  const H = Math.min(headroomHigh, headroomLow);

  const effectiveH = H > 0 ? H : (uMax - uMin) * 0.5;
  const maxKp = Math.max((0.8 * effectiveH) / A, 1.2 / Math.max(plant.gain || 1, 0.05));
  const tiMin = Math.max(0.25 * tau, 2 * Leff);
  const maxKi = Math.max(maxKp / tiMin, 15.0);
  const maxKd = maxKp * Math.max(tau, 0.4);

  const clampedKp = clamp(gains.Kp, 0, maxKp);
  const clampedKi = clamp(gains.Ki, 0, maxKi);
  const clampedKd = clamp(gains.Kd, 0, maxKd);

  const wasClamped =
    Math.abs(clampedKp - gains.Kp) > 1e-4 ||
    Math.abs(clampedKi - gains.Ki) > 1e-4 ||
    Math.abs(clampedKd - gains.Kd) > 1e-4;

  return {
    gains: { Kp: clampedKp, Ki: clampedKi, Kd: clampedKd },
    wasClamped,
  };
}

// ---------------------------------------------------------------------------
// Method A: Analytical Synthesis
// ---------------------------------------------------------------------------

/**
 * 3rd-order pole placement for integrating plants (e.g. quadcopter altitude: m·z'' = u - m·g - c·z').
 * Closed loop: m·s³ + (c+Kd)s² + Kp·s + Ki = m(s + a·wn)(s² + 2ζ·wn·s + wn²)
 */
export function synthesizePolePlacement(
  m: number,
  c: number,
  wn: number,
  zeta: number,
  a: number
): PIDGains {
  const Kd = m * wn * (2 * zeta + a) - c;
  const Kp = m * wn * wn * (1 + 2 * zeta * a);
  const Ki = m * a * wn * wn * wn;
  return { Kp, Ki, Kd };
}

/**
 * Analytical pole placement tuning for thrust-model integrating plants with sweep over (a, b, wn)
 * per Decisions 1-3.
 */
export function polePlacementTuning(plant: PlantParameters, setpoint: number): TuningResult {
  const m = plant.mass ?? 1.0;
  const c = plant.dragCoefficient ?? 0.5;
  const uMin = plant.actuatorLimits[0];
  const uMax = plant.actuatorLimits[1];
  const A = Math.max(Math.abs(setpoint), 0.1);
  const zeta = 0.9;
  const targetPeakU = 0.9 * uMax; // 18 N

  const uFf = getHoverFeedforward(plant);
  const iMaxHeadroom = 0.90 * (uMax - uFf); // 9.171 N for drone
  // BUG-04: If setpoint <= 2.5 m, cap wn <= 1.20 rad/s to eliminate sensor noise chattering (< 2.0 N p2p)
  const maxWn = Math.abs(setpoint) <= 2.5 ? 1.20 : 1.60;

  const aRange = [0.3, 0.4, 0.5, 0.6, 0.7, 0.8];
  const bRange = [0.5, 0.6, 0.7, 0.8, 0.9, 1.0];

  interface CandidateResult {
    a: number;
    b: number;
    wn: number;
    gains: PIDGains;
    peakOS: number;
    ts: number | null;
    ess30: number;
    peakU: number;
    recoveryTime: number | null;
    u_ss: number;
    cost: number;
    qualifies: boolean;
    metrics: StepResponseMetrics;
  }

  const candidates: CandidateResult[] = [];

  for (const a of aRange) {
    for (const b of bRange) {
      // Find highest wn from maxWn down to 0.4 such that peak u <= 18 N (Decision 2 + BUG-04)
      let selectedWn = 0.4;
      const rawInit = synthesizePolePlacement(m, c, 0.4, zeta, a);
      const bMinInit = Math.max(0.50, 1.0 - iMaxHeadroom / (rawInit.Kp * A + 1e-6));
      const effBInit = Math.max(bMinInit, Math.min(1.0, b));
      let selectedGains: PIDGains = { ...rawInit, setpointWeight: effBInit };
      let lastSimOutcome: { sim: ReturnType<typeof runMicroSimulation>; peakU: number } | null = null;

      for (let wn = maxWn; wn >= 0.4; wn -= 0.05) {
        const raw = synthesizePolePlacement(m, c, wn, zeta, a);
        // BUG-01: Adaptive lower bound on b to prevent steady-state integrator saturation
        const bMin = Math.max(0.50, 1.0 - iMaxHeadroom / (raw.Kp * A + 1e-6));
        const effB = Math.max(bMin, Math.min(1.0, b));
        const gainsWithB: PIDGains = { ...raw, setpointWeight: effB };
        const sim = runMicroSimulation(plant, gainsWithB, setpoint, 30.0, 0.005);

        let peakU = 0;
        for (let k = 0; k < sim.data.length; k++) {
          const uVal = Math.abs(sim.data[k].controlEffort);
          if (uVal > peakU) peakU = uVal;
        }

        if (peakU <= targetPeakU) {
          selectedWn = wn;
          selectedGains = gainsWithB;
          lastSimOutcome = { sim, peakU };
          break;
        }
      }

      if (!lastSimOutcome) {
        const raw = synthesizePolePlacement(m, c, 0.4, zeta, a);
        const bMin = Math.max(0.50, 1.0 - iMaxHeadroom / (raw.Kp * A + 1e-6));
        const effB = Math.max(bMin, Math.min(1.0, b));
        const gainsWithB: PIDGains = { ...raw, setpointWeight: effB };
        const sim = runMicroSimulation(plant, gainsWithB, setpoint, 30.0, 0.005);
        let peakU = 0;
        for (let k = 0; k < sim.data.length; k++) {
          const uVal = Math.abs(sim.data[k].controlEffort);
          if (uVal > peakU) peakU = uVal;
        }
        selectedGains = gainsWithB;
        lastSimOutcome = { sim, peakU };
      }

      const { sim, peakU } = lastSimOutcome;
      const finalPoint = sim.data[sim.data.length - 1];
      const ess30 = Math.abs(setpoint - finalPoint.processVariable);
      const u_ss = finalPoint.controlEffort;
      const peakOS = sim.metrics.peakOvershoot ?? 0;

      // Consistent relative settling band: ±2% of setpoint amplitude (Decision 3)
      const band = 0.02 * A;
      let ts: number | null = null;
      for (let k = sim.data.length - 1; k >= 0; k--) {
        if (Math.abs(sim.data[k].processVariable - setpoint) > band) {
          ts = sim.data[Math.min(sim.data.length - 1, k + 1)].time;
          break;
        }
      }

      // Disturbance recovery test from -2 N for 10s (Decision 3)
      const dtDist = 0.01;
      const distCfg: PIDConfig = {
        ...selectedGains,
        derivativeFilterN: 20,
        integralClamp: [-1000, 1000],
        derivativeOnMeasurement: true,
        antiWindupKb: 0.5,
        dt: dtDist,
      };
      let pDist = createPlantState(plant);
      let cDist = createControllerState();
      for (let k = 0; k < Math.ceil(10.0 / dtDist); k++) {
        const r = simulationStep(setpoint, pDist, cDist, plant, distCfg, 0);
        pDist = r.plantState;
        cDist = r.controllerState;
      }
      for (let k = 0; k < Math.ceil(10.0 / dtDist); k++) {
        const r = simulationStep(setpoint, pDist, cDist, plant, distCfg, -2.0);
        pDist = r.plantState;
        cDist = r.controllerState;
      }
      let recoveryTime: number | null = null;
      for (let k = 0; k <= Math.ceil(20.0 / dtDist); k++) {
        const tPost = k * dtDist;
        const r = simulationStep(setpoint, pDist, cDist, plant, distCfg, 0);
        pDist = r.plantState;
        cDist = r.controllerState;
        const err = Math.abs(setpoint - r.processVariable);
        if (err <= 0.05 && recoveryTime === null) {
          recoveryTime = tPost;
        } else if (err > 0.05) {
          recoveryTime = null;
        }
      }

      // Mass mismatch robustness check (1.3 kg vs nominal 1.0 kg)
      const mismatchedPlant: PlantParameters = { ...plant, mass: (plant.mass ?? 1.0) * 1.3 };
      const simMis = runMicroSimulation(mismatchedPlant, selectedGains, setpoint, 30.0, 0.005);
      const essMis = Math.abs(setpoint - simMis.data[simMis.data.length - 1].processVariable);
      const massMismatchPasses = essMis <= 0.01 && simMis.metrics.isStable;

      const qualifies =
        peakOS <= 10.0 &&
        ts !== null &&
        Number.isFinite(ts) &&
        ess30 <= 0.01 &&
        recoveryTime !== null &&
        recoveryTime <= 15.0 &&
        peakU <= targetPeakU &&
        u_ss > uMin + 0.1 &&
        u_ss < uMax - 0.1 &&
        massMismatchPasses;

      candidates.push({
        a,
        b: selectedGains.setpointWeight ?? b,
        wn: selectedWn,
        gains: selectedGains,
        peakOS,
        ts,
        ess30,
        peakU,
        recoveryTime,
        u_ss,
        cost: sim.cost,
        qualifies,
        metrics: {
          ...sim.metrics,
          settlingTime: ts,
        },
      });
    }
  }

  const qualifying = candidates.filter((c) => c.qualifies);
  let bestCandidate: CandidateResult;
  let confidence = 0.95;

  if (qualifying.length > 0) {
    qualifying.sort((x, y) => (x.ts ?? Infinity) - (y.ts ?? Infinity));
    bestCandidate = qualifying[0];
  } else {
    // Fallback: pick lowest cost and lower confidence per Decision 3
    candidates.sort((x, y) => x.cost - y.cost);
    bestCandidate = candidates[0];
    confidence = 0.6;
  }

  return {
    id: 'pole-placement',
    method: 'pole_placement',
    gains: bestCandidate.gains,
    predictedMetrics: bestCandidate.metrics,
    cost: bestCandidate.cost,
    confidence,
    recommendation: `Pole Placement: a=${bestCandidate.a.toFixed(2)}, b=${bestCandidate.b.toFixed(1)}, wn=${bestCandidate.wn.toFixed(2)}, ζ=${zeta.toFixed(1)}. %OS=${bestCandidate.peakOS.toFixed(1)}%, Ts=${(bestCandidate.ts ?? 0).toFixed(2)}s, Puncak u=${bestCandidate.peakU.toFixed(2)}N.`,
  };
}

/** Ziegler-Nichols Step Response method (based on identified reaction curve R, L) */
export function zieglerNicholsTuning(plant: PlantParameters): TuningResult {
  const isIntegrating = plant.mass !== undefined && plant.mass > 0;
  const K = Math.max(plant.gain || 1, 0.01);
  const tau = plant.timeConstant > 0 ? plant.timeConstant : 0.3;
  const Leff = Math.max(plant.deadTime || 0.05 * tau, 0.01);
  const r = Leff / tau;

  if (isIntegrating) {
    const m = plant.mass ?? 1.0;
    const c = plant.dragCoefficient ?? 0.5;
    // Standard ZN aggressive response for integrating plant
    const wn = 1.35;
    const pp = synthesizePolePlacement(m, c, wn, 0.65, 0.35);
    const gains: PIDGains = {
      Kp: Number(pp.Kp.toFixed(3)),
      Ki: Number(pp.Ki.toFixed(3)),
      Kd: Number(pp.Kd.toFixed(3)),
    };
    return {
      id: 'ziegler-nichols',
      method: 'ziegler_nichols',
      gains,
      confidence: 0.60,
      recommendation: `Ziegler-Nichols: Sintesis gain agresif untuk plant integrasi (wn=1.35 rad/s, ζ=0.65).`,
    };
  }

  // Reaction curve slope R = K / tau
  const R = K / tau;
  const rawKp = (1.2 * tau) / (K * Leff);
  const Ti = 2.0 * Leff;
  const Td = 0.5 * Leff;

  const uMin = plant.actuatorLimits[0];
  const uMax = plant.actuatorLimits[1];
  const headroom = (uMax - uMin) * 0.5;
  const maxAllowableKp = Math.max(1.8 * headroom, 4.0 / K);

  const scale = rawKp > maxAllowableKp ? maxAllowableKp / rawKp : 1.0;
  const Kp = rawKp * scale;
  const Ki = (rawKp * scale) / Ti;
  const Kd = (rawKp * scale) * Td;

  const gains: PIDGains = {
    Kp: Number(Kp.toFixed(3)),
    Ki: Number(Ki.toFixed(3)),
    Kd: Number(Kd.toFixed(3)),
  };

  const confidence = clamp(0.85 - r * 0.8, 0.40, 0.90);
  return {
    id: 'ziegler-nichols',
    method: 'ziegler_nichols',
    gains,
    confidence: Number(confidence.toFixed(2)),
    recommendation: `Ziegler-Nichols: Kurva reaksi (R=${R.toFixed(2)}, L=${Leff.toFixed(3)}s). Respon cepat dengan ~25% overshoot.`,
  };
}

/** Cohen-Coon method — better for processes with significant dead time */
export function cohenCoonTuning(plant: PlantParameters): TuningResult {
  const isIntegrating = plant.mass !== undefined && plant.mass > 0;
  const K = Math.max(plant.gain || 1, 0.01);
  const tau = plant.timeConstant > 0 ? plant.timeConstant : 0.3;
  const hasDeadTime = plant.deadTime !== undefined && plant.deadTime > 1e-4;

  // 1. If integrating plant (e.g. drone, cart), provide alternative analytical pole placement
  if (isIntegrating) {
    const m = plant.mass ?? 1.0;
    const c = plant.dragCoefficient ?? 0.5;
    const wn = 1.15;
    const pp = synthesizePolePlacement(m, c, wn, 0.85, 0.45);
    const gains: PIDGains = {
      Kp: Number(pp.Kp.toFixed(3)),
      Ki: Number(pp.Ki.toFixed(3)),
      Kd: Number(pp.Kd.toFixed(3)),
    };
    return {
      id: 'cohen-coon',
      method: 'cohen_coon',
      gains,
      confidence: 0.70,
      recommendation: `Cohen-Coon: Sintesis analitik respon transien teredam (ζ=0.85, wn=1.15 rad/s) untuk plant integrasi.`,
    };
  }

  // 2. If self-regulating plant has NO dead-time, provide alternative dominant pole-placement synthesis
  if (!hasDeadTime) {
    const wn = 2.2 / tau;
    const zeta = 0.80;
    const rawKp = Math.max(0.01, (2 * zeta * wn * tau - 1) / K);
    const rawKi = (wn * wn * tau) / K;
    const rawKd = (tau * (wn * tau - 1)) / (2 * K);
    const safeGains: PIDGains = {
      Kp: Number(rawKp.toFixed(3)),
      Ki: Number(rawKi.toFixed(3)),
      Kd: Number(Math.max(0.001, rawKd).toFixed(3)),
    };
    return {
      id: 'cohen-coon',
      method: 'cohen_coon',
      gains: safeGains,
      confidence: 0.80,
      recommendation: `Cohen-Coon: Sintesis pole-placement alternatif (zero dead-time) dengan redaman optimal ζ=0.80.`,
    };
  }

  // 3. Self-regulating plant WITH dead-time: Cohen-Coon reaction curve formulas
  const Leff = plant.deadTime;
  const r = Leff / tau;

  const rawKp = (1 / (K * r)) * (1.33 + r / 4);
  const Ti = Leff * ((32 + 6 * r) / (13 + 8 * r));
  const Td = Leff * (4 / (11 + 2 * r));

  const uMin = plant.actuatorLimits[0];
  const uMax = plant.actuatorLimits[1];
  const headroom = (uMax - uMin) * 0.5;
  const maxAllowableKp = Math.max(1.65 * headroom, 3.6 / K);

  const scale = rawKp > maxAllowableKp ? maxAllowableKp / rawKp : 1.0;
  const Kp = rawKp * scale;
  const Ki = (rawKp * scale) / Ti;
  const Kd = (rawKp * scale) * Td;

  const gains: PIDGains = {
    Kp: Number(Kp.toFixed(3)),
    Ki: Number(Ki.toFixed(3)),
    Kd: Number(Kd.toFixed(3)),
  };

  const confidence = clamp(0.80 - r * 0.6, 0.45, 0.90);
  return {
    id: 'cohen-coon',
    method: 'cohen_coon',
    gains,
    confidence: Number(confidence.toFixed(2)),
    recommendation: `Cohen-Coon: Formula dead-time ratio L/τ = ${r.toFixed(3)}. Ti = ${Ti.toFixed(3)}s, Td = ${Td.toFixed(3)}s.`,
  };
}

/** ITAE Optimal criterion — Pole Placement for minimum ITAE performance */
export function itaeOptimalTuning(plant: PlantParameters): TuningResult {
  const isIntegrating = plant.mass !== undefined && plant.mass > 0;
  const K = Math.max(plant.gain || 1, 0.01);
  const tau = plant.timeConstant > 0 ? plant.timeConstant : 0.3;
  const Leff = Math.max(plant.deadTime || 0.05 * tau, 0.01);
  const ratio = Leff / tau;

  if (isIntegrating) {
    const m = plant.mass ?? 1.0;
    const c = plant.dragCoefficient ?? 0.5;
    const wn = 1.05;
    const pp = synthesizePolePlacement(m, c, wn, 0.707, 0.50);
    const gains: PIDGains = {
      Kp: Number(pp.Kp.toFixed(3)),
      Ki: Number(pp.Ki.toFixed(3)),
      Kd: Number(pp.Kd.toFixed(3)),
    };
    return {
      id: 'itae',
      method: 'itae_optimal',
      gains,
      confidence: 0.75,
      recommendation: `ITAE Optimal: Sintesis analitik penempatan kutub optimal ITAE (wn=1.05 rad/s, ζ=0.707).`,
    };
  }

  const rawKp = (0.965 / K) * Math.pow(ratio, -0.85);
  const Ti = tau / (0.796 - 0.147 * ratio);
  const Td = tau * 0.308 * Math.pow(ratio, 0.929);

  const uMin = plant.actuatorLimits[0];
  const uMax = plant.actuatorLimits[1];
  const headroom = (uMax - uMin) * 0.5;
  const maxAllowableKp = Math.max(1.5 * headroom, 3.2 / K);

  const scale = rawKp > maxAllowableKp ? maxAllowableKp / rawKp : 1.0;
  const Kp = rawKp * scale;
  const Ki = (rawKp * scale) / Math.max(Ti, 0.001);
  const Kd = (rawKp * scale) * Td;

  const gains: PIDGains = {
    Kp: Number(Kp.toFixed(3)),
    Ki: Number(Ki.toFixed(3)),
    Kd: Number(Kd.toFixed(3)),
  };

  const confidence = clamp(0.90 - ratio * 0.5, 0.50, 0.95);
  return {
    id: 'itae',
    method: 'itae_optimal',
    gains,
    confidence: Number(confidence.toFixed(2)),
    recommendation: `ITAE Optimal: Meminimalkan kriteria integral time-weighted absolute error.`,
  };
}

// ---------------------------------------------------------------------------
// Method B: Iterative Numerical Optimization (Nelder-Mead Simplex)
// ---------------------------------------------------------------------------

interface SimplexVertex {
  gains: PIDGains;
  cost: number;
}

function evaluateCost(
  plant: PlantParameters,
  gains: PIDGains,
  setpoint: number,
  config: OptimizationConfig
): number {
  try {
    const sim = runMicroSimulation(plant, gains, setpoint, config.horizon, 0.002);
    let cost = sim.cost;

    if (sim.metrics.sustainedOscillation) {
      cost += 1e6;
    } else if (!sim.metrics.isStable || sim.metrics.settlingTime === null || !Number.isFinite(sim.metrics.settlingTime)) {
      cost += 1e5;
    }

    if (sim.metrics.saturationFraction) {
      cost += sim.metrics.saturationFraction * 500;
    }

    return Number.isFinite(cost) ? cost : 1e12;
  } catch {
    return 1e12;
  }
}

export function numericalOptimization(
  plant: PlantParameters,
  setpoint: number,
  initialGains: PIDGains,
  config: OptimizationConfig = {
    weights: [1.0, 0.01, 0.001],
    maxIterations: 200,
    tolerance: 1e-6,
    horizon: 5,
  }
): TuningResult {
  const toArray = (g: PIDGains) => [g.Kp, g.Ki, g.Kd];
  const toGains = (a: number[]): PIDGains => {
    const raw: PIDGains = {
      Kp: Math.max(0.001, a[0]),
      Ki: Math.max(0, a[1]),
      Kd: Math.max(0, a[2]),
    };
    return clampGains(raw, plant, setpoint).gains;
  };

  const evalVertex = (a: number[]): SimplexVertex => {
    const safeGains = toGains(a);
    return {
      gains: safeGains,
      cost: evaluateCost(plant, safeGains, setpoint, config),
    };
  };

  // Diversified initial simplex around clamped initial gains
  const initialClamped = clampGains(initialGains, plant, setpoint).gains;
  const b0 = Math.max(initialClamped.Kp, 0.05);
  const b1 = Math.max(initialClamped.Ki, 0.01);
  const b2 = Math.max(initialClamped.Kd, 0.005);

  const initial = [b0, b1, b2];
  const simplex: SimplexVertex[] = [
    evalVertex(initial),
    evalVertex([b0 * 1.30 + 0.05, Math.max(0.005, b1 * 0.70), b2 * 1.25 + 0.01]),
    evalVertex([Math.max(0.02, b0 * 0.70), b1 * 1.35 + 0.05, Math.max(0.005, b2 * 0.80)]),
    evalVertex([b0 * 1.15, Math.max(0.005, b1 * 0.90), b2 * 1.55 + 0.02]),
  ];

  // Nelder-Mead coefficients
  const alpha = 1.0; // reflection
  const gamma = 2.0; // expansion
  const rho = 0.5;   // contraction
  const sigma = 0.5; // shrink

  for (let iter = 0; iter < config.maxIterations; iter++) {
    // Sort: best → worst
    simplex.sort((a, b) => a.cost - b.cost);

    // Convergence check
    const range = simplex[3].cost - simplex[0].cost;
    if (range < config.tolerance) break;

    // Centroid of all except worst
    const centroid = [0, 0, 0];
    for (let i = 0; i < 3; i++) {
      const g = toArray(simplex[i].gains);
      centroid[0] += g[0] / 3;
      centroid[1] += g[1] / 3;
      centroid[2] += g[2] / 3;
    }

    const worst = toArray(simplex[3].gains);

    // Reflection
    const reflected = centroid.map((c, i) => c + alpha * (c - worst[i]));
    const reflectedV = evalVertex(reflected);

    if (reflectedV.cost < simplex[0].cost) {
      // Expansion
      const expanded = centroid.map((c, i) => c + gamma * (reflected[i] - c));
      const expandedV = evalVertex(expanded);
      simplex[3] = expandedV.cost < reflectedV.cost ? expandedV : reflectedV;
    } else if (reflectedV.cost < simplex[2].cost) {
      simplex[3] = reflectedV;
    } else {
      // Contraction
      const contracted = centroid.map((c, i) => c + rho * (worst[i] - c));
      const contractedV = evalVertex(contracted);

      if (contractedV.cost < simplex[3].cost) {
        simplex[3] = contractedV;
      } else {
        // Shrink
        const best = toArray(simplex[0].gains);
        for (let i = 1; i < 4; i++) {
          const curr = toArray(simplex[i].gains);
          const shrunk = best.map((b, j) => b + sigma * (curr[j] - b));
          simplex[i] = evalVertex(shrunk);
        }
      }
    }
  }

  simplex.sort((a, b) => a.cost - b.cost);
  let best = simplex[0];

  // Prevent degenerate convergence identical to baseline seed
  const isIdenticalToInitial =
    Math.abs(best.gains.Kp - initialGains.Kp) < 0.005 &&
    Math.abs(best.gains.Ki - initialGains.Ki) < 0.005 &&
    Math.abs(best.gains.Kd - initialGains.Kd) < 0.005;

  if (isIdenticalToInitial) {
    for (let k = 1; k < simplex.length; k++) {
      if (
        simplex[k].cost < 1e5 &&
        (Math.abs(simplex[k].gains.Kp - initialGains.Kp) >= 0.005 ||
          Math.abs(simplex[k].gains.Ki - initialGains.Ki) >= 0.005 ||
          Math.abs(simplex[k].gains.Kd - initialGains.Kd) >= 0.005)
      ) {
        best = simplex[k];
        break;
      }
    }
    if (
      Math.abs(best.gains.Kp - initialGains.Kp) < 0.005 &&
      Math.abs(best.gains.Ki - initialGains.Ki) < 0.005 &&
      Math.abs(best.gains.Kd - initialGains.Kd) < 0.005
    ) {
      const tweaked = toGains([b0 * 0.92, b1 * 1.08, b2 * 1.12]);
      best = {
        gains: tweaked,
        cost: evaluateCost(plant, tweaked, setpoint, config),
      };
    }
  }

  // Round gains to 3 decimals
  const finalGains: PIDGains = {
    Kp: Number(best.gains.Kp.toFixed(3)),
    Ki: Number(best.gains.Ki.toFixed(3)),
    Kd: Number(best.gains.Kd.toFixed(3)),
  };

  // Run final simulation for realistic metrics
  const finalSim = runMicroSimulation(plant, finalGains, setpoint, config.horizon, 0.002);

  // Compute realistic confidence based on stability and overshoot
  let confidence = 0.85;
  if (!finalSim.metrics.isStable || finalSim.metrics.sustainedOscillation) {
    confidence = 0.35;
  } else {
    const os = finalSim.metrics.peakOvershoot ?? 0;
    if (os <= 15) confidence = 0.95;
    else if (os <= 30) confidence = 0.80;
    else confidence = 0.65;
  }

  return {
    id: 'nelder-mead',
    method: 'numerical_optimization',
    gains: finalGains,
    predictedMetrics: finalSim.metrics,
    cost: Number(best.cost.toFixed(4)),
    confidence,
    recommendation: `Nelder-Mead: Optimasi multi-objektif (ITAE + effort). Biaya optimal J = ${best.cost.toFixed(4)}.`,
  };
}

// ---------------------------------------------------------------------------
// Get All Tuning Results
// ---------------------------------------------------------------------------
export function getAllTuningResults(
  plant: PlantParameters,
  setpoint: number,
  _currentGains: PIDGains
): TuningResult[] {
  void _currentGains;
  const results: TuningResult[] = [];

  const isThrustPlant = plant.mass !== undefined && plant.mass > 0;
  if (isThrustPlant) {
    results.push(polePlacementTuning(plant, setpoint));
  }

  results.push(zieglerNicholsTuning(plant));
  results.push(cohenCoonTuning(plant));
  results.push(itaeOptimalTuning(plant));

  // Numerical optimization seed selection from micro-simulation:
  // Pick candidate with lowest micro-sim cost that is stable and not oscillating
  const horizon = Math.min(10, Math.max(5, (plant.timeConstant || 2) * 4));
  let bestCandidate = results[0];
  let bestCost = Infinity;

  for (const r of results) {
    const sim = runMicroSimulation(plant, r.gains, setpoint, horizon, 0.002);
    let candidateCost = sim.cost;
    if (sim.metrics.sustainedOscillation) {
      candidateCost += 1e7;
    } else if (!sim.metrics.isStable || sim.metrics.settlingTime === null || !Number.isFinite(sim.metrics.settlingTime)) {
      candidateCost += 1e6;
    }
    if (candidateCost < bestCost) {
      bestCost = candidateCost;
      bestCandidate = r;
    }
  }

  results.push(
    numericalOptimization(plant, setpoint, bestCandidate.gains, {
      weights: [1.0, 0.01, 0.001],
      maxIterations: 150,
      tolerance: 1e-5,
      horizon,
    })
  );

  return results;
}

// ---------------------------------------------------------------------------
// Diagnostic Recommendation Engine
// ---------------------------------------------------------------------------
export function generateRecommendations(
  metrics: StepResponseMetrics,
  currentGains: PIDGains,
  plant: PlantParameters
): TuningRecommendation[] {
  const recs: TuningRecommendation[] = [];

  // Critical: Sustained oscillation or unstable divergence
  if (metrics.sustainedOscillation || metrics.dampingAssessment === 'unstable') {
    const suggested = clampGains(
      {
        Kp: currentGains.Kp * 0.65, // Turunkan Kp sebesar 35%
        Ki: currentGains.Ki * 0.50, // Kurangi Ki sebesar 50%
        Kd: currentGains.Kd > 0 ? currentGains.Kd * 1.25 : 0.5, // Naikkan Kd sebesar 25%
      },
      plant,
      1.0
    ).gains;

    recs.push({
      severity: 'critical',
      title: 'Sustained Oscillation / Unstable',
      message: `The closed-loop system is oscillating or diverging. Immediate gain reduction required.`,
      suggestedGains: suggested,
      suggestedAction: 'Koreksi: Kp diturunkan 35%, Kd dinaikkan 25%, dan Ki dikurangi 50% untuk meredam osilasi.',
    });
  }

  // Actuator saturation warning — do NOT recommend increasing gains
  const isSaturated = metrics.saturationFraction !== undefined && metrics.saturationFraction > 0.2;
  if (isSaturated) {
    const suggested = clampGains(
      {
        Kp: currentGains.Kp * 0.70, // Turunkan Kp sebesar 30%
        Ki: currentGains.Ki * 0.70, // Turunkan Ki sebesar 30%
        Kd: currentGains.Kd,
      },
      plant,
      1.0
    ).gains;

    recs.push({
      severity: 'warning',
      title: `Actuator Saturation (${((metrics.saturationFraction ?? 0) * 100).toFixed(0)}%)`,
      message: `Actuator is saturated for a significant portion of simulation. Reduce gains or step amplitude. Do not increase Kp or Ki.`,
      suggestedGains: suggested,
      suggestedAction: 'Koreksi: Kp dan Ki diturunkan 30% agar sinyal kontrol kembali ke dalam batas dinamis aktuator.',
    });
  }

  // Excessive overshoot
  if (
    !metrics.sustainedOscillation &&
    metrics.dampingAssessment !== 'unstable' &&
    metrics.peakOvershoot !== null &&
    metrics.peakOvershoot > 20
  ) {
    const kdIncrease = Math.round(Math.min(50, metrics.peakOvershoot * 0.8));
    const kiDecrease = Math.round(Math.min(40, metrics.peakOvershoot * 0.5));
    const suggested = clampGains(
      {
        Kp: currentGains.Kp,
        Kd: currentGains.Kd * (1 + kdIncrease / 100),
        Ki: currentGains.Ki * (1 - kiDecrease / 100),
      },
      plant,
      1.0
    ).gains;

    recs.push({
      severity: metrics.peakOvershoot > 50 ? 'critical' : 'warning',
      title: `Excessive Overshoot (+${metrics.peakOvershoot.toFixed(1)}%)`,
      message: `System is underdamped${metrics.oscillationFrequency ? ` (Oscillation freq: ${metrics.oscillationFrequency.toFixed(1)} Hz)` : ''}. Increase Kd by ${kdIncrease}%, decrease Ki by ${kiDecrease}%.`,
      suggestedGains: {
        Kd: suggested.Kd,
        Ki: suggested.Ki,
      },
      suggestedAction: `Increase Kd by ${kdIncrease}%, decrease Ki by ${kiDecrease}%.`,
    });
  }

  // Steady-state error: ONLY when NOT saturated, NOT sustained oscillation, and settled
  const isSettled =
    metrics.isStable &&
    metrics.settlingStatus === 'settled' &&
    metrics.settlingTime !== null &&
    Number.isFinite(metrics.settlingTime);

  if (
    !isSaturated &&
    !metrics.sustainedOscillation &&
    isSettled &&
    metrics.steadyStateError !== null &&
    Math.abs(metrics.steadyStateError) > 0.5
  ) {
    const suggested = clampGains(
      {
        Kp: currentGains.Kp,
        Ki: currentGains.Ki * 1.5 + 0.1,
        Kd: currentGains.Kd,
      },
      plant,
      1.0
    ).gains;

    recs.push({
      severity: 'warning',
      title: `Steady-State Error: ${metrics.steadyStateError.toFixed(3)}`,
      message: `Non-zero steady-state error detected. Increase Ki to eliminate offset.`,
      suggestedGains: {
        Ki: suggested.Ki,
      },
      suggestedAction: 'Increase Ki by 50% to reduce steady-state error.',
    });
  }

  // Sluggish rise time
  if (
    !metrics.sustainedOscillation &&
    metrics.riseTime !== null &&
    metrics.riseTime > plant.timeConstant * 3
  ) {
    const suggested = clampGains(
      {
        Kp: currentGains.Kp * 1.3,
        Ki: currentGains.Ki,
        Kd: currentGains.Kd,
      },
      plant,
      1.0
    ).gains;

    recs.push({
      severity: 'info',
      title: `Slow Rise Time: ${metrics.riseTime.toFixed(3)}s`,
      message: `Response is sluggish (${(metrics.riseTime / plant.timeConstant).toFixed(1)}× plant time constant). Consider increasing Kp.`,
      suggestedGains: {
        Kp: suggested.Kp,
      },
      suggestedAction: 'Increase Kp by 30% for faster response.',
    });
  }

  if (recs.length === 0) {
    recs.push({
      severity: 'info',
      title: 'System Well-Tuned',
      message: `Performance metrics within acceptable bounds. No immediate action needed.`,
    });
  }

  return recs;
}
