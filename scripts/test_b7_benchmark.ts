import { TelemetryRingBuffer } from '../lib/physicsEngine';
import { DataPoint } from '../types/simulation';

export function runB7Benchmark() {
  console.log('=== B7: TELEMETRY RING BUFFER HOOK AUDIT & BENCHMARK ===');

  const CAPACITY = 2000;
  const FRAMES = 1200; // 1200 UI frames (~20 seconds of 60 FPS animation)
  const SUBSTEPS_PER_FRAME = 4; // 200 Hz physics / 50 Hz UI = 4 substeps per frame

  const dummyDP = (t: number): DataPoint => ({
    time: t,
    setpoint: 1.0,
    processVariable: 0.98,
    controlEffort: 9.81,
    error: 0.02,
    pTerm: 0.05,
    iTerm: 0.01,
    dTerm: 0.001,
  });

  // -------------------------------------------------------------------------
  // 1. SEBELUM: Standard JS Array with shift() per substep when capacity exceeded
  // -------------------------------------------------------------------------
  const oldArray: DataPoint[] = [];
  const startOld = performance.now();
  for (let f = 0; f < FRAMES; f++) {
    for (let s = 0; s < SUBSTEPS_PER_FRAME; s++) {
      const t = (f * SUBSTEPS_PER_FRAME + s) * 0.005;
      oldArray.push(dummyDP(t));
      if (oldArray.length > CAPACITY) {
        oldArray.shift(); // O(N) array copy on every overflow
      }
    }
    // Snapshot for React state
    const _snapshot = [...oldArray];
  }
  const endOld = performance.now();
  const totalOldMs = endOld - startOld;
  const msPerFrameOld = totalOldMs / FRAMES;

  // -------------------------------------------------------------------------
  // 2. SESUDAH: TelemetryRingBuffer with O(1) push and single toArray() per frame
  // -------------------------------------------------------------------------
  const ringBuffer = new TelemetryRingBuffer(CAPACITY);
  let toArrayCallCount = 0;
  const startNew = performance.now();
  for (let f = 0; f < FRAMES; f++) {
    for (let s = 0; s < SUBSTEPS_PER_FRAME; s++) {
      const t = (f * SUBSTEPS_PER_FRAME + s) * 0.005;
      ringBuffer.push(dummyDP(t)); // O(1) in-place cyclic index write
    }
    // Single toArray() call per UI frame
    const _snapshot = ringBuffer.toArray();
    toArrayCallCount++;
  }
  const endNew = performance.now();
  const totalNewMs = endNew - startNew;
  const msPerFrameNew = totalNewMs / FRAMES;

  console.log(`Verification:`);
  console.log(`  Total UI Frames simulated:     ${FRAMES}`);
  console.log(`  Total Physics Substeps:        ${FRAMES * SUBSTEPS_PER_FRAME}`);
  console.log(`  toArray() Total Invocations:   ${toArrayCallCount} (Exactly 1 per UI frame, NOT per substep)`);
  console.log(`\nPerformance Comparison:`);
  console.log(`  SEBELUM (Array.shift() per sub-step):  ${msPerFrameOld.toFixed(4)} ms/frame (Total: ${totalOldMs.toFixed(2)} ms)`);
  console.log(`  SESUDAH (RingBuffer + 1 toArray/frame): ${msPerFrameNew.toFixed(4)} ms/frame (Total: ${totalNewMs.toFixed(2)} ms)`);
  console.log(`  Speedup factor:                         ${(msPerFrameOld / msPerFrameNew).toFixed(2)}x faster`);

  // -------------------------------------------------------------------------
  // 3. Lifecycle continuity: Pause / Resume / Reset
  // -------------------------------------------------------------------------
  console.log(`\nLifecycle Continuity Check:`);
  const testBuf = new TelemetryRingBuffer(CAPACITY);
  // Phase A: Stream 100 points
  for (let i = 0; i < 100; i++) testBuf.push(dummyDP(i * 0.01));
  const tPause = testBuf.toArray()[testBuf.length - 1].time;

  // Phase B: Pause (simulating idle period, no push)
  // Phase C: Resume and push next 50 points starting at t = 1.01s
  for (let i = 100; i < 150; i++) testBuf.push(dummyDP(i * 0.01));
  const snapAfterResume = testBuf.toArray();
  const isStrictlyMonotonic = snapAfterResume.every((dp, idx) => idx === 0 || dp.time > snapAfterResume[idx - 1].time);

  // Phase D: Reset
  testBuf.clear();
  const isCleared = testBuf.length === 0 && testBuf.toArray().length === 0;

  console.log(`  Time at pause:                 ${tPause.toFixed(2)}s`);
  console.log(`  Sample count after resume:     ${snapAfterResume.length} points`);
  console.log(`  Chronologically monotonic:     ${isStrictlyMonotonic}`);
  console.log(`  Buffer cleared on reset:       ${isCleared}`);
  console.log(`  Lifecycle test status:         ${isStrictlyMonotonic && isCleared ? 'PASS' : 'FAIL'}`);
}

runB7Benchmark();
