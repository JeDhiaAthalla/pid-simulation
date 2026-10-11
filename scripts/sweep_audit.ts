import { ROBOTS } from '../types/robots';
import { synthesizePolePlacement, clampGains, polePlacementTuning } from '../lib/tuner';
import { runMicroSimulation, getHoverFeedforward, PHYSICS_DT } from '../lib/physicsEngine';

const droneRobot = ROBOTS.find(r => r.id === 'quadcopter')!;
const plant = { ...droneRobot.defaultPlant };
const setpoint = 1.0;
const m = plant.mass ?? 1.0;
const c = plant.dragCoefficient ?? 0.5;
const uFf = getHoverFeedforward(plant);
const H = Math.min(plant.actuatorLimits[1] - uFf, uFf - plant.actuatorLimits[0]);
const targetWn = 1.2;
const zeta = 0.9;

const aList = [
  0.02, 0.03, 0.05, 0.08, 0.10, 0.12, 0.15, 0.20, 0.25, 0.30, 0.40, 0.50, 0.60, 0.70, 0.80, 0.90, 1.00, 1.20, 1.50
];

console.log('=== B1: FULL SWEEP OF PARAMETER a ===');
console.log('a      | wn   | Kp    | Ki_raw| Ki_cl | Kd    | %OS    | Ts(s)  | e_ss(15s)   | e_ss(30s)   | peak_u');
console.log('-------|------|-------|-------|-------|-------|--------|--------|-------------|-------------|-------');

for (const a of aList) {
  const wnMax = Math.sqrt((0.8 * H) / (m * setpoint * (1 + 2 * zeta * a)));
  const wn = Math.min(targetWn, wnMax);
  const rawGains = synthesizePolePlacement(m, c, wn, zeta, a);
  const { gains: cGains } = clampGains(rawGains, plant, setpoint);

  const sim = runMicroSimulation(plant, cGains, setpoint, 30.0, 0.002);
  const data = sim.data;
  const p15 = data.find(d => Math.abs(d.time - 15.0) < 0.003);
  const p30 = data[data.length - 1];
  const ess15 = p15 ? 1.0 - p15.processVariable : 0;
  const ess30 = 1.0 - p30.processVariable;
  const peakU = Math.max(...data.map(d => Math.abs(d.controlEffort)));

  const osStr = (sim.metrics.peakOvershoot !== null ? sim.metrics.peakOvershoot.toFixed(2) + '%' : 'null').padEnd(6);
  const tsStr = (sim.metrics.settlingTime !== null && Number.isFinite(sim.metrics.settlingTime) ? sim.metrics.settlingTime.toFixed(2) + 's' : 'Inf').padEnd(6);

  console.log(
    `${a.toFixed(2).padEnd(6)} | ${wn.toFixed(2).padEnd(4)} | ${cGains.Kp.toFixed(3).padEnd(5)} | ${rawGains.Ki.toFixed(3).padEnd(5)} | ${cGains.Ki.toFixed(3).padEnd(5)} | ${cGains.Kd.toFixed(3).padEnd(5)} | ${osStr} | ${tsStr} | ${ess15.toExponential(3).padEnd(11)} | ${ess30.toExponential(3).padEnd(11)} | ${peakU.toFixed(2)}`
  );
}
