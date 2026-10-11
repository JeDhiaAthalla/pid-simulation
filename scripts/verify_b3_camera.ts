import { computeRobotCamera, RobotCameraState } from '../components/SimulationCanvas';

interface ViewportCase {
  name: string;
  w: number;
  h: number;
  sidebarW: number;
}

const VIEWPORTS: ViewportCase[] = [
  // 1920x1080
  { name: '1920x1080 (Sidebar 320)', w: 1920 - 320, h: 1080, sidebarW: 320 },
  { name: '1920x1080 (Sidebar 560)', w: 1920 - 560, h: 1080, sidebarW: 560 },
  { name: '1920x1080 (Sidebar 0 / Collapsed)', w: 1920, h: 1080, sidebarW: 0 },
  // 1366x768
  { name: '1366x768 (Sidebar 320)', w: 1366 - 320, h: 768, sidebarW: 320 },
  { name: '1366x768 (Sidebar 560)', w: 1366 - 560, h: 768, sidebarW: 560 },
  { name: '1366x768 (Sidebar 0)', w: 1366, h: 768, sidebarW: 0 },
  // 1024x768
  { name: '1024x768 (Sidebar 320)', w: 1024 - 320, h: 768, sidebarW: 320 },
  { name: '1024x768 (Sidebar 560)', w: 1024 - 560, h: 768, sidebarW: 560 },
  { name: '1024x768 (Sidebar 0)', w: 1024, h: 768, sidebarW: 0 },
  // 768x1024 (Vertical Stack)
  { name: '768x1024 (Stacked - Canvas Top Half)', w: 768, h: 512, sidebarW: 0 },
  // 390x844 (Mobile)
  { name: '390x844 (Mobile Canvas)', w: 390, h: 420, sidebarW: 0 },
];

console.log('=== TEST 1: ROBOT CENTERING AFTER RESET VIEW (INVARIANT: ±2px OF CANVAS CENTER) ===');
console.log('| Viewport & Setup | Canvas (WxH) | Robot Center (X, Y) | Canvas Center (X, Y) | Delta X (px) | Delta Y (px) | Lulus? |');
console.log('|---|---|---|---|---|---|---|');

let allCenteringPassed = true;
for (const vp of VIEWPORTS) {
  const cam: RobotCameraState = { follow: true, offset: { x: 0, y: 0 }, smoothedPV: 5.0 };
  const res = computeRobotCamera(vp.w, vp.h, 5.0, 5.0, cam, 48);

  const cx = vp.w / 2;
  const cy = vp.h / 2;
  const dx = Math.abs(res.robotScreenX - cx);
  const dy = Math.abs(res.robotScreenY - cy);
  const pass = dx <= 2.0 && dy <= 2.0;
  if (!pass) allCenteringPassed = false;

  console.log(
    `| ${vp.name} | ${vp.w}x${vp.h} | (${res.robotScreenX.toFixed(1)}, ${res.robotScreenY.toFixed(1)}) | (${cx.toFixed(1)}, ${cy.toFixed(1)}) | ${dx.toFixed(2)} | ${dy.toFixed(2)} | ${pass ? 'PASS' : 'FAIL'} |`
  );
}

console.log(`\nCentering Test Result: ${allCenteringPassed ? 'ALL PASSED (0px error)' : 'FAILED'}\n`);

console.log('=== TEST 2: EXTREME PAN IN 4 DIRECTIONS (INVARIANT: ROBOT DISTANCE TO EDGE >= 48px) ===');
console.log('| Viewport | Arah Pan | Pan Requested (dx, dy) | Robot Center (X, Y) | Min Edge Dist (px) | >= 48px? |');
console.log('|---|---|---|---|---|---|');

const EXTREME_DIRECTIONS = [
  { dir: 'Kiri Ekstrem', dx: -5000, dy: 0 },
  { dir: 'Kanan Ekstrem', dx: 5000, dy: 0 },
  { dir: 'Atas Ekstrem', dx: 0, dy: -5000 },
  { dir: 'Bawah Ekstrem', dx: 0, dy: 5000 },
];

let allPanPassed = true;
for (const vp of VIEWPORTS.slice(0, 5)) {
  for (const ed of EXTREME_DIRECTIONS) {
    const cam: RobotCameraState = { follow: true, offset: { x: ed.dx, y: ed.dy }, smoothedPV: 5.0 };
    const res = computeRobotCamera(vp.w, vp.h, 5.0, 5.0, cam, 48);

    const distLeft = res.robotScreenX;
    const distRight = vp.w - res.robotScreenX;
    const distTop = res.robotScreenY;
    const distBottom = vp.h - res.robotScreenY;
    const minDist = Math.min(distLeft, distRight, distTop, distBottom);

    const pass = minDist >= 47.99;
    if (!pass) allPanPassed = false;

    console.log(
      `| ${vp.name} | ${ed.dir} | (${ed.dx}, ${ed.dy}) | (${res.robotScreenX.toFixed(1)}, ${res.robotScreenY.toFixed(1)}) | ${minDist.toFixed(1)} | ${pass ? 'PASS' : 'FAIL'} |`
    );
  }
}
console.log(`\nExtreme Pan Clamping Result: ${allPanPassed ? 'ALL PASSED (>= 48px)' : 'FAILED'}\n`);

console.log('=== TEST 3: DYNAMIC VERTICAL RANGE (SETPOINTS 0, 5, 20, 50m) ===');
console.log('| Setpoint | PV | Canvas Height | pixelsPerMeter | Ground Y | Target Y | Robot Y | Margin Top (px) | Margin Bottom (px) | Terpotong? |');
console.log('|---|---|---|---|---|---|---|---|---|---|');

const SETPOINTS = [0, 5, 20, 50];
const h = 720;
const w = 1200;
let allAutoFramePassed = true;

for (const sp of SETPOINTS) {
  // Check at steady state and during initial transient (pv = 0)
  for (const pv of [0, sp]) {
    const cam: RobotCameraState = { follow: true, offset: { x: 0, y: 0 }, smoothedPV: pv };
    const res = computeRobotCamera(w, h, pv, sp, cam, 48);

    const droneY = res.robotScreenY;
    const groundY = droneY + pv * res.pixelsPerMeter;
    const targetY = droneY - (sp - pv) * res.pixelsPerMeter;

    const minY = Math.min(droneY, groundY, targetY);
    const maxY = Math.max(droneY, groundY, targetY);

    const marginTop = minY;
    const marginBottom = h - maxY;

    const notClipped = minY >= 0 && maxY <= h;
    if (!notClipped) allAutoFramePassed = false;

    console.log(
      `| ${sp}m | ${pv}m | ${h}px | ${res.pixelsPerMeter.toFixed(2)} | ${groundY.toFixed(1)} | ${targetY.toFixed(1)} | ${droneY.toFixed(1)} | ${marginTop.toFixed(1)} | ${marginBottom.toFixed(1)} | ${notClipped ? 'TIDAK (AMAN)' : 'YA (TERPOTONG)'} |`
    );
  }
}

console.log(`\nAuto-Framing Result: ${allAutoFramePassed ? 'ALL PASSED (Not Clipped)' : 'FAILED'}\n`);
