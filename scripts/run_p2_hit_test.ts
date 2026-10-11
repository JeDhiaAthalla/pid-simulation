import { chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

interface HitTestResult {
  viewport: string;
  tab: string;
  sidebarWidth: number | string;
  drawerState: 'closed' | 'open';
  status: 'VALID' | 'N/A';
  reason?: string;
  totalTested?: number;
  obscuredCount?: number;
  obscuredList?: Array<{
    tag: string;
    text: string;
    obscuringElementSelector: string;
  }>;
}

async function main() {
  console.log('Starting Playwright automated audit for P2 and P5...');
  const browser = await chromium.launch({
    headless: true,
    executablePath: 'C:\\Users\\dhia\\AppData\\Local\\ms-playwright\\chromium-1243\\chrome-win64\\chrome.exe',
  });
  const context = await browser.newContext();
  const page = await context.newPage();

  const VIEWPORTS = [
    { name: '1920x1080', width: 1920, height: 1080, validSidebars: [320, 560] },
    { name: '1366x768', width: 1366, height: 768, validSidebars: [320, 560] },
    { name: '1024x768', width: 1024, height: 768, validSidebars: [320, 560] },
    { name: '768x1024', width: 768, height: 1024, validSidebars: [320, 560] },
    { name: '390x844', width: 390, height: 844, validSidebars: [320] }, // 560 is N/A!
  ];

  const TABS = ['control', 'metrics', 'tuning', 'signal'];
  const allResults: HitTestResult[] = [];

  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });

    const testedSidebars = [320, 560];
    for (const sbW of testedSidebars) {
      const isValid = vp.validSidebars.includes(sbW);

      if (!isValid) {
        for (const tab of TABS) {
          for (const drawerState of ['closed', 'open'] as const) {
            allResults.push({
              viewport: vp.name,
              tab,
              sidebarWidth: sbW,
              drawerState,
              status: 'N/A',
              reason: `Lebar sidebar ${sbW}px melebihi lebar viewport ${vp.width}px`,
            });
          }
        }
        continue;
      }

      // Valid combination: set sidebar width via localStorage and navigate
      await page.addInitScript((width) => {
        window.localStorage.setItem('pid_simulator_sidebar_width', String(width));
      }, sbW);

      await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });
      await page.waitForTimeout(300);

      for (const tab of TABS) {
        // Click tab button
        const tabBtn = page.locator(`button[data-tab="${tab}"]`).first();
        if (await tabBtn.count()) {
          await tabBtn.click().catch(() => {});
          await page.waitForTimeout(150);
        }

        // Test Drawer Closed
        const closedResult = await runElementFromPointTest(page);
        allResults.push({
          viewport: vp.name,
          tab,
          sidebarWidth: sbW,
          drawerState: 'closed',
          status: 'VALID',
          totalTested: closedResult.totalTested,
          obscuredCount: closedResult.obscuredCount,
          obscuredList: closedResult.obscuredList,
        });

        // Test Drawer Open: click export button
        const exportBtn = page.locator('button:has-text("Export"), button[title*="Export"]').first();
        let drawerOpened = false;
        if (await exportBtn.count()) {
          await exportBtn.click().catch(() => {});
          await page.waitForTimeout(200);
          drawerOpened = true;
        }

        const openResult = await runElementFromPointTest(page);
        allResults.push({
          viewport: vp.name,
          tab,
          sidebarWidth: sbW,
          drawerState: 'open',
          status: 'VALID',
          totalTested: openResult.totalTested,
          obscuredCount: openResult.obscuredCount,
          obscuredList: openResult.obscuredList,
        });

        // Close drawer
        if (drawerOpened) {
          await page.keyboard.press('Escape');
          await page.waitForTimeout(150);
        }
      }
    }
  }

  // Save JSON
  const outputPath = path.resolve(__dirname, 'p2_raw_hit_test.json');
  fs.writeFileSync(outputPath, JSON.stringify(allResults, null, 2));
  console.log(`Saved P2 raw JSON results to ${outputPath}`);

  await browser.close();
}

async function runElementFromPointTest(page: any) {
  return await page.evaluate(() => {
    const selectors = 'button, input, [role="tab"], [role="slider"]';
    const all = Array.from(document.querySelectorAll<HTMLElement>(selectors));
    const visible = all.filter((el) => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.visibility !== 'hidden' &&
        style.display !== 'none' &&
        parseFloat(style.opacity || '1') > 0
      );
    });

    const obscuredList: Array<{
      tag: string;
      text: string;
      obscuringElementSelector: string;
    }> = [];

    let totalTested = 0;
    for (const el of visible) {
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;

      // Ensure center point is within viewport
      if (cx < 0 || cy < 0 || cx > window.innerWidth || cy > window.innerHeight) {
        continue;
      }

      totalTested++;
      const topEl = document.elementFromPoint(cx, cy);

      if (!topEl || (!el.contains(topEl) && !topEl.contains(el))) {
        let obscuringSelector = topEl ? topEl.tagName.toLowerCase() : 'null';
        if (topEl) {
          if (topEl.id) obscuringSelector += `#${topEl.id}`;
          else if (topEl.className) {
            const cls = (typeof topEl.className === 'string' ? topEl.className : '')
              .split(' ')
              .filter(Boolean)
              .slice(0, 3)
              .join('.');
            if (cls) obscuringSelector += `.${cls}`;
          }
        }

        const text =
          el.getAttribute('aria-label') ||
          el.getAttribute('title') ||
          (el.innerText ? el.innerText.trim().replace(/\n/g, ' ').slice(0, 35) : '') ||
          el.getAttribute('name') ||
          el.tagName.toLowerCase();

        obscuredList.push({
          tag: el.tagName.toLowerCase(),
          text,
          obscuringElementSelector: obscuringSelector,
        });
      }
    }

    return {
      totalTested,
      obscuredCount: obscuredList.length,
      obscuredList,
    };
  });
}

main().catch(console.error);
