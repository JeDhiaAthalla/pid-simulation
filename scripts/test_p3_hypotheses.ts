import {
  simulationStep,
  createPlantState,
  createControllerState,
  PHYSICS_DT,
} from '../lib/physicsEngine';
import { ROBOTS } from '../types/robots';
import { PIDConfig } from '../types/simulation';

const quadDef = ROBOTS.find((r) => r.id === 'quadcopter')!;
const plant = quadDef.defaultPlant;

const autoTunePID: PIDConfig = {
  Kp: 1.570,
  Ki: 0.129,
  Kd: 1.702,
  derivativeFilterN: 20,
  integralClamp: [-100, 100],
  derivativeOnMeasurement: true,
  antiWindupKb: 0.5,
  dt: PHYSICS_DT,
};

console.log('=== P3 DETAILED ROOT CAUSE HYPOTHESIS TESTING ===');

// Hypothesis A: Step change happened at t = 180s (simulation ran for 200s total, but step was 20s ago)
{
  let plantState = createPlantState(plant);
  let controllerState = createControllerState();
  let simTime = 0;
  let sp = 0;
  for (let s = 0; s < Math.round(200 / PHYSICS_DT); s++) {
    if (simTime >= 180) sp = 5.0; // step change at 180s
    const res = simulationStep(sp, plantState, controllerState, plant, autoTunePID, 0, undefined, false, 1e6);
    plantState = res.plantState;
    controllerState = res.controllerState;
    simTime += PHYSICS_DT;
  }
  const e = 5.0 - plantState.measuredOutput;
  console.log(`Hypothesis A (Step change 20s ago at t=180s): t=200s -> PV = ${plantState.measuredOutput.toFixed(3)}m, e = ${e.toFixed(3)}m`);
}

// Hypothesis B: Mass mismatch (e.g. plant.mass = 1.015 kg, feedforward = 9.81 N)
{
  const plantM = { ...plant, mass: 1.015 };
  let plantState = createPlantState(plantM);
  let controllerState = createControllerState();
  let simTime = 0;
  for (let s = 0; s < Math.round(200 / PHYSICS_DT); s++) {
    const res = simulationStep(5.0, plantState, controllerState, plantM, autoTunePID, 0, undefined, false, 1e6);
    plantState = res.plantState;
    controllerState = res.controllerState;
    simTime += PHYSICS_DT;
  }
  const e = 5.0 - plantState.measuredOutput;
  console.log(`Hypothesis B (Mass = 1.015kg, 1.5% heavier): t=200s -> PV = ${plantState.measuredOutput.toFixed(3)}m, e = ${e.toFixed(3)}m, iTerm = ${controllerState.iTerm.toFixed(3)}N`);
}

// Hypothesis C: Constant aerodynamic downforce or disturbance (e.g. -0.22N)
{
  let plantState = createPlantState(plant);
  let controllerState = createControllerState();
  let simTime = 0;
  for (let s = 0; s < Math.round(200 / PHYSICS_DT); s++) {
    const res = simulationStep(5.0, plantState, controllerState, plant, autoTunePID, -0.05, undefined, false, 1e6);
    plantState = res.plantState;
    controllerState = res.controllerState;
    simTime += PHYSICS_DT;
  }
  const e = 5.0 - plantState.measuredOutput;
  console.log(`Hypothesis C (Small continuous disturbance -0.05N): t=200s -> PV = ${plantState.measuredOutput.toFixed(3)}m, e = ${e.toFixed(3)}m`);
}
