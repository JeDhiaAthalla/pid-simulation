import { ROBOTS } from '../types/robots';
import { synthesizePolePlacement, clampGains } from '../lib/tuner';
import { runMicroSimulation, getHoverFeedforward } from '../lib/physicsEngine';

const dronePlant = ROBOTS.find(r => r.id === 'quadcopter')!;
const plant = { ...dronePlant.defaultPlant };
const setpoint = 1.0;
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

const aCandidates = [
  0.02, 0.03, 0.05, 0.08, 0.1, 0.15, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.3, 1.4, 1.5,
];

interface CandidateEvaluation {
  a: number;
  gains: any;
  cost: number;
  metrics: any;
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

const qualifying = evaluations.filter((e) => e.qualifies);
qualifying.sort((x, y) => {
  const essX = Math.abs(x.metrics.steadyStateError ?? 1);
  const essY = Math.abs(y.metrics.steadyStateError ?? 1);
  const xPassEss = essX <= 0.01;
  const yPassEss = essY <= 0.01;
  if (xPassEss && !yPassEss) return -1;
  if (!xPassEss && yPassEss) return 1;
  return (x.metrics.settlingTime ?? Infinity) - (y.metrics.settlingTime ?? Infinity);
});

const best = qualifying[0];
console.log('Selected best candidate:');
console.log('  a =', best.a);
console.log('  gains =', best.gains);
console.log('  %OS =', best.metrics.peakOvershoot);
console.log('  Ts =', best.metrics.settlingTime);
console.log('  Ess =', best.metrics.steadyStateError);
