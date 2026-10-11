import { ROBOTS } from '../types/robots';
import { synthesizePolePlacement, clampGains, polePlacementTuning } from '../lib/tuner';
import {
  runMicroSimulation,
  getHoverFeedforward,
  PHYSICS_DT,
  createPlantState,
  createControllerState,
  simulationStep,
} from '../lib/physicsEngine';
import { PIDConfig, PlantParameters } from '../types/simulation';

const droneRobot = ROBOTS.find(r => r.id === 'quadcopter')!;
const plant = { ...droneRobot.defaultPlant };

function testB6(gains: { Kp: number; Ki: number; Kd: number }, label: string) {
  console.log(`\n======================================================`);
  console.log(`TESTING B6 with ${label}: Kp=${gains.Kp.toFixed(3)}, Ki=${gains.Ki.toFixed(3)}, Kd=${gains.Kd.toFixed(3)}`);
  console.log(`======================================================`);

  const config: PIDConfig = {
    ...gains,
    derivativeFilterN: 20,
    integralClamp: [-1000, 1000],
    derivativeOnMeasurement: true,
    antiWindupKb: 0.5,
    dt: PHYSICS_DT,
  };

  // -------------------------------------------------------------------------
  // B6(a): Constant disturbance -2 N and -0.5 N for 10s:
  // z returns to SP with |e_ss| <= 0.01 in <= 15s after disturbance.
  // -------------------------------------------------------------------------
  for (const distVal of [-2.0, -0.5]) {
    let pState = createPlantState(plant);
    let cState = createControllerState();
    const sp = 1.0;

    // Run 10s without disturbance to reach steady state
    for (let i = 0; i < Math.ceil(10.0 / PHYSICS_DT); i++) {
      const res = simulationStep(sp, pState, cState, plant, config);
      pState = res.plantState;
      cState = res.controllerState;
    }

    // Apply disturbance for 10s (t = 10 to 20s)
    for (let i = 0; i < Math.ceil(10.0 / PHYSICS_DT); i++) {
      // In simulationStep, disturbance is an external force in Newtons added to thrust
      // We pass disturbance via simulationStep:
      // signature: simulationStep(setpoint, pState, cState, plant, config, disturbance, noise, gravityInRadians)
      const res = simulationStep(sp, pState, cState, plant, config, distVal);
      pState = res.plantState;
      cState = res.controllerState;
    }

    // Disturbance ends at t=20s. Simulate up to 15s post-disturbance (t = 20 to 35s)
    let recoveryTime: number | null = null;
    let finalEss = 0;
    for (let i = 0; i <= Math.ceil(15.0 / PHYSICS_DT); i++) {
      const tPost = i * PHYSICS_DT;
      const res = simulationStep(sp, pState, cState, plant, config, 0);
      pState = res.plantState;
      cState = res.controllerState;
      const err = Math.abs(sp - res.processVariable);
      finalEss = err;

      if (err <= 0.01 && recoveryTime === null) {
        // Check if it stays within 0.01
        recoveryTime = tPost;
      } else if (err > 0.01) {
        recoveryTime = null;
      }
    }

    console.log(`B6(a) Disturbance ${distVal} N: recoveryTime = ${recoveryTime !== null ? recoveryTime.toFixed(2) + 's' : 'NEVER'} (<= 15s), final |e_ss| = ${finalEss.toFixed(4)} m`);
  }

  // -------------------------------------------------------------------------
  // B6(b): Step down 2 -> 0.5 m (u_min active?)
  // -------------------------------------------------------------------------
  {
    let pState = createPlantState(plant);
    let cState = createControllerState();
    // Start at 2m steady state
    for (let i = 0; i < Math.ceil(15.0 / PHYSICS_DT); i++) {
      const res = simulationStep(2.0, pState, cState, plant, config);
      pState = res.plantState;
      cState = res.controllerState;
    }
    // Step down to 0.5 m
    let minU = Infinity;
    let uMinHit = false;
    for (let i = 0; i < Math.ceil(15.0 / PHYSICS_DT); i++) {
      const res = simulationStep(0.5, pState, cState, plant, config);
      pState = res.plantState;
      cState = res.controllerState;
      if (res.controlEffort < minU) minU = res.controlEffort;
      if (res.controlEffort <= plant.actuatorLimits[0] + 1e-4) uMinHit = true;
    }
    console.log(`B6(b) Step down 2 -> 0.5m: min u = ${minU.toFixed(3)} N, u_min hit = ${uMinHit}, final z = ${pState.x[0].toFixed(3)} m`);
  }

  // -------------------------------------------------------------------------
  // B6(c): Step amplitudes 0.2, 1, 5 m (wn_max active, u not saturated at steady state)
  // -------------------------------------------------------------------------
  for (const amp of [0.2, 1.0, 5.0]) {
    const sim = runMicroSimulation(plant, gains, amp, 20.0, PHYSICS_DT);
    const peakU = Math.max(...sim.data.map(d => Math.abs(d.controlEffort)));
    const u_ss = sim.data[sim.data.length - 1].controlEffort;
    const z_ss = sim.data[sim.data.length - 1].processVariable;
    console.log(`B6(c) Amp ${amp}m: peak U = ${peakU.toFixed(2)} N, u_ss = ${u_ss.toFixed(2)} N, z_ss = ${z_ss.toFixed(3)} m, %OS = ${sim.metrics.peakOvershoot?.toFixed(1)}%`);
  }

  // -------------------------------------------------------------------------
  // B6(d): Sensor noise sigma=0.01 and sigma=0.05:
  // No chattering u > 2 N peak-to-peak in steady state
  // -------------------------------------------------------------------------
  for (const sigma of [0.01, 0.05]) {
    let pState = createPlantState(plant);
    let cState = createControllerState();
    // Run 10s to steady state without noise
    for (let i = 0; i < Math.ceil(10.0 / PHYSICS_DT); i++) {
      const res = simulationStep(1.0, pState, cState, plant, config);
      pState = res.plantState;
      cState = res.controllerState;
    }
    // Run 5s with noise at steady state, collect u
    const uHistory: number[] = [];
    for (let i = 0; i < Math.ceil(5.0 / PHYSICS_DT); i++) {
      const res = simulationStep(1.0, pState, cState, plant, config, 0, { enabled: true, sigma });
      pState = res.plantState;
      cState = res.controllerState;
      uHistory.push(res.controlEffort);
    }
    // Calculate peak-to-peak u in steady state: p2p = max - min over short sliding windows or overall
    const minEff = Math.min(...uHistory);
    const maxEff = Math.max(...uHistory);
    const p2p = maxEff - minEff;
    console.log(`B6(d) Noise sigma=${sigma}: u range [${minEff.toFixed(2)}, ${maxEff.toFixed(2)}] N, peak-to-peak = ${p2p.toFixed(3)} N (Target: < 2 N)`);
  }

  // -------------------------------------------------------------------------
  // B6(e): True mass = 1.3 kg while gains tuned for 1.0 kg:
  // System remains stable and e_ss -> 0
  // -------------------------------------------------------------------------
  {
    const mismatchedPlant: PlantParameters = { ...plant, mass: 1.3 };
    const sim = runMicroSimulation(mismatchedPlant, gains, 1.0, 30.0, PHYSICS_DT);
    const finalPoint = sim.data[sim.data.length - 1];
    const ess = 1.0 - finalPoint.processVariable;
    console.log(`B6(e) Mass mismatch (1.3 kg): isStable = ${sim.metrics.isStable}, sustainedOsc = ${sim.metrics.sustainedOscillation}, final z = ${finalPoint.processVariable.toFixed(4)} m, e_ss = ${ess.toExponential(3)}, u_ss = ${finalPoint.controlEffort.toFixed(2)} N (Expected: 1.3 * 9.81 = ${(1.3 * 9.81).toFixed(2)} N)`);
  }
}

// Test with candidate a = 0.03
testB6(synthesizePolePlacement(1.0, 0.5, 1.2, 0.9, 0.03), 'a = 0.03');

// Test with candidate a = 0.08
testB6(synthesizePolePlacement(1.0, 0.5, 1.2, 0.9, 0.08), 'a = 0.08');

// Test with candidate a = 0.50
testB6(synthesizePolePlacement(1.0, 0.5, 1.2, 0.9, 0.50), 'a = 0.50');
