import {
  simulationStep,
  computeStepResponseMetrics,
  createPlantState,
  createControllerState,
  PHYSICS_DT,
} from '../lib/physicsEngine';
import { ROBOTS } from '../types/robots';
import { PIDConfig, DataPoint } from '../types/simulation';

const quadDef = ROBOTS.find((r) => r.id === 'quadcopter')!;
const plant = quadDef.defaultPlant; // actuatorLimits: [0, 20]

console.log('=== P1: SATURATION FRACTION TEST (DRONE ACTUATOR LIMITS [0, 20]) ===');
console.log(`Plant: Quadcopter Drone, actuatorLimits = [${plant.actuatorLimits[0]}, ${plant.actuatorLimits[1]}] N`);

function simulateDrone(setpoint: number, durationSec: number) {
  let plantState = createPlantState(plant);
  let controllerState = createControllerState();
  const pidConfig: PIDConfig = {
    Kp: 2.5,
    Ki: 0.6,
    Kd: 0.35,
    derivativeFilterN: 20,
    integralClamp: [-100, 100],
    derivativeOnMeasurement: true,
    antiWindupKb: 0.5,
    dt: PHYSICS_DT,
  };

  const history: DataPoint[] = [];
  const steps = Math.round(durationSec / PHYSICS_DT);
  let simTime = 0;

  for (let s = 0; s < steps; s++) {
    const res = simulationStep(
      setpoint,
      plantState,
      controllerState,
      plant,
      pidConfig,
      0,
      undefined,
      quadDef.gravityInRadians ?? false,
      quadDef.divergenceLimit ?? 1e6
    );
    plantState = res.plantState;
    controllerState = res.controllerState;
    simTime += PHYSICS_DT;

    if (s % 10 === 0) {
      history.push({
        time: simTime,
        setpoint,
        processVariable: res.processVariable,
        controlEffort: res.controlEffort,
        error: setpoint - res.processVariable,
        pTerm: controllerState.pTerm,
        iTerm: controllerState.iTerm,
        dTerm: controllerState.dTerm,
      });
    }
  }

  const metrics = computeStepResponseMetrics(history, setpoint, {
    stepStartTime: 0,
    initialValue: 0,
    actuatorLimits: plant.actuatorLimits,
  });

  return { metrics, history };
}

// 1. Step Normal (SP = 1.0 m, 10s)
const normalRes = simulateDrone(1.0, 10);
// 2. Step Sangat Jauh (SP = 50.0 m, 10s)
const farRes = simulateDrone(50.0, 10);

console.log('\n--- HASIL PENGUJIAN SATURATION FRACTION ---');
console.log(`\n1. Step Normal (SP = 1.0 m):`);
console.log(`   - saturationFraction: ${(normalRes.metrics.saturationFraction ?? 0).toFixed(4)} (Target: ≈ 0)`);
console.log(`   - Evaluasi: ${(normalRes.metrics.saturationFraction ?? 0) < 0.05 ? 'LULUS (≈ 0)' : 'GAGAL'}`);

console.log(`\n2. Step Sangat Jauh (SP = 50.0 m):`);
console.log(`   - saturationFraction: ${(farRes.metrics.saturationFraction ?? 0).toFixed(4)} (Target: > 0.2)`);
console.log(`   - Evaluasi: ${(farRes.metrics.saturationFraction ?? 0) > 0.2 ? 'LULUS (> 0.2)' : 'GAGAL'}`);
