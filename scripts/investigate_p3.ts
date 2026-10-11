import {
  simulationStep,
  createPlantState,
  createControllerState,
  PHYSICS_DT,
} from '../lib/physicsEngine';
import { ROBOTS } from '../types/robots';
import { PIDConfig, NoiseConfig } from '../types/simulation';

const quadDef = ROBOTS.find((r) => r.id === 'quadcopter')!;
const plant = quadDef.defaultPlant;

console.log('=== P3: INVESTIGASI HEADLESS DRONE TANPA DISTURBANSI / NOISE ===');
console.log('Gain Auto-Tune: Kp = 1.570, Ki = 0.129, Kd = 1.702, setpoint = 5.0m');
console.log('Plant default: mass =', plant.mass, 'deadTime =', plant.deadTime, 'actuatorLimits =', plant.actuatorLimits);

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

function runTest(label: string, customPlant = plant, distAtT?: { t: number; mag: number; dur: number }, noise?: NoiseConfig) {
  let plantState = createPlantState(customPlant);
  let controllerState = createControllerState();
  let simTime = 0;
  const setpoint = 5.0;
  const checkpoints = [20, 50, 100, 200];
  let cpIdx = 0;

  console.log(`\n--- Skenario: ${label} ---`);
  console.log('| t (s) | PV (m) | Error e(t) (m) | iTerm (N) | Control Effort u (N) | pTerm (N) | dTerm (N) | Feedforward (N) |');
  console.log('|---|---|---|---|---|---|---|---|');

  const totalSteps = Math.round(200.01 / PHYSICS_DT);
  for (let s = 0; s < totalSteps; s++) {
    let activeDist = 0;
    if (distAtT && simTime >= distAtT.t && simTime < distAtT.t + distAtT.dur) {
      activeDist = distAtT.mag;
    }

    const res = simulationStep(
      setpoint,
      plantState,
      controllerState,
      customPlant,
      autoTunePID,
      activeDist,
      noise,
      quadDef.gravityInRadians ?? false,
      quadDef.divergenceLimit ?? 1e6
    );
    plantState = res.plantState;
    controllerState = res.controllerState;
    simTime += PHYSICS_DT;

    if (cpIdx < checkpoints.length && Math.abs(simTime - checkpoints[cpIdx]) < PHYSICS_DT / 2) {
      const e = setpoint - res.processVariable;
      const u = res.controlEffort;
      const iTerm = controllerState.iTerm;
      const pTerm = controllerState.pTerm;
      const dTerm = controllerState.dTerm;
      const ff = customPlant.mass ? customPlant.mass * 9.81 : 0;
      console.log(
        `| ${checkpoints[cpIdx]} | ${res.processVariable.toFixed(4)} | ${e.toFixed(4)} | ${iTerm.toFixed(4)} | ${u.toFixed(4)} | ${pTerm.toFixed(4)} | ${dTerm.toFixed(4)} | ${ff.toFixed(2)} |`
      );
      cpIdx++;
    }
  }
}

// 1. Murni Headless (Tanpa dist, tanpa noise)
runTest('1. Headless Murni (No noise, No disturbance)');

// 2. Headless dengan Noise (misal Gaussian noise stdDev = 0.05)
runTest('2. Dengan Sensor Noise (stdDev = 0.02)', plant, undefined, { enabled: true, type: 'gaussian', stdDev: 0.02, seed: 42 });

// 3. Headless dengan Push 4.5N pada t = 10s selama 0.35s
runTest('3. Dengan Push Gangguan +4.5N pada t = 10s', plant, { t: 10, mag: 4.5, dur: 0.35 });

// 4. Headless jika plant.mass di UI berbeda (misal 1.0kg vs friction/deadTime)
const plantWithDelay = { ...plant, deadTime: 0.05 };
runTest('4. Dengan Plant Dead Time = 0.05s', plantWithDelay);
