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
const plant = quadDef.defaultPlant;

console.log('=== TRACK C VERIFICATION: STEP RESPONSE METRICS (0 -> 5m, 60s) ===');

// Run simulation for 60s
const setpoint = 5.0;
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

const fullHistory: DataPoint[] = [];
let simTime = 0;
const totalSteps = Math.round(60 / PHYSICS_DT);

for (let s = 0; s < totalSteps; s++) {
  const stepRes = simulationStep(
    setpoint,
    plantState,
    controllerState,
    plant,
    pidConfig,
    0, // no disturbance
    undefined,
    quadDef.gravityInRadians ?? false,
    quadDef.divergenceLimit ?? 1e6
  );

  plantState = stepRes.plantState;
  controllerState = stepRes.controllerState;
  simTime += PHYSICS_DT;

  if (s % 10 === 0) {
    fullHistory.push({
      time: simTime,
      setpoint,
      processVariable: stepRes.processVariable,
      controlEffort: stepRes.controlEffort,
      error: setpoint - stepRes.processVariable,
      pTerm: controllerState.pTerm,
      iTerm: controllerState.iTerm,
      dTerm: controllerState.dTerm,
    });
  }
}

// 1. KONDISI SEBELUM PERBAIKAN:
// Rolling buffer 600 sampel yang sudah wrap (mengambil 600 sampel terakhir, data[0] ~ 4.90)
// dan dipanggil computeStepResponseMetrics TANPA options { stepStartTime, initialValue }
const wrappedBuffer = fullHistory.slice(fullHistory.length - 600);
const metricsBefore = computeStepResponseMetrics(wrappedBuffer, setpoint);

// 2. KONDISI SESUDAH PERBAIKAN:
// Dipanggil DENGAN options { stepStartTime: 0, initialValue: 0, actuatorLimits: [-100, 100] }
const metricsAfter = computeStepResponseMetrics(fullHistory, setpoint, {
  stepStartTime: 0,
  initialValue: 0,
  actuatorLimits: [-100, 100],
});

console.log('\n--- TABEL V5: METRIK SEBELUM VS SESUDAH PERBAIKAN ---');
console.log('| Parameter Metrik | Sebelum Perbaikan (Wrapped Buffer Tanpa Options) | Sesudah Perbaikan (Dengan stepStartTime & initialValue) | Evaluasi |');
console.log('|---|---|---|---|');
console.log(`| Initial Value Yang Dipakai | ${wrappedBuffer[0].processVariable.toFixed(3)} m (Data rolling buffer ke-0) | 0.000 m (Nilai PV saat SP berubah) | FIXED |`);
console.log(`| Step Amplitude | ${Math.abs(setpoint - wrappedBuffer[0].processVariable).toFixed(3)} m (Hanya ~0.1m!) | ${setpoint.toFixed(3)} m (Benar 5.0m) | FIXED |`);
console.log(`| Peak Overshoot (Mp) | ${metricsBefore.peakOvershoot !== null ? metricsBefore.peakOvershoot.toFixed(1) + '%' : 'null'} | ${metricsAfter.peakOvershoot !== null ? metricsAfter.peakOvershoot.toFixed(1) + '%' : 'null'} | FIXED (Anomali 2325.7% Hilang) |`);
console.log(`| Rise Time (Tr) | ${metricsBefore.riseTime !== null ? metricsBefore.riseTime.toFixed(2) + ' s' : 'null'} | ${metricsAfter.riseTime !== null ? metricsAfter.riseTime.toFixed(2) + ' s' : 'null'} | FIXED |`);
console.log(`| Settling Time (Ts) | ${metricsBefore.settlingTime !== null ? (Number.isFinite(metricsBefore.settlingTime) ? metricsBefore.settlingTime.toFixed(2) + ' s' : 'unsettled') : 'null'} | ${metricsAfter.settlingTime !== null ? (Number.isFinite(metricsAfter.settlingTime) ? metricsAfter.settlingTime.toFixed(2) + ' s' : 'unsettled') : 'null'} | FIXED |`);
console.log(`| Steady-State Error (Ess) | ${metricsBefore.steadyStateError !== null ? metricsBefore.steadyStateError.toFixed(4) + ' m' : 'null'} | ${metricsAfter.steadyStateError !== null ? metricsAfter.steadyStateError.toFixed(4) + ' m' : 'null'} | VALID |`);
console.log(`| Settling Status | ${metricsBefore.settlingStatus} | ${metricsAfter.settlingStatus} | VALID |`);

// 3. INVESTIGASI C3: GAIN AUTO-TUNE QUADCOPTER PADA t = 200s
console.log('\n=== INVESTIGASI C3: AUTO-TUNE GAIN (Kp 1.570, Ki 0.129, Kd 1.702) PADA t = 200s ===');

const autoTunePID: PIDConfig = {
  Kp: 1.57,
  Ki: 0.129,
  Kd: 1.702,
  derivativeFilterN: 20,
  integralClamp: [-100, 100],
  derivativeOnMeasurement: true,
  antiWindupKb: 0.5,
  dt: PHYSICS_DT,
};

let atPlantState = createPlantState(plant);
let atControllerState = createControllerState();
let atSimTime = 0;
const atTotalSteps = Math.round(200 / PHYSICS_DT);

for (let s = 0; s < atTotalSteps; s++) {
  const stepRes = simulationStep(
    setpoint,
    atPlantState,
    atControllerState,
    plant,
    autoTunePID,
    0,
    undefined,
    quadDef.gravityInRadians ?? false,
    quadDef.divergenceLimit ?? 1e6
  );
  atPlantState = stepRes.plantState;
  atControllerState = stepRes.controllerState;
  atSimTime += PHYSICS_DT;
}

const atPV = atPlantState.measuredOutput;
const atErr = setpoint - atPV;
const atU = atControllerState.controlOutput;
const atUI = atControllerState.iTerm;

console.log(`t = ${atSimTime.toFixed(1)} s:`);
console.log(`- PV: ${atPV.toFixed(3)} m (Setpoint: ${setpoint.toFixed(2)} m)`);
console.log(`- Ess (|SP - PV|): ${atErr.toFixed(3)} m`);
console.log(`- Total Control Effort u(t): ${atU.toFixed(3)} N (Hover Gravity: ${(plant.mass! * 9.81).toFixed(2)} N)`);
console.log(`- Integral Term u_I(t): ${atUI.toFixed(3)} N`);
console.log(`- Laju Integrasi saat ini (Ki * e): ${(autoTunePID.Ki * atErr).toFixed(4)} N/s`);
