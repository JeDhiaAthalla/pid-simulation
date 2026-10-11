import { ROBOTS } from '../types/robots';
import { PlantParameters, PIDConfig, ControllerState, PlantState } from '../types/simulation';
import {
  PHYSICS_DT,
  clamp,
  createPlantState,
  createControllerState,
  rk4Step,
  applyDeadTime,
  pidStep as pidStepNew,
  getHoverFeedforward,
} from '../lib/physicsEngine';

const droneRobot = ROBOTS.find(r => r.id === 'quadcopter')!;
const plant: PlantParameters = { ...droneRobot.defaultPlant };

// ---------------------------------------------------------------------------
// KODE LAMA (from step 217 of transcript)
// ---------------------------------------------------------------------------
function pidStepOld(
  setpoint: number,
  measurement: number,
  config: PIDConfig,
  state: ControllerState,
  actuatorLimits: [number, number]
): ControllerState {
  const dt = config.dt;
  const error = setpoint - measurement;
  const pTerm = config.Kp * error;

  let integral = state.integral + error * dt;
  if (state.isSaturated) {
    const satError = state.controlOutput - state.controlOutputUnsat;
    integral += config.antiWindupKb * satError * dt;
  }
  // Integral clamping on state.integral directly (not output space)
  integral = clamp(integral, config.integralClamp[0], config.integralClamp[1]);
  const iTerm = config.Ki * integral;

  const dMeasurement = (measurement - state.prevMeasurement) / dt;
  const alpha = dt / (dt + 1.0 / (config.derivativeFilterN * 10));
  const filteredDerivative = state.filteredDerivative + alpha * (-dMeasurement - state.filteredDerivative);
  const dTerm = config.Kd * filteredDerivative;

  // Old code had NO feedforward: controlOutputUnsat = pTerm + iTerm + dTerm
  const controlOutputUnsat = pTerm + iTerm + dTerm;
  const controlOutput = clamp(controlOutputUnsat, actuatorLimits[0], actuatorLimits[1]);
  const isSaturated = Math.abs(controlOutput - controlOutputUnsat) > 1e-4;

  return {
    error,
    prevError: error,
    integral,
    prevMeasurement: measurement,
    filteredDerivative,
    pTerm,
    iTerm,
    dTerm,
    controlOutput,
    controlOutputUnsat,
    isSaturated,
  };
}

// Plant stepping with a given controller
function stepPlantWithController(
  setpoint: number,
  pState: PlantState,
  cState: ControllerState,
  p: PlantParameters,
  controllerFn: (sp: number, meas: number, cState: ControllerState) => ControllerState
): { plantState: PlantState; controllerState: ControllerState } {
  const measurement = pState.measuredOutput;
  const newCtrl = controllerFn(setpoint, measurement, cState);
  const u = newCtrl.controlOutput;
  const newX = rk4Step(pState.x, u, PHYSICS_DT, p, false);
  const delayedOutput = p.deadTime > 0 ? applyDeadTime(newX[0], pState, PHYSICS_DT) : newX[0];

  const updatedPlantState: PlantState = {
    x: newX,
    measuredOutput: delayedOutput,
    deadTimeBuffer: pState.deadTimeBuffer,
    deadTimeIndex: pState.deadTimeIndex,
    deadTimeCapacity: pState.deadTimeCapacity,
  };

  return { plantState: updatedPlantState, controllerState: newCtrl };
}

export function runB4Simulation() {
  const gains = { Kp: 2.736, Ki: 0.864, Kd: 2.260 };
  const config: PIDConfig = {
    ...gains,
    derivativeFilterN: 20,
    integralClamp: [-1000, 1000],
    derivativeOnMeasurement: true,
    antiWindupKb: 0.5,
    dt: PHYSICS_DT,
  };

  // Test scenario:
  // Step SP to 30.0m for 4.0s (saturates actuator gradually as drone climbs)
  // Then SP steps down to 1.0m.
  const tStep = 4.0;
  const tTotal = 25.0;
  const totalSteps = Math.ceil(tTotal / PHYSICS_DT);

  // 1. KODE LAMA
  let pStateOld = createPlantState(plant);
  let cStateOld = createControllerState();
  let maxITermOld = 0;
  let maxZAfterStepOld = 0;
  let timeToBand2Old: number | null = null;
  let timeToBand5Old: number | null = null;

  // 2. KODE BARU
  let pStateNew = createPlantState(plant);
  let cStateNew = createControllerState();
  let maxITermNew = 0;
  let maxZAfterStepNew = 0;
  let timeToBand2New: number | null = null;
  let timeToBand5New: number | null = null;

  const uFf = getHoverFeedforward(plant);

  for (let step = 0; step < totalSteps; step++) {
    const t = step * PHYSICS_DT;
    const sp = t < tStep ? 30.0 : 1.0;

    // --- OLD CODE ---
    const resOld = stepPlantWithController(sp, pStateOld, cStateOld, plant, (s, m, cs) =>
      pidStepOld(s, m, config, cs, plant.actuatorLimits)
    );
    pStateOld = resOld.plantState;
    cStateOld = resOld.controllerState;
    if (Math.abs(cStateOld.iTerm) > maxITermOld) maxITermOld = Math.abs(cStateOld.iTerm);
    if (t >= tStep && pStateOld.x[0] > maxZAfterStepOld) maxZAfterStepOld = pStateOld.x[0];

    // Band checking for old (band 2% of 1.0m is [0.98, 1.02], band 5% is [0.95, 1.05])
    if (t >= tStep) {
      const err = Math.abs(pStateOld.x[0] - 1.0);
      if (err <= 0.02 && timeToBand2Old === null) timeToBand2Old = t - tStep;
      else if (err > 0.02) timeToBand2Old = null;

      if (err <= 0.05 && timeToBand5Old === null) timeToBand5Old = t - tStep;
      else if (err > 0.05) timeToBand5Old = null;
    }

    // --- NEW CODE ---
    const resNew = stepPlantWithController(sp, pStateNew, cStateNew, plant, (s, m, cs) =>
      pidStepNew(s, m, config, cs, plant.actuatorLimits, uFf)
    );
    pStateNew = resNew.plantState;
    cStateNew = resNew.controllerState;
    if (Math.abs(cStateNew.iTerm) > maxITermNew) maxITermNew = Math.abs(cStateNew.iTerm);
    if (t >= tStep && pStateNew.x[0] > maxZAfterStepNew) maxZAfterStepNew = pStateNew.x[0];

    // Band checking for new
    if (t >= tStep) {
      const err = Math.abs(pStateNew.x[0] - 1.0);
      if (err <= 0.02 && timeToBand2New === null) timeToBand2New = t - tStep;
      else if (err > 0.02) timeToBand2New = null;

      if (err <= 0.05 && timeToBand5New === null) timeToBand5New = t - tStep;
      else if (err > 0.05) timeToBand5New = null;
    }
  }

  console.log('=== B4: TRUE ANTI-WINDUP COMPARISON (KODE LAMA VS KODE BARU) ===');
  console.log(`Scenario: SP = 30.0m for 4.0s (drone climbs & saturates), then SP drops to 1.0m`);
  console.log(`-----------------------------------------------------------------------------`);
  console.log(`METRIC                              | KODE LAMA         | KODE BARU`);
  console.log(`------------------------------------|-------------------|-------------------`);
  console.log(`|Ki * integral| maks                | ${maxITermOld.toFixed(4)} N       | ${maxITermNew.toFixed(4)} N`);
  console.log(`z maks setelah SP turun (t >= 4s)   | ${maxZAfterStepOld.toFixed(4)} m      | ${maxZAfterStepNew.toFixed(4)} m`);
  console.log(`Waktu kembali ke band 5% [0.95,1.05]| ${timeToBand5Old !== null ? timeToBand5Old.toFixed(2) + ' s' : '> 21.0 s (Belum)'}    | ${timeToBand5New !== null ? timeToBand5New.toFixed(2) + ' s' : '> 21.0 s (Belum)'}`);
  console.log(`Waktu kembali ke band 2% [0.98,1.02]| ${timeToBand2Old !== null ? timeToBand2Old.toFixed(2) + ' s' : '> 21.0 s (Belum)'}    | ${timeToBand2New !== null ? timeToBand2New.toFixed(2) + ' s' : '> 21.0 s (Belum)'}`);
  console.log(`Nilai z akhir (t = 25s)             | ${pStateOld.x[0].toFixed(4)} m       | ${pStateNew.x[0].toFixed(4)} m`);
  console.log(`-----------------------------------------------------------------------------`);
}

runB4Simulation();
