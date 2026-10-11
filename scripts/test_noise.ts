import { ROBOTS } from '../types/robots';
import { synthesizePolePlacement } from '../lib/tuner';
import {
  PHYSICS_DT,
  createPlantState,
  createControllerState,
  simulationStep,
} from '../lib/physicsEngine';
import { PIDConfig } from '../types/simulation';

const dronePlant = ROBOTS.find(r => r.id === 'quadcopter')!;
const gains = synthesizePolePlacement(1.0, 0.5, 1.2, 0.9, 0.5);

for (const N of [5, 8, 10, 15, 20]) {
  console.log(`\nTesting derivativeFilterN = ${N}:`);
  for (const sigma of [0.01, 0.05]) {
    const config: PIDConfig = {
      ...gains,
      derivativeFilterN: N,
      integralClamp: [-1000, 1000],
      derivativeOnMeasurement: true,
      antiWindupKb: 0.5,
      dt: PHYSICS_DT,
    };

    let pState = createPlantState(dronePlant.defaultPlant);
    let cState = createControllerState();

    // 10s without noise to reach steady state
    for (let i = 0; i < 2000; i++) {
      const res = simulationStep(1.0, pState, cState, dronePlant.defaultPlant, config);
      pState = res.plantState;
      cState = res.controllerState;
    }

    // 5s with noise, record u
    const uHistory: number[] = [];
    for (let i = 0; i < 1000; i++) {
      const res = simulationStep(1.0, pState, cState, dronePlant.defaultPlant, config, 0, { enabled: true, sigma });
      pState = res.plantState;
      cState = res.controllerState;
      uHistory.push(res.controlEffort);
    }

    const minU = Math.min(...uHistory);
    const maxU = Math.max(...uHistory);
    const p2p = maxU - minU;
    console.log(`  sigma=${sigma}: min u=${minU.toFixed(2)}, max u=${maxU.toFixed(2)}, p2p=${p2p.toFixed(3)} N`);
  }
}
