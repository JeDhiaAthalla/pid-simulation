import { ROBOTS } from '../types/robots';
import { synthesizePolePlacement } from '../lib/tuner';
import { runMicroSimulation } from '../lib/physicsEngine';

const dronePlant = ROBOTS.find(r => r.id === 'quadcopter')!;
const gains = synthesizePolePlacement(1.0, 0.5, 1.2, 0.9, 0.5);

for (const N of [1, 2, 5, 10, 20]) {
  const config = {
    ...gains,
    derivativeFilterN: N,
    integralClamp: [-1000, 1000] as [number, number],
    derivativeOnMeasurement: true,
    antiWindupKb: 0.5,
    dt: 0.005,
  };
  const sim = runMicroSimulation(dronePlant.defaultPlant, gains, 1.0, 20.0, 0.005);
  console.log(`N=${N}: %OS=${sim.metrics.peakOvershoot?.toFixed(2)}%, Ts=${sim.metrics.settlingTime?.toFixed(2)}s, isStable=${sim.metrics.isStable}`);
}
