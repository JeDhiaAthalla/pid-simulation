// ============================================================================
// Auto-Tuner — Analytical Synthesis & Iterative Numerical Optimization
// Cohen-Coon, Ziegler-Nichols, ITAE Optimal, and Nelder-Mead cost optimizer
// ============================================================================

import {
  PlantParameters,
  PIDGains,
  TuningResult,
  TuningRecommendation,
  OptimizationConfig,
  StepResponseMetrics,
} from '@/types/simulation';
export type { TuningResult, TuningRecommendation };
import { runMicroSimulation, clamp, getHoverFeedforward } from './physicsEngine';

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
  const maxKp = (0.8 * effectiveH) / A;
  const tiMin = Math.max(0.5 * tau, 4 * Leff);
  const maxKi = maxKp / tiMin;
  const maxKd = maxKp * tau;

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
 * Analytical pole placement tuning for thrust-model integrating plants with sweep over ratio 'a'.
 */
export function polePlacementTuning(plant: PlantParameters, setpoint: number): TuningResult {
  const m = plant.mass ?? 1.0;
  const c = plant.dragCoefficient ?? 0.5;
  const uMin = plant.actuatorLimits[0];
  const uMax = plant.actuatorLimits[1];
  const uFf = getHoverFeedforward(plant);
  const H = Math.min(Math.max(0, uMax - uFf), Math.max(0, uFf - uMin));
  const effectiveH = H > 0 ? H : (uMax - uMin) * 0.5;
  const A = Math.max(Math.abs(setpoint), 0.1);
  const zeta = 0.9;
  const targetWn = 1.2;

  // Sweep parameter a across candidates from 0.02 to 1.50 (20 candidate points)
  const aCandidates = [
    0.02, 0.03, 0.05, 0.08, 0.1, 0.15, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.3, 1.4, 1.5,
  ];

  interface CandidateEvaluation {
    a: number;
    gains: PIDGains;
    cost: number;
    metrics: StepResponseMetrics;
    qualifies: boolean;
  }

  const evaluations: CandidateEvaluation[] = [];

  for (const a of aCandidates) {
    const wnMax = Math.sqrt((0.8 * effectiveH) / (m * A * (1 + 2 * zeta * a)));
    const effectiveWn = Math.min(targetWn, wnMax);
    const rawGains = synthesizePolePlacement(m, c, effectiveWn, zeta, a);
    const { gains } = clampGains(rawGains, plant, setpoint);

    const sim = runMicroSimulation(plant, gains, setpoint, 30, 0.002);

    let peakU = 0;
    for (let k = 0; k < sim.data.length; k++) {
      const uVal = Math.abs(sim.data[k].controlEffort);
      if (uVal > peakU) peakU = uVal;
    }

    const osQualifies = sim.metrics.peakOvershoot !== null && sim.metrics.peakOvershoot <= 10.0;
    const tsFinite = sim.metrics.settlingTime !== null && Number.isFinite(sim.metrics.settlingTime);
    const peakEffortQualifies = peakU <= 0.9 * uMax;
    const noOscillation = !sim.metrics.sustainedOscillation;

    const qualifies = osQualifies && tsFinite && peakEffortQualifies && noOscillation;

    evaluations.push({
      a,
      gains,
      cost: sim.cost,
      metrics: sim.metrics,
      qualifies,
    });
  }

  // Filter qualifying candidates and select smallest settling time Ts with |e_ss| <= 0.01m
  const qualifying = evaluations.filter((e) => e.qualifies);
  let bestCandidate: CandidateEvaluation;
  let confidence = 0.92;

  if (qualifying.length > 0) {
    qualifying.sort((x, y) => {
      const essX = Math.abs(x.metrics.steadyStateError ?? 1);
      const essY = Math.abs(y.metrics.steadyStateError ?? 1);
      const xPassEss = essX <= 0.01;
      const yPassEss = essY <= 0.01;
      if (xPassEss && !yPassEss) return -1;
      if (!xPassEss && yPassEss) return 1;
      return (x.metrics.settlingTime ?? Infinity) - (y.metrics.settlingTime ?? Infinity);
    });
    bestCandidate = qualifying[0];
  } else {
    // Fallback: pick lowest cost
    evaluations.sort((x, y) => x.cost - y.cost);
    bestCandidate = evaluations[0];
    confidence = 0.55;
  }

  return {
    method: 'pole_placement',
    gains: bestCandidate.gains,
    predictedMetrics: bestCandidate.metrics,
    cost: bestCandidate.cost,
    confidence,
    recommendation: `Pole Placement (Integrating Thrust Model): a=${bestCandidate.a.toFixed(2)}, wn=${targetWn.toFixed(1)}, ζ=${zeta.toFixed(2)}. %OS=${(bestCandidate.metrics.peakOvershoot ?? 0).toFixed(1)}%, Ts=${(bestCandidate.metrics.settlingTime ?? 0).toFixed(2)}s.`,
  };
}

/** Ziegler-Nichols Step Response method (based on identified K, τ, L) */
export function zieglerNicholsTuning(plant: PlantParameters): TuningResult {
  const isIntegrating = plant.mass !== undefined && plant.mass > 0;
  const K = plant.gain || 1;
  const tau = plant.timeConstant || 0.3;
  const Leff = Math.max(plant.deadTime, 0.1 * tau);

  const r = Leff / tau;

  const rawKp = (1.2 * tau) / (K * Leff);
  const Ti = 2 * Leff;
  const Td = 0.5 * Leff;

  const rawKi = rawKp / Ti;
  const rawKd = rawKp * Td;

  const { gains, wasClamped } = clampGains({ Kp: rawKp, Ki: rawKi, Kd: rawKd }, plant, 1.0);

  let confidence = clamp(1 - r * 2, 0.3, 0.95);
  if (wasClamped) confidence = Math.max(0.2, confidence - 0.3);
  if (isIntegrating) confidence = 0.15;

  const recNote = isIntegrating
    ? `Ziegler-Nichols (FOPDT invalid for integrating plant without steady-state gain; pole placement recommended).`
    : `Ziegler-Nichols: Aggressive tuning for fast response. τ/L ratio = ${(tau / Leff).toFixed(1)}. Expect ~25% overshoot.`;

  return {
    method: 'ziegler_nichols',
    gains,
    confidence,
    recommendation: recNote,
  };
}

/** Cohen-Coon method — better for processes with significant dead time */
export function cohenCoonTuning(plant: PlantParameters): TuningResult {
  const isIntegrating = plant.mass !== undefined && plant.mass > 0;
  const K = plant.gain || 1;
  const tau = plant.timeConstant || 0.3;
  const Leff = Math.max(plant.deadTime, 0.1 * tau);
  const r = Leff / tau;

  const rawKp = (1 / (K * r)) * (1.33 + r / 4);
  const Ti = Leff * ((32 + 6 * r) / (13 + 8 * r));
  const Td = Leff * (4 / (11 + 2 * r));

  const rawKi = rawKp / Ti;
  const rawKd = rawKp * Td;

  const { gains, wasClamped } = clampGains({ Kp: rawKp, Ki: rawKi, Kd: rawKd }, plant, 1.0);

  let confidence = clamp(0.7 - r, 0.3, 0.9);
  if (wasClamped) confidence = Math.max(0.2, confidence - 0.3);
  if (isIntegrating) confidence = 0.15;

  const recNote = isIntegrating
    ? `Cohen-Coon (FOPDT invalid for integrating plant without steady-state gain; pole placement recommended).`
    : `Cohen-Coon: Tuned for dead-time dominant processes. Dead-time ratio r = ${r.toFixed(3)}.`;

  return {
    method: 'cohen_coon',
    gains,
    confidence,
    recommendation: recNote,
  };
}

/** ITAE Optimal criterion — Pole Placement for minimum ITAE performance */
export function itaeOptimalTuning(plant: PlantParameters): TuningResult {
  const isIntegrating = plant.mass !== undefined && plant.mass > 0;
  const K = plant.gain || 1;
  const tau = plant.timeConstant || 0.3;
  const Leff = Math.max(plant.deadTime, 0.1 * tau);

  const ratio = Leff / tau;
  const rawKp = (0.965 / K) * Math.pow(ratio, -0.85);
  const Ti = tau / (0.796 - 0.147 * ratio);
  const Td = tau * 0.308 * Math.pow(ratio, 0.929);

  const rawKi = rawKp / Math.max(Ti, 0.001);
  const rawKd = rawKp * Td;

  const { gains, wasClamped } = clampGains({ Kp: rawKp, Ki: rawKi, Kd: rawKd }, plant, 1.0);

  let confidence = clamp(0.85 - ratio * 0.5, 0.4, 0.95);
  if (wasClamped) confidence = Math.max(0.2, confidence - 0.3);
  if (isIntegrating) confidence = 0.15;

  const recNote = isIntegrating
    ? `ITAE Optimal (FOPDT invalid for integrating plant without steady-state gain; pole placement recommended).`
    : `ITAE Optimal: Minimizes time-weighted absolute error. Balanced response with minimal overshoot.`;

  return {
    method: 'itae_optimal',
    gains,
    confidence,
    recommendation: recNote,
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
      Kp: Math.max(0, a[0]),
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

  // Initialize simplex around clamped initial gains using relative ±20% perturbation
  const initialClamped = clampGains(initialGains, plant, setpoint).gains;
  const initial = toArray(initialClamped);
  const simplex: SimplexVertex[] = [evalVertex(initial)];

  for (let i = 0; i < 3; i++) {
    const p = [...initial];
    const baseVal = p[i];
    p[i] = baseVal > 1e-4 ? baseVal * 1.2 : 0.1;
    simplex.push(evalVertex(p));
  }

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
  const best = simplex[0];

  // Run final simulation for metrics
  const finalSim = runMicroSimulation(plant, best.gains, setpoint, config.horizon, 0.002);

  return {
    method: 'numerical_optimization',
    gains: best.gains,
    predictedMetrics: finalSim.metrics,
    cost: best.cost,
    confidence: clamp(1 - best.cost / 100, 0.3, 0.98),
    recommendation: `Numerical Optimization: Cost-optimal PID gains via Nelder-Mead simplex. Final cost J = ${best.cost.toFixed(4)}.`,
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
        Kp: currentGains.Kp * 0.5,
        Ki: currentGains.Ki * 0.3,
        Kd: currentGains.Kd > 0 ? currentGains.Kd * 1.4 : 0.5,
      },
      plant,
      1.0
    ).gains;

    recs.push({
      severity: 'critical',
      title: 'Sustained Oscillation / Unstable',
      message: `The closed-loop system is oscillating or diverging. Immediate gain reduction required.`,
      suggestedGains: suggested,
      suggestedAction: 'Reduce Kp by 50%, Ki by 70%, and increase derivative damping.',
    });
  }

  // Actuator saturation warning — do NOT recommend increasing gains
  const isSaturated = metrics.saturationFraction !== undefined && metrics.saturationFraction > 0.2;
  if (isSaturated) {
    const suggested = clampGains(
      {
        Kp: currentGains.Kp * 0.8,
        Ki: currentGains.Ki * 0.7,
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
      suggestedAction: 'Reduce Kp and Ki to restore control headroom.',
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
