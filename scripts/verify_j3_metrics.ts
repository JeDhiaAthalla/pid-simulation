import { ROBOTS } from '../types/robots';
import { simulationStep, createPlantState, createControllerState, computeStepResponseMetrics } from '../lib/physicsEngine';

// Scenario 1: Line Follower, SP = 0, Push Disturbance
function runScenario1() {
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

  // Settle at 0
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

  // Push disturbance (magnitude 3.5 for 0.35s)
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

  // Recover for 5 seconds
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

  const rawMetrics = computeStepResponseMetrics(history, sp, {
    stepStartTime: 0,
    initialValue: initialVal,
    actuatorLimits: plant.actuatorLimits,
  });

  // BEFORE (unguarded):
  const before = {
    scenario: 'Line Follower (SP=0, Dorong)',
    Kp: pidConfig.Kp,
    Ki: pidConfig.Ki,
    Kd: pidConfig.Kd,
    stepAmp: Math.abs(sp - initialVal),
    Tr: rawMetrics.riseTime !== null ? `${rawMetrics.riseTime.toFixed(3)} s` : '—',
    Mp: `${rawMetrics.peakOvershoot?.toFixed(1)}%`,
    Ts: Number.isFinite(rawMetrics.settlingTime) ? `${rawMetrics.settlingTime?.toFixed(3)} s` : '∞ / unsettled',
    Ess: `${rawMetrics.steadyStateError?.toFixed(4)}`,
    statusLabel: 'STABIL (SETTLED) / >999% OS (KONTRA-DIKTIF)',
  };

  // AFTER (guarded J1):
  const stepAmp = Math.abs(sp - initialVal);
  const minStepThr = Math.max(0.02 * Math.abs(sp), 1e-4);
  const isStepValid = stepAmp >= minStepThr;
  const currentErr = Math.abs(history[history.length - 1].error);
  const isErrorInBand = currentErr <= 0.02 * Math.max(Math.abs(sp), 1);
  const isSettled = rawMetrics.settlingStatus === 'settled' && isErrorInBand;

  const after = {
    scenario: 'Line Follower (SP=0, Dorong)',
    Kp: pidConfig.Kp,
    Ki: pidConfig.Ki,
    Kd: pidConfig.Kd,
    stepAmp: stepAmp,
    Tr: isStepValid && rawMetrics.riseTime !== null ? `${rawMetrics.riseTime.toFixed(3)} s` : '—',
    Mp: isStepValid && rawMetrics.peakOvershoot !== null ? `${rawMetrics.peakOvershoot.toFixed(1)}%` : '—',
    tooltip: !isStepValid ? 'Tidak ada step (setpoint tidak berubah)' : '',
    Ts: Number.isFinite(rawMetrics.settlingTime) ? `${rawMetrics.settlingTime?.toFixed(3)} s` : '∞ / unsettled',
    Ess: `${rawMetrics.steadyStateError?.toFixed(4)}`,
    statusLabel: isSettled ? 'STABIL (SETTLED)' : currentErr > 0.05 ? 'TRANSIEN' : 'STABIL (SETTLED)',
  };

  return { before, after };
}

// Scenario 2: Drone Step 0 -> 5 m
function runScenario2() {
  const drone = ROBOTS.find((r) => r.id === 'quadcopter')!;
  const plant = { ...drone.defaultPlant };
  const pidConfig = {
    Kp: 1.570,
    Ki: 0.129,
    Kd: 1.702,
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

  const sp = 5.0;
  const initialVal = 0.0;

  // Run 15 seconds to observe step response
  for (let i = 0; i < 1500; i++) {
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

  // Before P1 (hardcoded actuatorLimits [-100, 100]):
  const metricsBefore = computeStepResponseMetrics(history, sp, {
    stepStartTime: 0,
    initialValue: initialVal,
    actuatorLimits: [-100, 100],
  });

  // After P1 + J1 (plant.actuatorLimits [0, 20]):
  const metricsAfter = computeStepResponseMetrics(history, sp, {
    stepStartTime: 0,
    initialValue: initialVal,
    actuatorLimits: plant.actuatorLimits,
  });

  const before = {
    scenario: 'Drone Step (0 → 5 m)',
    Kp: pidConfig.Kp,
    Ki: pidConfig.Ki,
    Kd: pidConfig.Kd,
    stepAmp: Math.abs(sp - initialVal),
    actuatorLimits: '[-100, 100] (Hardcode)',
    satFraction: metricsBefore.saturationFraction,
    Tr: `${metricsBefore.riseTime?.toFixed(3)} s`,
    Mp: `${metricsBefore.peakOvershoot?.toFixed(1)}%`,
    Ts: `${metricsBefore.settlingTime?.toFixed(3)} s`,
    Ess: `${metricsBefore.steadyStateError?.toFixed(4)} m`,
    status: metricsBefore.settlingStatus,
  };

  const after = {
    scenario: 'Drone Step (0 → 5 m)',
    Kp: pidConfig.Kp,
    Ki: pidConfig.Ki,
    Kd: pidConfig.Kd,
    stepAmp: Math.abs(sp - initialVal),
    actuatorLimits: `[${plant.actuatorLimits[0]}, ${plant.actuatorLimits[1]}] (Plant Aktif)`,
    satFraction: metricsAfter.saturationFraction,
    Tr: `${metricsAfter.riseTime?.toFixed(3)} s`,
    Mp: `${metricsAfter.peakOvershoot?.toFixed(1)}%`,
    Ts: `${metricsAfter.settlingTime?.toFixed(3)} s`,
    Ess: `${metricsAfter.steadyStateError?.toFixed(4)} m`,
    status: metricsAfter.settlingStatus,
  };

  return { before, after };
}

console.log('=== TRACK J3 VERIFIKASI METRIK SEBELUM & SESUDAH ===');
const s1 = runScenario1();
console.log('\n--- SKENARIO 1: Line Follower SP=0 + Dorong ---');
console.log('SEBELUM:', JSON.stringify(s1.before, null, 2));
console.log('SESUDAH:', JSON.stringify(s1.after, null, 2));

const s2 = runScenario2();
console.log('\n--- SKENARIO 2: Drone Step 0 -> 5 m ---');
console.log('SEBELUM:', JSON.stringify(s2.before, null, 2));
console.log('SESUDAH:', JSON.stringify(s2.after, null, 2));
