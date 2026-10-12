import { chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import { computeRobotCamera } from '../components/SimulationCanvas';
import { ROBOTS } from '../types/robots';

const CHROMIUM_PATH = 'C:\\Users\\dhia\\AppData\\Local\\ms-playwright\\chromium-1243\\chrome-win64\\chrome.exe';
const ARTIFACT_DIR = 'C:\\Users\\dhia\\.gemini\\antigravity-ide\\brain\\e7ece4e3-17be-4bfe-8aae-849a41866eb4\\archetypes';

if (!fs.existsSync(ARTIFACT_DIR)) {
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
}

interface PureTestRow {
  archetype: string;
  canvasSize: string;
  resetPos: string;
  resetDiff: string;
  panLeftPos: string;
  panLeftMargin: number;
  panRightPos: string;
  panRightMargin: number;
  panTopPos: string;
  panTopMargin: number;
  panBottomPos: string;
  panBottomMargin: number;
  allClamped48: boolean;
}

async function runPureCameraTests() {
  const viewports = [
    { w: 1046, h: 768 },
    { w: 704, h: 768 },
    { w: 390, h: 420 },
  ];

  const tableData: PureTestRow[] = [];

  for (const robot of ROBOTS) {
    for (const vp of viewports) {
      const { w, h } = vp;

      // 1. Reset View
      const camReset = { follow: true, offset: { x: 0, y: 0 }, smoothedPV: 0 };
      const resReset = computeRobotCamera(w, h, 0, 1.0, camReset, 48);
      const diffX = Math.abs(resReset.robotScreenX - w / 2);
      const diffY = Math.abs(resReset.robotScreenY - h / 2);
      const resetDiff = `dx=${diffX.toFixed(1)}, dy=${diffY.toFixed(1)} (<=2px: ${diffX <= 2 && diffY <= 2 ? 'PASS' : 'FAIL'})`;

      // 2. Pan Extreme Left
      const camLeft = { follow: false, offset: { x: -9999, y: 0 }, smoothedPV: 0 };
      const resLeft = computeRobotCamera(w, h, 0, 1.0, camLeft, 48);
      const leftMargin = resLeft.robotScreenX; // distance from x=0

      // 3. Pan Extreme Right
      const camRight = { follow: false, offset: { x: 9999, y: 0 }, smoothedPV: 0 };
      const resRight = computeRobotCamera(w, h, 0, 1.0, camRight, 48);
      const rightMargin = w - resRight.robotScreenX; // distance from right edge

      // 4. Pan Extreme Top
      const camTop = { follow: false, offset: { x: 0, y: -9999 }, smoothedPV: 0 };
      const resTop = computeRobotCamera(w, h, 0, 1.0, camTop, 48);
      const topMargin = resTop.robotScreenY; // distance from top edge

      // 5. Pan Extreme Bottom
      const camBottom = { follow: false, offset: { x: 0, y: 9999 }, smoothedPV: 0 };
      const resBottom = computeRobotCamera(w, h, 0, 1.0, camBottom, 48);
      const bottomMargin = h - resBottom.robotScreenY; // distance from bottom edge

      const allClamped48 =
        leftMargin >= 47.9 &&
        rightMargin >= 47.9 &&
        topMargin >= 47.9 &&
        bottomMargin >= 47.9;

      tableData.push({
        archetype: robot.name,
        canvasSize: `${w}x${h}`,
        resetPos: `(${resReset.robotScreenX.toFixed(0)}, ${resReset.robotScreenY.toFixed(0)})`,
        resetDiff,
        panLeftPos: `x=${resLeft.robotScreenX.toFixed(0)}`,
        panLeftMargin: Math.round(leftMargin),
        panRightPos: `x=${resRight.robotScreenX.toFixed(0)}`,
        panRightMargin: Math.round(rightMargin),
        panTopPos: `y=${resTop.robotScreenY.toFixed(0)}`,
        panTopMargin: Math.round(topMargin),
        panBottomPos: `y=${resBottom.robotScreenY.toFixed(0)}`,
        panBottomMargin: Math.round(bottomMargin),
        allClamped48,
      });
    }
  }

  console.log('=== HASIL UJI PURE FUNCTION KAMERA (11 ARCHETYPE x 3 VIEWPORT) ===');
  console.table(tableData.map(r => ({
    Archetype: r.archetype,
    Size: r.canvasSize,
    Reset: r.resetPos,
    Diff: r.resetDiff,
    'L-Margin': `${r.panLeftMargin}px`,
    'R-Margin': `${r.panRightMargin}px`,
    'T-Margin': `${r.panTopMargin}px`,
    'B-Margin': `${r.panBottomMargin}px`,
    Clamped48: r.allClamped48 ? 'PASS' : 'FAIL',
  })));

  // Browser Screenshots for each archetype (initial and panned, dark and light)
  console.log('\n--- MENGAMBIL SCREENSHOT SETIAP ARCHETYPE DI BROWSER ---');
  const browser = await chromium.launch({
    executablePath: CHROMIUM_PATH,
    headless: true,
  });

  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });

  for (const robot of ROBOTS) {
    // Select archetype via dropdown
    await page.evaluate((robotId) => {
      const select = document.querySelector('select') as HTMLSelectElement;
      if (select) {
        select.value = robotId;
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }, robot.id);
    await page.waitForTimeout(300);

    // Initial state screenshot (dark)
    const initialPathDark = path.join(ARTIFACT_DIR, `${robot.id}_initial_dark.png`);
    await page.screenshot({ path: initialPathDark });

    // Pan viewport via mouse drag on 2D physics canvas
    const canvas = await page.$('canvas:nth-of-type(2)') || await page.$('canvas');
    if (canvas) {
      const box = await canvas.boundingBox();
      if (box) {
        // Switch interaction mode to camera pan
        await page.evaluate(() => {
          const panBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Pan Kamera'));
          if (panBtn) panBtn.click();
        });
        await page.waitForTimeout(100);

        // Drag 150px
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width / 2 + 150, box.y + box.height / 2 + 80, { steps: 5 });
        await page.mouse.up();
        await page.waitForTimeout(300);
      }
    }

    // Panned state screenshot (dark)
    const pannedPathDark = path.join(ARTIFACT_DIR, `${robot.id}_panned_dark.png`);
    await page.screenshot({ path: pannedPathDark });

    // Switch to Light mode
    await page.evaluate(() => {
      document.documentElement.classList.add('light');
      document.documentElement.setAttribute('data-theme', 'light');
    });
    await page.waitForTimeout(300);

    // Panned state screenshot (light)
    const pannedPathLight = path.join(ARTIFACT_DIR, `${robot.id}_panned_light.png`);
    await page.screenshot({ path: pannedPathLight });

    // Reset view
    await page.evaluate(() => {
      const resetBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Reset View'));
      if (resetBtn) resetBtn.click();
    });
    await page.waitForTimeout(200);

    // Initial state screenshot (light)
    const initialPathLight = path.join(ARTIFACT_DIR, `${robot.id}_initial_light.png`);
    await page.screenshot({ path: initialPathLight });

    // Reset back to Dark mode
    await page.evaluate(() => {
      document.documentElement.classList.remove('light');
      document.documentElement.setAttribute('data-theme', 'dark');
    });
    await page.waitForTimeout(200);

    console.log(`✓ Selesai ${robot.name}: initial & panned (dark & light) tersimpan di brain/archetypes/`);
  }

  await browser.close();
  console.log('\n=== SEMUA SCREENSHOT ARCHETYPE SELESAI ===');
}

runPureCameraTests().catch((err) => {
  console.error('Error pure camera test:', err);
  process.exit(1);
});
