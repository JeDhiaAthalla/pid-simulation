import {
  zieglerNicholsTuning,
  cohenCoonTuning,
  itaeOptimalTuning,
  getAllTuningResults,
  generateRecommendations,
  numericalOptimization,
} from '../lib/tuner';
import {
  simulationStep,
  createPlantState,
  createControllerState,
  computeStepResponseMetrics,
  runMicroSimulation,
  PHYSICS_DT,
} from '../lib/physicsEngine';
import { ROBOTS } from '../types/robots';
import { PlantParameters, PIDConfig, StepResponseMetrics } from '../types/simulation';

const drone = ROBOTS.find((r) => r.id === 'quadcopter')!;
const dronePlant: PlantParameters = drone.defaultPlant;

console.log('====================================================');
console.log('REPRO SCRIPT: TESTING HYPOTHESES H1 - H6');
console.log('====================================================');

// -----------------------------------------------------------------
// H1: Analytical FOPDT Gains for Drone
// -----------------------------------------------------------------
console.log('\n--- H1: Analytical FOPDT Gains for Drone (K=1.5, tau=0.2, L=0.015) ---');
const zn = zieglerNicholsTuning(dronePlant);
const cc = cohenCoonTuning(dronePlant);
const itae = itaeOptimalTuning(dronePlant);

console.log('Ziegler-Nichols:', zn.gains, 'Confidence:', zn.confidence);
console.log('Cohen-Coon:     ', cc.gains, 'Confidence:', cc.confidence);
console.log('ITAE Optimal:   ', itae.gains, 'Confidence:', itae.confidence);

// What if L is very small (e.g. 0.001)?
const droneSmallL = { ...dronePlant, deadTime: 0.001 };
const znSmall = zieglerNicholsTuning(droneSmallL);
console.log('ZN with L=0.001:', znSmall.gains, 'Confidence:', znSmall.confidence);

// -----------------------------------------------------------------
// H2: Nelder-Mead Seed Selection
// -----------------------------------------------------------------
console.log('\n--- H2: Seed Selection in getAllTuningResults ---');
const allResults = getAllTuningResults(dronePlant, 1.0, { Kp: 2, Ki: 0.5, Kd: 0.3 });
console.log('Confidences: ZN =', zn.confidence, ', CC =', cc.confidence, ', ITAE =', itae.confidence);
const bestAnalytical = [zn, cc, itae].reduce((best, r) => (r.confidence > best.confidence ? r : best));
console.log('Selected Seed Method:', bestAnalytical.method, 'Gains:', bestAnalytical.gains);
console.log('All Results Methods:', allResults.map(r => ({ method: r.method, gains: r.gains, conf: r.confidence })));

// -----------------------------------------------------------------
// H3: Ki Trajectory during Nelder-Mead
// -----------------------------------------------------------------
console.log('\n--- H3: Ki Evaluation Trajectory in Numerical Optimization ---');
// Let's run numerical optimization and check final Ki
const numRes = numericalOptimization(dronePlant, 1.0, bestAnalytical.gains, {
  weights: [1.0, 0.01, 0.001],
  maxIterations: 200,
  tolerance: 1e-5,
  horizon: 5,
});
console.log('Numerical Opt Result Gains:', numRes.gains, 'Cost:', numRes.cost);

// -----------------------------------------------------------------
// H4: Repeated generateRecommendations on Saturated System with SSE
// -----------------------------------------------------------------
console.log('\n--- H4: Repeated generateRecommendations (15 iterations) ---');
let currentGains = { Kp: 2.0, Ki: 0.5, Kd: 0.3 };
const satMetrics: StepResponseMetrics = {
  riseTime: 0.1,
  peakOvershoot: 0,
  settlingTime: 5.0,
  steadyStateError: 0.8, // SSE > 0.5 triggers Ki * 1.5 + 0.1
  peakTime: 0.1,
  peakValue: 0.2,
  oscillationFrequency: null,
  isStable: true,
  dampingAssessment: 'overdamped',
};

console.log(`Iter 0: Kp=${currentGains.Kp.toFixed(2)}, Ki=${currentGains.Ki.toFixed(2)}, Kd=${currentGains.Kd.toFixed(2)}`);
for (let iter = 1; iter <= 15; iter++) {
  const recs = generateRecommendations(satMetrics, currentGains, dronePlant);
  const sseRec = recs.find(r => r.suggestedGains?.Ki !== undefined);
  if (sseRec && sseRec.suggestedGains) {
    currentGains = {
      Kp: sseRec.suggestedGains.Kp ?? currentGains.Kp,
      Ki: sseRec.suggestedGains.Ki ?? currentGains.Ki,
      Kd: sseRec.suggestedGains.Kd ?? currentGains.Kd,
    };
    console.log(`Iter ${iter}: Ki = ${currentGains.Ki.toFixed(2)}`);
  }
}

// -----------------------------------------------------------------
// H5: Missing Feedforward & Gravity in Simulation
// -----------------------------------------------------------------
console.log('\n--- H5: Missing Feedforward & Gravity Calculation in simulationStep ---');
const simConfig: PIDConfig = {
  Kp: 2.0,
  Ki: 0.5,
  Kd: 0.3,
  derivativeFilterN: 20,
  integralClamp: [-100, 100],
  derivativeOnMeasurement: true,
  antiWindupKb: 0.5,
  dt: PHYSICS_DT,
};

let pState = createPlantState(dronePlant);
let cState = createControllerState();
const setpoint = 1.0;

let hoverIntegralNeeded = 0;
for (let step = 0; step < 1000; step++) {
  const res = simulationStep(setpoint, pState, cState, dronePlant, simConfig);
  pState = res.plantState;
  cState = res.controllerState;
  if (step === 200 || step === 500 || step === 999) {
    const t = (step * PHYSICS_DT).toFixed(2);
    console.log(`t=${t}s: z=${pState.x[0].toFixed(3)}m, v=${pState.x[1].toFixed(3)}m/s, u=${res.controlEffort.toFixed(2)}N, u_unsat=${cState.controlOutputUnsat.toFixed(2)}N, iTerm=${cState.iTerm.toFixed(3)}, sat=${cState.isSaturated}`);
  }
}

// Check gravityLoad at x[0] = 1.0 m in old plantDerivatives:
// Old code: gravityLoad = gravityTorque * Math.sin(x[0] * Math.PI / 180)
const oldGravityAt1m = dronePlant.gravityTorque * Math.sin(1.0 * Math.PI / 180);
console.log(`Old gravityLoad at z=1.0m (sin(1 deg)): ${oldGravityAt1m.toFixed(4)} N (vs real mg = 9.81 N)`);
const oldKwn2u = dronePlant.gain * dronePlant.naturalFrequency * dronePlant.naturalFrequency;
console.log(`Old K*wn^2 factor: ${oldKwn2u} (accel = ${oldKwn2u}*u - 100*z ...)`);

// -----------------------------------------------------------------
// H6: computeStepResponseMetrics Edge Cases
// -----------------------------------------------------------------
console.log('\n--- H6: computeStepResponseMetrics Edge Cases ---');
// (a) Last sample outside band:
const fakeDataA = [
  { time: 0, setpoint: 1, processVariable: 0, controlEffort: 10, error: 1, pTerm: 0, iTerm: 0, dTerm: 0 },
  { time: 1, setpoint: 1, processVariable: 1.0, controlEffort: 10, error: 0, pTerm: 0, iTerm: 0, dTerm: 0 },
  { time: 2, setpoint: 1, processVariable: 1.0, controlEffort: 10, error: 0, pTerm: 0, iTerm: 0, dTerm: 0 },
  { time: 3, setpoint: 1, processVariable: 1.0, controlEffort: 10, error: 0, pTerm: 0, iTerm: 0, dTerm: 0 },
  { time: 4, setpoint: 1, processVariable: 1.0, controlEffort: 10, error: 0, pTerm: 0, iTerm: 0, dTerm: 0 },
  { time: 5, setpoint: 1, processVariable: 1.0, controlEffort: 10, error: 0, pTerm: 0, iTerm: 0, dTerm: 0 },
  { time: 6, setpoint: 1, processVariable: 1.0, controlEffort: 10, error: 0, pTerm: 0, iTerm: 0, dTerm: 0 },
  { time: 7, setpoint: 1, processVariable: 1.0, controlEffort: 10, error: 0, pTerm: 0, iTerm: 0, dTerm: 0 },
  { time: 8, setpoint: 1, processVariable: 1.0, controlEffort: 10, error: 0, pTerm: 0, iTerm: 0, dTerm: 0 },
  { time: 9, setpoint: 1, processVariable: 1.0, controlEffort: 10, error: 0, pTerm: 0, iTerm: 0, dTerm: 0 },
  { time: 10, setpoint: 1, processVariable: 5.0, controlEffort: 10, error: -4, pTerm: 0, iTerm: 0, dTerm: 0 }, // OUTSIDE BAND at end!
];
const metricsA = computeStepResponseMetrics(fakeDataA, 1.0);
console.log('Case (a) Last sample outside band: settlingTime =', metricsA.settlingTime, 'isStable =', metricsA.isStable);

// (b) No sample outside band (all at 1.0):
const fakeDataB = fakeDataA.map(d => ({ ...d, processVariable: 1.0 }));
const metricsB = computeStepResponseMetrics(fakeDataB, 1.0);
console.log('Case (b) All samples inside band (amplitude=0): settlingTime =', metricsB.settlingTime, 'isStable =', metricsB.isStable);

// (c) Eternal oscillation:
const fakeOsc = [];
for (let i = 0; i < 200; i++) {
  const t = i * 0.05;
  fakeOsc.push({
    time: t,
    setpoint: 1.0,
    processVariable: 1.0 + 0.5 * Math.sin(t * 5), // perpetual 0.5m oscillation!
    controlEffort: 10,
    error: -0.5 * Math.sin(t * 5),
    pTerm: 0, iTerm: 0, dTerm: 0,
  });
}
const metricsOsc = computeStepResponseMetrics(fakeOsc, 1.0);
console.log('Case (c/d) Perpetual oscillation: settlingTime =', metricsOsc.settlingTime, 'isStable =', metricsOsc.isStable, 'damping =', metricsOsc.dampingAssessment);
