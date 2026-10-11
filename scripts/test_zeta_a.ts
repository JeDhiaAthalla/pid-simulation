import { ROBOTS } from '../types/robots';
import { synthesizePolePlacement, clampGains } from '../lib/tuner';
import { runMicroSimulation } from '../lib/physicsEngine';

const plant = { ...ROBOTS.find(r => r.id === 'quadcopter')!.defaultPlant };

console.log('zeta | a    | wn   | Kp    | Ki    | Kd    | %OS    | Ts(s)  | e_ss(30s)   | peak_u');
console.log('-----|------|------|-------|-------|-------|--------|--------|-------------|-------');

for (const zeta of [0.9, 1.0, 1.2, 1.4, 1.6, 1.8, 2.0]) {
  for (const a of [0.15, 0.20, 0.30, 0.40, 0.50]) {
    const rawGains = synthesizePolePlacement(1, 0.5, 1.2, zeta, a);
    const { gains } = clampGains(rawGains, plant, 1.0);
    const sim = runMicroSimulation(plant, gains, 1.0, 30.0, 0.002);
    const p30 = sim.data[sim.data.length - 1];
    const ess30 = 1.0 - p30.processVariable;
    const peakU = Math.max(...sim.data.map(d => Math.abs(d.controlEffort)));
    const osStr = (sim.metrics.peakOvershoot !== null ? sim.metrics.peakOvershoot.toFixed(2) + '%' : 'null').padEnd(6);
    const tsStr = (sim.metrics.settlingTime !== null && Number.isFinite(sim.metrics.settlingTime) ? sim.metrics.settlingTime.toFixed(2) + 's' : 'Inf').padEnd(6);

    console.log(
      `${zeta.toFixed(1).padEnd(4)} | ${a.toFixed(2).padEnd(4)} | 1.20 | ${gains.Kp.toFixed(3).padEnd(5)} | ${gains.Ki.toFixed(3).padEnd(5)} | ${gains.Kd.toFixed(3).padEnd(5)} | ${osStr} | ${tsStr} | ${ess30.toExponential(3).padEnd(11)} | ${peakU.toFixed(2)}`
    );
  }
}
