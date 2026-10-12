import { ROBOTS } from '../types/robots';
import { simulationStep, createPlantState, createControllerState, computeStepResponseMetrics } from '../lib/physicsEngine';

const lineFollower = ROBOTS.find((r) => r.id === 'line_follower')!;
const plant = { ...lineFollower.defaultPlant };
const pidConfig = {
  Kp: 2.0,
  Ki: 0.5,
  Kd: 0.3,
  derivativeFilterN: 20,
  integralClamp: [-100, 100] as [number, number],
  derivativeOnMeasurement: true,
  antiWindupKb: 0.5,
  dt: 0.01,
};

let plantState = createPlantState(plant);
let controllerState = createControllerState();
let t = 0;
const history: Array<{
  time: number;
  setpoint: number;
  processVariable: number;
  controlEffort: number;
  error: number;
  pTerm: number;
  iTerm: number;
  dTerm: number;
}> = [];

const sp = 0;
const initialVal = 0;

// Run 2 seconds settled at 0
for (let i = 0; i < 200; i++) {
  const res = simulationStep(sp, plantState, controllerState, plant, pidConfig, 0);
  plantState = res.plantState;
  controllerState = res.controllerState;
  t += 0.01;
  history.push({
    time: t,
    setpoint: sp,
    processVariable: res.processVariable,
    controlEffort: res.controlEffort,
    error: sp - res.processVariable,
    pTerm: res.controllerState.pTerm,
    iTerm: res.controllerState.iTerm,
    dTerm: res.controllerState.dTerm,
  });
}

console.log('=== SEBELUM DISTURBANSI ===');
let m = computeStepResponseMetrics(history, sp, {
  stepStartTime: 0,
  initialValue: initialVal,
  actuatorLimits: plant.actuatorLimits,
});
console.log({
  SP: sp,
  initialValue: initialVal,
  stepAmplitude: Math.abs(sp - initialVal),
  peak: m.peakValue,
  overshoot: m.peakOvershoot,
  Ts: m.settlingTime,
  isStable: m.isStable,
  damping: m.dampingAssessment,
});

// Inject push disturbance (magnitude 3.5 for 0.35s = 35 steps)
console.log('\n=== INJEKSI DISTURBANSI (Dorong 3.5 N selama 0.35s) ===');
for (let i = 0; i < 35; i++) {
  const res = simulationStep(sp, plantState, controllerState, plant, pidConfig, 3.5);
  plantState = res.plantState;
  controllerState = res.controllerState;
  t += 0.01;
  history.push({
    time: t,
    setpoint: sp,
    processVariable: res.processVariable,
    controlEffort: res.controlEffort,
    error: sp - res.processVariable,
    pTerm: res.controllerState.pTerm,
    iTerm: res.controllerState.iTerm,
    dTerm: res.controllerState.dTerm,
  });
}

// Let it recover for 5 seconds
for (let i = 0; i < 500; i++) {
  const res = simulationStep(sp, plantState, controllerState, plant, pidConfig, 0);
  plantState = res.plantState;
  controllerState = res.controllerState;
  t += 0.01;
  history.push({
    time: t,
    setpoint: sp,
    processVariable: res.processVariable,
    controlEffort: res.controlEffort,
    error: sp - res.processVariable,
    pTerm: res.controllerState.pTerm,
    iTerm: res.controllerState.iTerm,
    dTerm: res.controllerState.dTerm,
  });
}

m = computeStepResponseMetrics(history, sp, {
  stepStartTime: 0,
  initialValue: initialVal,
  actuatorLimits: plant.actuatorLimits,
});
console.log('\n=== SETELAH DISTURBANSI & RECOVERY ===');
console.log({
  SP: sp,
  initialValue: initialVal,
  stepAmplitude: Math.abs(sp - initialVal),
  peak: m.peakValue,
  overshoot: m.peakOvershoot,
  Ts: m.settlingTime,
  isStable: m.isStable,
  damping: m.dampingAssessment,
});
