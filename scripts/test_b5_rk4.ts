import { ROBOTS } from '../types/robots';
import { PlantParameters } from '../types/simulation';
import { rk4Step as rk4StepNew } from '../lib/physicsEngine';

// Historical rk4Step implementation from Step 217 of transcript (before Phase 1 refactor)
function plantDerivativesHistorical(
  x: number[],
  u: number,
  plant: PlantParameters,
  gravityInRadians: boolean
): number[] {
  const { dampingRatio: z, naturalFrequency: wn, gain: K, friction, gravityTorque } = plant;

  if (plant.order === 1) {
    const tau = plant.timeConstant > 0 ? plant.timeConstant : 0.01;
    const frictionTerm = friction * Math.sign(x[0]) * Math.abs(x[0]);
    const dx = (K * u - x[0] - frictionTerm) / tau;
    return [Number.isFinite(dx) ? dx : 0];
  }

  const velocity = x[1];
  const frictionForce = friction * Math.sign(velocity) * Math.abs(velocity);
  const gravityLoad = gravityTorque > 0
    ? gravityTorque * Math.sin(gravityInRadians ? x[0] : x[0] * Math.PI / 180)
    : 0;

  const accel =
    K * wn * wn * u -
    2 * z * wn * velocity -
    wn * wn * x[0] -
    frictionForce -
    gravityLoad;

  return [velocity, Number.isFinite(accel) ? accel : 0];
}

function rk4StepHistorical(
  x: number[],
  u: number,
  dt: number,
  plant: PlantParameters,
  gravityInRadians: boolean = false
): number[] {
  const k1 = plantDerivativesHistorical(x, u, plant, gravityInRadians);
  const x2 = x.map((xi, i) => xi + 0.5 * dt * k1[i]);
  const k2 = plantDerivativesHistorical(x2, u, plant, gravityInRadians);
  const x3 = x.map((xi, i) => xi + 0.5 * dt * k2[i]);
  const k3 = plantDerivativesHistorical(x3, u, plant, gravityInRadians);
  const x4 = x.map((xi, i) => xi + dt * k3[i]);
  const k4 = plantDerivativesHistorical(x4, u, plant, gravityInRadians);

  const result = x.map(
    (xi, i) => xi + (dt / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i])
  );

  return result.map(v => (Number.isFinite(v) ? v : 0));
}

export function runB5Test() {
  const dt = 0.005;
  const numTests = 10000;
  let maxDiff = 0;
  let totalEvaluations = 0;

  const nonDroneRobots = ROBOTS.filter(r => r.id !== 'quadcopter');

  console.log(`=== B5: NON-DRONE RK4 REGRESSION TEST (HISTORICAL KODE LAMA VS KODE BARU) ===`);
  console.log(`Running ${numTests} randomized evaluations across ${nonDroneRobots.length} non-drone archetypes...`);

  for (let t = 0; t < numTests; t++) {
    // Pick a random non-drone archetype
    const robot = nonDroneRobots[t % nonDroneRobots.length];
    const plant = robot.defaultPlant;
    const isRadians = robot.gravityInRadians ?? false;

    // Random states within typical operating envelopes
    const x = plant.order === 1
      ? [(Math.random() - 0.5) * 10]
      : [(Math.random() - 0.5) * 20, (Math.random() - 0.5) * 10];
    const u = (Math.random() - 0.5) * 20;

    const histX = rk4StepHistorical(x, u, dt, plant, isRadians);
    const newX = rk4StepNew(x, u, dt, plant, isRadians);

    for (let i = 0; i < x.length; i++) {
      const diff = Math.abs(histX[i] - newX[i]);
      if (diff > maxDiff) maxDiff = diff;
      totalEvaluations++;
    }
  }

  console.log(`Total state coordinate comparisons: ${totalEvaluations}`);
  console.log(`Maximum absolute difference:         ${maxDiff.toExponential(4)}`);
  console.log(`Scientific notation:                 ${maxDiff === 0 ? '0.000e+00' : maxDiff.toExponential(2)}`);
  console.log(`Target threshold:                    <= 1.0e-12`);
  console.log(`Status:                              ${maxDiff <= 1e-12 ? 'PASS (Bit-Identical / Machine Epsilon)' : 'FAIL'}`);
}

runB5Test();
