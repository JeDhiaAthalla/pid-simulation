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

for (const a of aCandidates) {
  const wnMax = Math.sqrt((0.8 * effectiveH) / (m * A * (1 + 2 * zeta * a)));
  const effectiveWn = Math.min(targetWn, wnMax);
  const rawGains = synthesizePolePlacement(m, c, effectiveWn, zeta, a);
  const { gains } = clampGains(rawGains, plant, setpoint);

  const sim = runMicroSimulation(plant, gains, setpoint, 25, 0.002);
  const lastPoint = sim.data[sim.data.length - 1];
  const ess30 = Math.abs(setpoint - lastPoint.processVariable);
  const os = sim.metrics.peakOvershoot;
  const ts = sim.metrics.settlingTime;

  console.log(`a=${a.toFixed(2)}: OS=${os?.toFixed(2)}%, Ts=${ts?.toFixed(2)}s, Ess=${ess30.toFixed(4)}, qualifies=${(os ?? 99) <= 10 && ts !== null && Number.isFinite(ts) && ess30 <= 0.01}`);
}
