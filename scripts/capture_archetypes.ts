import { chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import { ROBOTS } from '../types/robots';

async function main() {
  console.log('Capturing screenshots for all 11 archetypes...');
  const outDir = path.resolve(
    'C:/Users/dhia/.gemini/antigravity-ide/brain/e7ece4e3-17be-4bfe-8aae-849a41866eb4/archetypes'
  );
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch({
    headless: true,
    executablePath: 'C:\\Users\\dhia\\AppData\\Local\\ms-playwright\\chromium-1243\\chrome-win64\\chrome.exe',
  });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);

  for (const robot of ROBOTS) {
    console.log(`Processing archetype: ${robot.id} (${robot.name})...`);

    // Click robot dropdown selector in header
    const selectorBtn = page.locator('button:has-text("Pilih"), button:has-text("Robot"), button[title*="Pilih"]').first();
    // Alternatively click the robot selector button in SidebarHeader
    const headerRobotBtn = page.locator('div.border-b button:has(span)').filter({ hasText: /drone|robot|vehicle|pendulum|crane|arm|manipulator|mass/i }).first();
    
    // Select robot via client script if dropdown is custom
    await page.evaluate((robotId) => {
      // Find robot item in dropdown or dispatch selection
      const allButtons = Array.from(document.querySelectorAll('button'));
      const trigger = allButtons.find(b => b.innerText && (b.innerText.includes('Quadcopter') || b.innerText.includes('Robot') || b.innerText.includes('Line Follower') || b.innerText.includes('Ackermann')));
      if (trigger) trigger.click();
    }, robot.id);
    await page.waitForTimeout(200);

    const robotOption = page.locator(`button:has-text("${robot.name}"), div:has-text("${robot.name}")`).last();
    if (await robotOption.count()) {
      await robotOption.click().catch(() => {});
      await page.waitForTimeout(300);
    } else {
      // Fallback: click directly or trigger selector
      await page.evaluate((rId) => {
        const item = Array.from(document.querySelectorAll('button, div')).find(el => el.textContent?.includes(rId));
        if (item) (item as HTMLElement).click();
      }, robot.id);
    }

    // Reset view to make sure offset is 0
    await page.keyboard.press('c');
    await page.waitForTimeout(200);

    // Screenshot initial state
    const initialPath = path.join(outDir, `${robot.id}_initial.png`);
    await page.screenshot({ path: initialPath });

    // Pan canvas: drag right click on canvas
    const canvas = page.locator('canvas').last();
    const box = await canvas.boundingBox();
    if (box) {
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;
      await page.mouse.move(cx, cy);
      await page.mouse.down({ button: 'right' });
      await page.mouse.move(cx + 120, cy + 90, { steps: 5 });
      await page.mouse.up({ button: 'right' });
      await page.waitForTimeout(200);
    }

    // Screenshot after pan
    const pannedPath = path.join(outDir, `${robot.id}_panned.png`);
    await page.screenshot({ path: pannedPath });
  }

  await browser.close();
  console.log('All archetype screenshots saved successfully!');
}

main().catch(console.error);
