import { ROBOTS } from '../types/robots';
import { synthesizePolePlacement, clampGains } from '../lib/tuner';
import {
  PHYSICS_DT,
  createPlantState,
  createControllerState,
  simulationStep,
} from '../lib/physicsEngine';
import { PIDConfig } from '../types/simulation';

const plant = { ...ROBOTS.find(r => r.id === 'quadcopter')!.defaultPlant };

for (const a of [0.03, 0.08, 0.15, 0.30, 0.50]) {
  const gains = synthesizePolePlacement(1.0, 0.5, 1.2, 0.9, a);
  const config: PIDConfig = {
    ...gains,
    derivativeFilterN: 20,
    integralClamp: [-1000, 1000],
    derivativeOnMeasurement: true,
    antiWindupKb: 0.5,
    dt: PHYSICS_DT,
  };

  console.log(`\n--- Candidate a = ${a} (Kp=${gains.Kp.toFixed(3)}, Ki=${gains.Ki.toFixed(3)}, Kd=${gains.Kd.toFixed(3)}) ---`);

  // Case 1: Pulse disturbance (-2 N from t=10s to t=20s, then removed)
  {
    let pState = createPlantState(plant);
    let cState = createControllerState();
    // 10s normal
    for (let i = 0; i < 2000; i++) {
      const r = simulationStep(1.0, pState, cState, plant, config);
      pState = r.plantState; cState = r.controllerState;
    }
    // 10s with -2N
    for (let i = 0; i < 2000; i++) {
      const r = simulationStep(1.0, pState, cState, plant, config, -2.0);
      pState = r.plantState; cState = r.controllerState;
    }
    console.log(`  At end of 10s dist (-2N): z = ${pState.x[0].toFixed(3)} m, iTerm = ${cState.iTerm.toFixed(3)} N`);
    // 15s post disturbance
    let tRecover = null;
    for (let i = 0; i < 3000; i++) {
      const t = (i + 1) * PHYSICS_DT;
      const r = simulationStep(1.0, pState, cState, plant, config, 0);
      pState = r.plantState; cState = r.controllerState;
      if (Math.abs(1.0 - r.processVariable) <= 0.01 && tRecover === null) {
        tRecover = t;
      }
    }
    console.log(`  Pulse dist (-2N for 10s): t_recover post-dist = ${tRecover !== null ? tRecover.toFixed(2) + 's' : 'NEVER'}, final z(35s) = ${pState.x[0].toFixed(4)} m, final e_ss = ${Math.abs(1.0 - pState.x[0]).toFixed(4)} m`);
  }

  // Case 2: Constant persistent disturbance (-2 N starts at t=10s and stays forever)
  {
    let pState = createPlantState(plant);
    let cState = createControllerState();
    // 10s normal
    for (let i = 0; i < 2000; i++) {
      const r = simulationStep(1.0, pState, cState, plant, config);
      pState = r.plantState; cState = r.controllerState;
    }
    // persistent -2N for 15s
    let tRecover = null;
    for (let i = 0; i < 3000; i++) {
      const t = (i + 1) * PHYSICS_DT;
      const r = simulationStep(1.0, pState, cState, plant, config, -2.0);
      pState = r.plantState; cState = r.controllerState;
      if (Math.abs(1.0 - r.processVariable) <= 0.01 && tRecover === null) {
        tRecover = t;
      }
    }
    console.log(`  Persistent dist (-2N constant): t_recover during dist = ${tRecover !== null ? tRecover.toFixed(2) + 's' : 'NEVER'}, final z(25s) = ${pState.x[0].toFixed(4)} m, final e_ss = ${Math.abs(1.0 - pState.x[0]).toFixed(4)} m`);
  }
}
