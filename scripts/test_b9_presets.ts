import { ROBOTS } from '../types/robots';
import { runMicroSimulation } from '../lib/physicsEngine';
import { polePlacementTuning } from '../lib/tuner';

const drone = ROBOTS.find(r => r.id === 'quadcopter')!;
const plant = { ...drone.defaultPlant };
const basePlant = plant;
const tau = Math.max(basePlant.timeConstant, 0.05);
const K = Math.max(basePlant.gain, 0.1);
const L = Math.max(basePlant.deadTime, 0.01);

// Current presets from ControlDashboard.tsx:
const presetStable = {
  name: 'Stabil Mulus',
  Kp: parseFloat(((0.9 * tau) / (K * L)).toFixed(3)),
  Ki: parseFloat((((0.9 * tau) / (K * L)) / (3.3 * L)).toFixed(3)),
  Kd: parseFloat((((0.9 * tau) / (K * L)) * 0.5 * L).toFixed(3)),
};

const presetAggressive = {
  name: 'Respon Cepat',
  Kp: parseFloat(((1.4 * tau) / (K * L)).toFixed(3)),
  Ki: parseFloat((((1.4 * tau) / (K * L)) / (2.0 * L)).toFixed(3)),
  Kd: parseFloat((((1.4 * tau) / (K * L)) * 0.45 * L).toFixed(3)),
};

const presetOscillating = {
  name: 'Osilasi Demo',
  Kp: parseFloat(((2.2 * tau) / (K * L)).toFixed(3)),
  Ki: parseFloat((((2.2 * tau) / (K * L)) / (1.2 * L)).toFixed(3)),
  Kd: parseFloat((((2.2 * tau) / (K * L)) * 0.08 * L).toFixed(3)),
};

// Also old default drone values mentioned in B9:
const oldDefaultDrone = {
  name: 'Default Lama Drone',
  Kp: 0.80,
  Ki: 10.00,
  Kd: 0.075,
};

// Auto-tune baru:
const autoTuneRes = polePlacementTuning(plant, 1.0);
const autoTuneGains = {
  name: 'Auto-Tune Pole Placement Baru',
  ...autoTuneRes.gains,
};

console.log('=== B9: PRESET & DEFAULT DRONE AUDIT ===');
const list = [oldDefaultDrone, presetStable, presetAggressive, presetOscillating, autoTuneGains];

for (const item of list) {
  const gains = { Kp: item.Kp, Ki: item.Ki, Kd: item.Kd };
  const sim = runMicroSimulation(plant, gains, 1.0, 30.0, 0.002);
  const m = sim.metrics;
  const peakU = Math.max(...sim.data.map(d => Math.abs(d.controlEffort)));
  const minU = Math.min(...sim.data.map(d => d.controlEffort));
  const isSaturated = peakU >= 19.99 || minU <= 0.01;
  const satFraction = m.saturationFraction;
  const os = m.peakOvershoot !== null ? `${m.peakOvershoot.toFixed(1)}%` : 'null';
  const ts = m.settlingTime !== null && Number.isFinite(m.settlingTime) ? `${m.settlingTime.toFixed(2)}s` : 'Inf';

  console.log(`\nPreset: ${item.name}`);
  console.log(`  Gains: Kp=${gains.Kp.toFixed(3)}, Ki=${gains.Ki.toFixed(3)}, Kd=${gains.Kd.toFixed(3)}`);
  console.log(`  %Overshoot:       ${os}`);
  console.log(`  Settling Time Ts: ${ts}`);
  console.log(`  isStable:         ${m.isStable}`);
  console.log(`  sustainedOsc:     ${m.sustainedOscillation}`);
  console.log(`  damping:          ${m.dampingAssessment}`);
  console.log(`  Peak U / Min U:   ${peakU.toFixed(2)} N / ${minU.toFixed(2)} N (Limits: [0, 20])`);
  console.log(`  Is Saturated:     ${isSaturated} (satFraction: ${((satFraction ?? 0) * 100).toFixed(1)}%)`);
}
