import assert from 'assert';
import {
  PHYSICS_DT,
  clamp,
  gaussianNoise,
  createPlantState,
  rk4Step,
  applyDeadTime,
  createControllerState,
  pidStep,
  simulationStep,
  createAccumulator,
  advanceAccumulator,
  computeStepResponseMetrics,
  runMicroSimulation,
  getHoverFeedforward,
  TelemetryRingBuffer,
} from '../lib/physicsEngine';
import {
  zieglerNicholsTuning,
  cohenCoonTuning,
  itaeOptimalTuning,
  numericalOptimization,
  getAllTuningResults,
  generateRecommendations,
  synthesizePolePlacement,
  polePlacementTuning,
  clampGains,
} from '../lib/tuner';
import { ROBOTS } from '../types/robots';
import { PlantParameters, PIDConfig, StepResponseMetrics } from '../types/simulation';

console.log('================================================================');
console.log('STARTING PHASE 3 VERIFICATION TESTS (T1 - T10)');
console.log('================================================================\n');

const droneRobot = ROBOTS.find((r) => r.id === 'quadcopter')!;
const dronePlant: PlantParameters = { ...droneRobot.defaultPlant };

// -----------------------------------------------------------------------------
// T1: Hover Check
// -----------------------------------------------------------------------------
console.log('--- TEST T1: Hover Equilibrium ---');
{
  const gains = synthesizePolePlacement(1.0, 0.5, 1.2, 0.9, 0.5);
  console.log(`Gains used (a=0.5): Kp=${gains.Kp.toFixed(3)}, Ki=${gains.Ki.toFixed(3)}, Kd=${gains.Kd.toFixed(3)}`);
  const sim = runMicroSimulation(dronePlant, gains, 1.0, 30.0, PHYSICS_DT);
  const lastPoint = sim.data[sim.data.length - 1];
  const u_ss = lastPoint.controlEffort;
  const z_ss = lastPoint.processVariable;
  const iTerm_ss = lastPoint.iTerm;
  const ess30 = Math.abs(1.0 - z_ss);

  console.log(`Steady-State control effort u(t): ${u_ss.toFixed(4)} N (Expected: 9.81 ± 0.05 N)`);
  console.log(`Steady-State altitude z(30s):     ${z_ss.toFixed(4)} m (Expected: 1.00 ± 0.01 m)`);
  console.log(`Steady-State error e_ss(30s):     ${ess30.toExponential(4)} m (Target: <= 0.01 m)`);
  console.log(`Steady-State iTerm:               ${iTerm_ss.toFixed(4)} N (Expected small, not hundreds)`);

  assert(Math.abs(u_ss - 9.81) <= 0.05, `T1 Failed: u_ss ${u_ss} not in 9.81 ± 0.05`);
  assert(ess30 <= 0.01, `T1 Failed: |e_ss(30s)| ${ess30} > 0.01 m`);
  assert(Math.abs(iTerm_ss) < 2.0, `T1 Failed: iTerm ${iTerm_ss} is too large`);
  console.log('>> T1 PASSED\n');
}

// -----------------------------------------------------------------------------
// T2: Formula Oracle Check
// -----------------------------------------------------------------------------
console.log('--- TEST T2: Oracle Formula Check ---');
{
  const formulaGains = synthesizePolePlacement(1.0, 0.5, 1.2, 0.9, 1.0);
  console.log(`synthesizePolePlacement(1, 0.5, 1.2, 0.9, 1):`);
  console.log(`  Kp = ${formulaGains.Kp.toFixed(4)} (Expected: 4.032)`);
  console.log(`  Ki = ${formulaGains.Ki.toFixed(4)} (Expected: 1.728)`);
  console.log(`  Kd = ${formulaGains.Kd.toFixed(4)} (Expected: 2.860)`);

  const kpErr = Math.abs(formulaGains.Kp - 4.032) / 4.032;
  const kiErr = Math.abs(formulaGains.Ki - 1.728) / 1.728;
  const kdErr = Math.abs(formulaGains.Kd - 2.860) / 2.860;

  assert(kpErr < 0.01, `T2 Failed: Kp error ${kpErr}`);
  assert(kiErr < 0.01, `T2 Failed: Ki error ${kiErr}`);
  assert(kdErr < 0.01, `T2 Failed: Kd error ${kdErr}`);

  // Routh-Hurwitz stability criterion: (c + Kd)*Kp > m*Ki
  const m = 1.0;
  const c = 0.5;
  const routhLHS = (c + formulaGains.Kd) * formulaGains.Kp;
  const routhRHS = m * formulaGains.Ki;
  console.log(`  Routh-Hurwitz Check: (c + Kd)*Kp = ${routhLHS.toFixed(4)} > m*Ki = ${routhRHS.toFixed(4)}`);
  assert(routhLHS > routhRHS, 'T2 Failed: Routh-Hurwitz violated');
  console.log('>> T2 PASSED\n');
}

// -----------------------------------------------------------------------------
// T3: Auto-Tune Response Check
// -----------------------------------------------------------------------------
console.log('--- TEST T3: Auto-Tune Pole Placement Response ---');
{
  const tuneRes = polePlacementTuning(dronePlant, 1.0);
  console.log(`Tuning result method: ${tuneRes.method}`);
  console.log(`Recommendation:       ${tuneRes.recommendation}`);
  console.log(`Gains used (auto-tune): Kp=${tuneRes.gains.Kp.toFixed(3)}, Ki=${tuneRes.gains.Ki.toFixed(3)}, Kd=${tuneRes.gains.Kd.toFixed(3)}`);

  const sim = runMicroSimulation(dronePlant, tuneRes.gains, 1.0, 30.0, PHYSICS_DT);
  const m = sim.metrics;
  const peakU = Math.max(...sim.data.map((d) => Math.abs(d.controlEffort)));
  const u_ss = sim.data[sim.data.length - 1].controlEffort;
  const z_ss = sim.data[sim.data.length - 1].processVariable;
  const ess30 = Math.abs(1.0 - z_ss);

  const clampInfo = clampGains(tuneRes.gains, dronePlant, 1.0);

  console.log(`Metrics:`);
  console.log(`  %Overshoot:          ${(m.peakOvershoot ?? 0).toFixed(2)}% (Target: <= 10%)`);
  console.log(`  Settling Time Ts:    ${(m.settlingTime ?? 0).toFixed(3)} s (Target: finite)`);
  console.log(`  Steady-State Error e_ss(30s): ${ess30.toFixed(4)} m (Target: <= 0.01 m)`);
  console.log(`  Peak Control Effort: ${peakU.toFixed(3)} N (Target: <= 20 N)`);
  console.log(`  Steady State u:      ${u_ss.toFixed(3)} N (Target: not saturated)`);
  console.log(`  Sustained Osc:       ${m.sustainedOscillation}`);
  console.log(`  Ki Clamped Limit:    ${clampInfo.gains.Ki.toFixed(3)} N`);

  assert((m.peakOvershoot ?? 0) <= 10.0, `T3 Failed: %OS ${(m.peakOvershoot ?? 0)} > 10%`);
  assert(m.settlingTime !== null && Number.isFinite(m.settlingTime), `T3 Failed: Ts is not finite`);
  assert(ess30 <= 0.01, `T3 Failed: |e_ss(30s)| ${ess30} > 0.01 m`);
  assert(peakU <= 20.0, `T3 Failed: peak U ${peakU} > 20`);
  assert(u_ss < 19.9 && u_ss > 0.1, `T3 Failed: u saturated at steady state`);
  assert(!m.sustainedOscillation, `T3 Failed: sustained oscillation detected`);
  assert(tuneRes.gains.Ki <= clampInfo.gains.Ki + 1e-4, `T3 Failed: Ki exceeded clamp limit`);
  console.log('>> T3 PASSED\n');
}

// -----------------------------------------------------------------------------
// T4: Negative Test (Old Bad Gains)
// -----------------------------------------------------------------------------
console.log('--- TEST T4: Negative Test (Old Bad Gains) ---');
{
  const badGains = { Kp: 50, Ki: 414.81, Kd: 0 };
  const sim = runMicroSimulation(dronePlant, badGains, 1.0, 15.0, PHYSICS_DT);
  const m = sim.metrics;

  console.log(`Old bad gains (Kp=50, Ki=414.81, Kd=0):`);
  console.log(`  Settling Time:      ${m.settlingTime}`);
  console.log(`  Settling Status:    ${m.settlingStatus}`);
  console.log(`  Sustained Osc:      ${m.sustainedOscillation}`);
  console.log(`  isStable:           ${m.isStable}`);
  console.log(`  dampingAssessment:  ${m.dampingAssessment}`);

  assert(m.settlingTime === Infinity, `T4 Failed: Ts should be Infinity`);
  assert(m.sustainedOscillation === true, `T4 Failed: sustainedOscillation should be true`);
  assert(m.isStable === false, `T4 Failed: isStable should be false`);
  assert(m.dampingAssessment === 'unstable', `T4 Failed: dampingAssessment should be unstable`);
  console.log('>> T4 PASSED\n');
}

// -----------------------------------------------------------------------------
// T5: Anti-Windup Test (True Gradual Saturation & Recovery)
// -----------------------------------------------------------------------------
console.log('--- TEST T5: Anti-Windup Saturation Recovery (Gradual Saturation) ---');
{
  const gains = { Kp: 2.736, Ki: 0.864, Kd: 2.260 };
  const config: PIDConfig = {
    ...gains,
    derivativeFilterN: 20,
    integralClamp: [-1000, 1000],
    derivativeOnMeasurement: true,
    antiWindupKb: 0.5,
    dt: PHYSICS_DT,
  };

  const u_ff = getHoverFeedforward(dronePlant);
  const I_max = 0.5 * Math.min(dronePlant.actuatorLimits[1] - u_ff, u_ff - dronePlant.actuatorLimits[0]);

  // Scenario: SP = 30.0m for 4.0s (saturates actuator gradually as drone climbs),
  // then SP drops to 1.0m. Total simulation 25s.
  const tStep = 4.0;
  const tTotal = 25.0;
  const totalSteps = Math.ceil(tTotal / PHYSICS_DT);

  let pState = createPlantState(dronePlant);
  let cState = createControllerState();

  let maxITerm = 0;
  let maxZAfterStep = 0;
  let timeToBand5: number | null = null;
  let timeToBand2: number | null = null;

  for (let i = 0; i < totalSteps; i++) {
    const t = i * PHYSICS_DT;
    const sp = t < tStep ? 30.0 : 1.0;

    const res = simulationStep(sp, pState, cState, dronePlant, config);
    pState = res.plantState;
    cState = res.controllerState;

    if (Math.abs(cState.iTerm) > maxITerm) maxITerm = Math.abs(cState.iTerm);
    if (t >= tStep && pState.x[0] > maxZAfterStep) maxZAfterStep = pState.x[0];

    if (t >= tStep) {
      const err = Math.abs(pState.x[0] - 1.0);
      if (err <= 0.05 && timeToBand5 === null) timeToBand5 = t - tStep;
      else if (err > 0.05) timeToBand5 = null;

      if (err <= 0.02 && timeToBand2 === null) timeToBand2 = t - tStep;
      else if (err > 0.02) timeToBand2 = null;
    }
  }

  const finalZ = pState.x[0];
  console.log(`True Windup Results:`);
  console.log(`  |Ki * integral| max:          ${maxITerm.toFixed(4)} N (I_max limit = ${I_max.toFixed(4)} N)`);
  console.log(`  Peak altitude z_max (t >= 4s): ${maxZAfterStep.toFixed(3)} m`);
  console.log(`  Time to 5% band [0.95, 1.05]: ${timeToBand5 !== null ? timeToBand5.toFixed(2) + ' s' : 'None'}`);
  console.log(`  Time to 2% band [0.98, 1.02]: ${timeToBand2 !== null ? timeToBand2.toFixed(2) + ' s' : 'None'}`);
  console.log(`  Final altitude (t = 25s):     ${finalZ.toFixed(4)} m`);

  assert(maxITerm <= I_max + 1e-4, `T5 Failed: |Ki*integral| exceeded I_max`);
  assert(timeToBand5 !== null && timeToBand5 <= 15.0, `T5 Failed: did not return to 5% band in <= 15s`);
  assert(timeToBand2 !== null && timeToBand2 <= 16.0, `T5 Failed: did not return to 2% band in <= 16s`);
  assert(Math.abs(finalZ - 1.0) <= 0.01, `T5 Failed: final z did not reach 1.0 ± 0.01m`);
  console.log('>> T5 PASSED\n');
}

// -----------------------------------------------------------------------------
// T6: Non-Drone Archetype Regression Check
// -----------------------------------------------------------------------------
console.log('--- TEST T6: Non-Drone Archetypes Regression Check ---');
{
  // Part A: rk4Step old vs new on random inputs
  function rk4StepOld(x: number[], u: number, dt: number, plant: PlantParameters, gravityInRadians: boolean): number[] {
    const { dampingRatio: z, naturalFrequency: wn, gain: K, friction, gravityTorque } = plant;
    function deriv(state: number[]): number[] {
      if (plant.order === 1) {
        const tau = plant.timeConstant > 0 ? plant.timeConstant : 0.01;
        const frictionTerm = friction * Math.sign(state[0]) * Math.abs(state[0]);
        return [(K * u - state[0] - frictionTerm) / tau];
      }
      const velocity = state[1];
      const frictionForce = friction * Math.sign(velocity) * Math.abs(velocity);
      const gravityLoad = gravityTorque > 0
        ? gravityTorque * Math.sin(gravityInRadians ? state[0] : state[0] * Math.PI / 180)
        : 0;
      const accel = K * wn * wn * u - 2 * z * wn * velocity - wn * wn * state[0] - frictionForce - gravityLoad;
      return [velocity, accel];
    }
    const k1 = deriv(x);
    const x2 = x.map((xi, i) => xi + 0.5 * dt * k1[i]);
    const k2 = deriv(x2);
    const x3 = x.map((xi, i) => xi + 0.5 * dt * k2[i]);
    const k3 = deriv(x3);
    const x4 = x.map((xi, i) => xi + dt * k3[i]);
    const k4 = deriv(x4);
    return x.map((xi, i) => xi + (dt / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]));
  }

  let maxRk4Diff = 0;
  const nonDroneRobots = ROBOTS.filter((r) => r.id !== 'quadcopter');
  const numEvaluations = 10000;
  for (let test = 0; test < numEvaluations; test++) {
    const robot = nonDroneRobots[test % nonDroneRobots.length];
    const plant = robot.defaultPlant;
    const x = plant.order === 1 ? [(Math.random() - 0.5) * 10] : [(Math.random() - 0.5) * 20, (Math.random() - 0.5) * 10];
    const u = (Math.random() - 0.5) * 20;
    const rOld = rk4StepOld(x, u, PHYSICS_DT, plant, robot.gravityInRadians ?? false);
    const rNew = rk4Step(x, u, PHYSICS_DT, plant, robot.gravityInRadians ?? false);
    for (let i = 0; i < x.length; i++) {
      const diff = Math.abs(rOld[i] - rNew[i]);
      if (diff > maxRk4Diff) maxRk4Diff = diff;
    }
  }

  const sciFormat = maxRk4Diff === 0 ? '0.000e+00' : maxRk4Diff.toExponential(4);
  console.log(`Evaluated ${numEvaluations} random inputs across ${nonDroneRobots.length} non-drone archetypes.`);
  console.log(`Max difference in rk4Step (random inputs): ${sciFormat} (Target: <= 1.0e-12)`);
  assert(maxRk4Diff <= 1e-12, `T6 Part A Failed: rk4Step diff ${maxRk4Diff} > 1e-12`);

  // Part B: Trace PV comparison for non-drone archetypes
  let maxTraceDiff = 0;
  for (const robot of ROBOTS) {
    if (robot.id === 'quadcopter') continue;
    const plant = robot.defaultPlant;
    const fixedGains = { Kp: 2.0, Ki: 0.5, Kd: 0.1 };
    const config: PIDConfig = {
      ...fixedGains,
      derivativeFilterN: 20,
      integralClamp: [-1000, 1000],
      derivativeOnMeasurement: true,
      antiWindupKb: 0.5,
      dt: PHYSICS_DT,
    };

    let pStateOld = createPlantState(plant);
    let cStateOld = createControllerState();
    let pStateNew = createPlantState(plant);
    let cStateNew = createControllerState();

    for (let step = 0; step < 200; step++) {
      const sp = 1.0;
      // Step using rk4StepOld
      const mOld = pStateOld.measuredOutput;
      const cOld = pidStep(sp, mOld, config, cStateOld, plant.actuatorLimits, 0);
      const xOld = rk4StepOld(pStateOld.x, cOld.controlOutput, PHYSICS_DT, plant, robot.gravityInRadians ?? false);
      const dtOutOld = plant.deadTime > 0 ? applyDeadTime(xOld[0], pStateOld, PHYSICS_DT) : xOld[0];
      pStateOld = { ...pStateOld, x: xOld, measuredOutput: dtOutOld };
      cStateOld = cOld;

      // Step using new simulationStep
      const resNew = simulationStep(sp, pStateNew, cStateNew, plant, config, 0, undefined, robot.gravityInRadians ?? false);
      pStateNew = resNew.plantState;
      cStateNew = resNew.controllerState;

      const diff = Math.abs(resNew.processVariable - dtOutOld);
      if (diff > maxTraceDiff) maxTraceDiff = diff;
    }
  }

  console.log(`Max trace PV difference across non-drone archetypes: ${maxTraceDiff.toExponential(4)} (Target: <= 1e-9)`);
  assert(maxTraceDiff <= 1e-9, `T6 Part B Failed: trace diff ${maxTraceDiff} > 1e-9`);
  console.log('>> T6 PASSED\n');
}

// -----------------------------------------------------------------------------
// T7: Synthetic Settling Time Tests
// -----------------------------------------------------------------------------
console.log('--- TEST T7: Synthetic Settling Time Unit Tests ---');
{
  const makeDP = (t: number, pv: number) => ({
    time: t,
    processVariable: pv,
    setpoint: 1.0,
    controlEffort: 5.0,
    error: 1.0 - pv,
    pTerm: 0,
    iTerm: 0,
    dTerm: 0,
  });

  // (a) Exponential converging to 1.0: y(t) = 1 - exp(-t)
  // SP = 1.0, thr = 0.05. 2% band is [0.95, 1.05]. 1 - exp(-t) = 0.95 => exp(-t) = 0.05 => t = -ln(0.05) ≈ 2.9957 s.
  const expData = [];
  for (let i = 0; i < 1000; i++) {
    const t = i * 0.01;
    expData.push(makeDP(t, 1.0 - Math.exp(-t)));
  }
  const mExp = computeStepResponseMetrics(expData, 1.0);
  console.log(`  (a) Exponential: analytical Ts ≈ 2.996s, computed Ts = ${(mExp.settlingTime ?? 0).toFixed(3)}s`);
  assert(mExp.settlingTime !== null && Math.abs(mExp.settlingTime - 2.996) < 0.05, 'T7a Failed');

  // (b) Sinusoid amplitude 0.5 around SP = 1.0 => Infinity
  const sinData = [];
  for (let i = 0; i < 500; i++) {
    const t = i * 0.01;
    sinData.push(makeDP(t, 1.0 + 0.5 * Math.sin(t * 10)));
  }
  const mSin = computeStepResponseMetrics(sinData, 1.0);
  console.log(`  (b) Undamped Sinusoid: Ts = ${mSin.settlingTime}, sustainedOsc = ${mSin.sustainedOscillation}`);
  assert(mSin.settlingTime === Infinity, 'T7b Failed');

  // (c) End sample outside band => Infinity
  const endOutsideData = [];
  for (let i = 0; i < 100; i++) {
    const t = i * 0.01;
    endOutsideData.push(makeDP(t, i === 99 ? 1.5 : 1.0));
  }
  const mEnd = computeStepResponseMetrics(endOutsideData, 1.0);
  console.log(`  (c) End sample outside band: Ts = ${mEnd.settlingTime}`);
  assert(mEnd.settlingTime === Infinity, 'T7c Failed');

  // (d) All samples inside band => Ts = 0
  const allInsideData = [];
  for (let i = 0; i < 100; i++) {
    const t = i * 0.01;
    allInsideData.push(makeDP(t, 1.0));
  }
  const mInside = computeStepResponseMetrics(allInsideData, 1.0);
  console.log(`  (d) All samples inside band: Ts = ${mInside.settlingTime}`);
  assert(mInside.settlingTime === 0, 'T7d Failed');

  // (e) SP = 0 and initial = 0 => no NaN/Infinity
  const zeroData = [];
  for (let i = 0; i < 100; i++) {
    const t = i * 0.01;
    zeroData.push({
      time: t,
      processVariable: 0,
      setpoint: 0,
      controlEffort: 0,
      error: 0,
      pTerm: 0,
      iTerm: 0,
      dTerm: 0,
    });
  }
  const mZero = computeStepResponseMetrics(zeroData, 0.0);
  console.log(`  (e) Zero SP & initial: Ts = ${mZero.settlingTime}, %OS = ${mZero.peakOvershoot}`);
  assert(!Number.isNaN(mZero.settlingTime ?? 0), 'T7e Failed');
  assert(!Number.isNaN(mZero.peakOvershoot ?? 0), 'T7e Failed');

  // (f) Buffer empty / 1 sample => null without throwing
  const mEmpty = computeStepResponseMetrics([], 1.0);
  const mOne = computeStepResponseMetrics([makeDP(0, 0)], 1.0);
  console.log(`  (f) Empty buffer: Ts = ${mEmpty.settlingTime}, 1-sample: Ts = ${mOne.settlingTime}`);
  assert(mEmpty.settlingTime === null, 'T7f Empty Failed');
  assert(mOne.settlingTime === null, 'T7f One Failed');

  console.log('>> T7 PASSED\n');
}

// -----------------------------------------------------------------------------
// T8: Recommendation Iteration Check
// -----------------------------------------------------------------------------
console.log('--- TEST T8: Recommendation Engine 20x Iteration Safety ---');
{
  const clampLimit = clampGains({ Kp: 100, Ki: 100, Kd: 100 }, dronePlant, 1.0).gains;

  // Case A: Saturated system
  let gainsSat = { Kp: 5.0, Ki: 2.0, Kd: 1.0 };
  for (let i = 0; i < 20; i++) {
    const metrics: StepResponseMetrics = {
      riseTime: 0.5,
      peakOvershoot: 15,
      settlingTime: 2.0,
      steadyStateError: 0.6,
      peakTime: 1.0,
      peakValue: 1.15,
      oscillationFrequency: null,
      isStable: true,
      dampingAssessment: 'underdamped',
      saturationFraction: 0.45, // saturated!
    };
    const recs = generateRecommendations(metrics, gainsSat, dronePlant);
    for (const r of recs) {
      if (r.suggestedGains) {
        gainsSat = { ...gainsSat, ...r.suggestedGains };
      }
    }
  }
  console.log(`  Case A (20x Saturated): Ki ended at ${gainsSat.Ki.toFixed(4)} (Clamp limit = ${clampLimit.Ki.toFixed(4)})`);
  assert(gainsSat.Ki <= clampLimit.Ki + 1e-4, 'T8 Case A Failed: Ki exceeded limit');

  // Case B: Oscillating system
  let gainsOsc = { Kp: 10.0, Ki: 5.0, Kd: 0.1 };
  for (let i = 0; i < 20; i++) {
    const metrics: StepResponseMetrics = {
      riseTime: 0.2,
      peakOvershoot: 45,
      settlingTime: Infinity,
      steadyStateError: 0.8,
      peakTime: 0.5,
      peakValue: 1.45,
      oscillationFrequency: 3.2,
      isStable: false,
      dampingAssessment: 'unstable',
      sustainedOscillation: true, // oscillating!
    };
    const recs = generateRecommendations(metrics, gainsOsc, dronePlant);
    for (const r of recs) {
      if (r.suggestedGains) {
        gainsOsc = { ...gainsOsc, ...r.suggestedGains };
      }
    }
  }
  console.log(`  Case B (20x Oscillating): Ki ended at ${gainsOsc.Ki.toFixed(4)} (Decreased safely, not ballooning)`);
  assert(gainsOsc.Ki < 0.1, 'T8 Case B Failed: Ki should be drastically reduced');
  console.log('>> T8 PASSED\n');
}

// -----------------------------------------------------------------------------
// T9: Telemetry Ring Buffer Check
// -----------------------------------------------------------------------------
console.log('--- TEST T9: Telemetry Ring Buffer Verification ---');
{
  const buf = new TelemetryRingBuffer(600);
  for (let i = 0; i < 1500; i++) {
    buf.push({
      time: i * 0.01,
      setpoint: 1.0,
      processVariable: Math.sin(i * 0.1),
      controlEffort: 9.81,
      error: 1.0 - Math.sin(i * 0.1),
      pTerm: 1,
      iTerm: 2,
      dTerm: 3,
    });
  }

  const arr = buf.toArray();
  console.log(`  Buffer capacity: ${buf.capacity}`);
  console.log(`  Buffer length:   ${buf.length} (Target: exactly 600)`);
  console.log(`  Oldest sample time: ${arr[0].time.toFixed(2)}s (Expected: (1500 - 600) * 0.01 = 9.00s)`);
  console.log(`  Newest sample time: ${arr[arr.length - 1].time.toFixed(2)}s (Expected: 1499 * 0.01 = 14.99s)`);

  assert(buf.length === 600, `T9 Failed: length ${buf.length} != 600`);
  assert(arr.length === 600, `T9 Failed: array length ${arr.length} != 600`);
  assert(Math.abs(arr[0].time - 9.0) < 1e-4, `T9 Failed: oldest time mismatch`);
  assert(Math.abs(arr[599].time - 14.99) < 1e-4, `T9 Failed: newest time mismatch`);

  // Check strictly monotonic time
  for (let i = 1; i < arr.length; i++) {
    assert(arr[i].time > arr[i - 1].time, `T9 Failed: time order not strictly ascending at index ${i}`);
  }
  console.log('>> T9 PASSED\n');
}

// -----------------------------------------------------------------------------
// B6: Additional Drone Robustness Tests
// -----------------------------------------------------------------------------
console.log('--- TEST B6: Drone Robustness Test Suite ---');
{
  const gains = synthesizePolePlacement(1.0, 0.5, 1.2, 0.9, 0.5); // robust hover configuration
  const config: PIDConfig = {
    ...gains,
    derivativeFilterN: 20,
    integralClamp: [-1000, 1000],
    derivativeOnMeasurement: true,
    antiWindupKb: 0.5,
    dt: PHYSICS_DT,
  };

  // B6(a): Constant disturbance -2 N and -0.5 N for 10 s
  for (const distVal of [-2.0, -0.5]) {
    let pState = createPlantState(dronePlant);
    let cState = createControllerState();
    const sp = 1.0;

    for (let i = 0; i < Math.ceil(10.0 / PHYSICS_DT); i++) {
      const res = simulationStep(sp, pState, cState, dronePlant, config);
      pState = res.plantState;
      cState = res.controllerState;
    }

    for (let i = 0; i < Math.ceil(10.0 / PHYSICS_DT); i++) {
      const res = simulationStep(sp, pState, cState, dronePlant, config, distVal);
      pState = res.plantState;
      cState = res.controllerState;
    }

    let recoveryTime: number | null = null;
    let finalEss = 0;
    for (let i = 0; i <= Math.ceil(15.0 / PHYSICS_DT); i++) {
      const tPost = i * PHYSICS_DT;
      const res = simulationStep(sp, pState, cState, dronePlant, config, 0);
      pState = res.plantState;
      cState = res.controllerState;
      const err = Math.abs(sp - res.processVariable);
      finalEss = err;
      if (err <= 0.01 && recoveryTime === null) {
        recoveryTime = tPost;
      } else if (err > 0.01) {
        recoveryTime = null;
      }
    }

    console.log(`  B6(a) Disturbance ${distVal} N: recoveryTime = ${recoveryTime?.toFixed(2)}s (<= 15s), final |e_ss| = ${finalEss.toFixed(4)} m`);
    assert(recoveryTime !== null && recoveryTime <= 15.0, `B6(a) Failed: recoveryTime > 15s for ${distVal} N`);
    assert(finalEss <= 0.01, `B6(a) Failed: final |e_ss| ${finalEss} > 0.01 m for ${distVal} N`);
  }

  // B6(b): Step down 2 -> 0.5 m (u_min check)
  {
    let pState = createPlantState(dronePlant);
    let cState = createControllerState();
    for (let i = 0; i < Math.ceil(15.0 / PHYSICS_DT); i++) {
      const res = simulationStep(2.0, pState, cState, dronePlant, config);
      pState = res.plantState;
      cState = res.controllerState;
    }
    let minU = Infinity;
    for (let i = 0; i < Math.ceil(15.0 / PHYSICS_DT); i++) {
      const res = simulationStep(0.5, pState, cState, dronePlant, config);
      pState = res.plantState;
      cState = res.controllerState;
      if (res.controlEffort < minU) minU = res.controlEffort;
    }
    console.log(`  B6(b) Step down 2 -> 0.5m: min u = ${minU.toFixed(3)} N (Actuator limits: [${dronePlant.actuatorLimits.join(', ')}]), final z = ${pState.x[0].toFixed(3)} m`);
    assert(minU >= dronePlant.actuatorLimits[0], `B6(b) Failed: u violated lower actuator limit`);
    assert(Math.abs(pState.x[0] - 0.5) <= 0.01, `B6(b) Failed: did not settle at 0.5m`);
  }

  // B6(c): Step amplitudes 0.2, 1, 5 m (wn_max active, u not saturated at steady state)
  for (const amp of [0.2, 1.0, 5.0]) {
    const sim = runMicroSimulation(dronePlant, gains, amp, 20.0, PHYSICS_DT);
    const peakU = Math.max(...sim.data.map((d) => Math.abs(d.controlEffort)));
    const u_ss = sim.data[sim.data.length - 1].controlEffort;
    const z_ss = sim.data[sim.data.length - 1].processVariable;
    console.log(`  B6(c) Amp ${amp}m: peak U = ${peakU.toFixed(2)} N, steady u = ${u_ss.toFixed(2)} N, steady z = ${z_ss.toFixed(3)} m`);
    assert(peakU <= dronePlant.actuatorLimits[1], `B6(c) Failed: peak U exceeded max actuator limit`);
    assert(u_ss < 19.9 && u_ss > 0.1, `B6(c) Failed: steady state saturated`);
    assert(Math.abs(z_ss - amp) <= 0.01, `B6(c) Failed: did not reach steady state for amp ${amp}`);
  }

  // B6(d): Sensor noise sigma=0.01 and sigma=0.05 (chattering check: p2p <= 2 N)
  // Low-pass filter N=1 on derivative suppresses high-frequency sensor noise chattering
  const noiseTestConfig: PIDConfig = { ...config, derivativeFilterN: 1 };
  for (const sigma of [0.01, 0.05]) {
    let pState = createPlantState(dronePlant);
    let cState = createControllerState();
    for (let i = 0; i < Math.ceil(10.0 / PHYSICS_DT); i++) {
      const res = simulationStep(1.0, pState, cState, dronePlant, noiseTestConfig);
      pState = res.plantState;
      cState = res.controllerState;
    }
    const uHistory: number[] = [];
    for (let i = 0; i < Math.ceil(5.0 / PHYSICS_DT); i++) {
      const res = simulationStep(1.0, pState, cState, dronePlant, noiseTestConfig, 0, { enabled: true, sigma });
      pState = res.plantState;
      cState = res.controllerState;
      uHistory.push(res.controlEffort);
    }
    const p2p = Math.max(...uHistory) - Math.min(...uHistory);
    console.log(`  B6(d) Noise sigma=${sigma}: steady state peak-to-peak u = ${p2p.toFixed(3)} N (Target: < 2.0 N)`);
    assert(p2p <= 2.0, `B6(d) Failed: chattering p2p ${p2p} > 2.0 N`);
  }

  // B6(e): Mass mismatch (true mass = 1.3 kg, gains tuned for 1.0 kg)
  {
    const mismatchedPlant: PlantParameters = { ...dronePlant, mass: 1.3 };
    const sim = runMicroSimulation(mismatchedPlant, gains, 1.0, 30.0, PHYSICS_DT);
    const finalPoint = sim.data[sim.data.length - 1];
    const ess = Math.abs(1.0 - finalPoint.processVariable);
    console.log(`  B6(e) Mass mismatch (1.3 kg): isStable=${sim.metrics.isStable}, final z=${finalPoint.processVariable.toFixed(4)} m, |e_ss|=${ess.toExponential(3)}, u_ss=${finalPoint.controlEffort.toFixed(2)} N (Expected: 1.3*9.81=${(1.3 * 9.81).toFixed(2)} N)`);
    assert(sim.metrics.isStable, `B6(e) Failed: system unstable under mass mismatch`);
    assert(ess <= 0.01, `B6(e) Failed: |e_ss| ${ess} > 0.01 m under mass mismatch`);
  }
  console.log('>> B6 PASSED\n');
}

console.log('================================================================');
console.log('ALL VERIFICATION TESTS T1 - T9 + B6 PASSED SUCCESSFULLY!');
console.log('================================================================');

