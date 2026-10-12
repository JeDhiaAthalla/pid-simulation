import { chromium } from 'playwright';

const CHROMIUM_PATH = 'C:\\Users\\dhia\\AppData\\Local\\ms-playwright\\chromium-1243\\chrome-win64\\chrome.exe';

interface ObscuredElement {
  tag: string;
  textOrLabel: string;
  expectedSelector: string;
  actualTag: string;
  actualSelector: string;
}

interface TestRunResult {
  theme: 'dark' | 'light';
  sidebarWidth: number;
  actualSidebarWidth: number;
  tab: string;
  leftPaddingPx: number;
  paddingValid: boolean;
  tabLabelsVisible: boolean;
  labelsRulePassed: boolean;
  toolbarOverlapCount: number;
  maxOverlapArea: number;
  totalInteractiveElements: number;
  obscuredElementsCount: number;
  obscuredList: ObscuredElement[];
}

async function runH2Test() {
  const browser = await chromium.launch({
    executablePath: CHROMIUM_PATH,
    headless: true,
  });

  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });

  const results: TestRunResult[] = [];
  const themes: ('dark' | 'light')[] = ['dark', 'light'];
  const sidebarWidths = [320, 385, 560];
  const tabs = ['control', 'metrics', 'tuning', 'signal'];

  for (const theme of themes) {
    // Set theme
    await page.evaluate((th) => {
      if (th === 'light') {
        document.documentElement.classList.add('light');
        document.documentElement.setAttribute('data-theme', 'light');
      } else {
        document.documentElement.classList.remove('light');
        document.documentElement.setAttribute('data-theme', 'dark');
      }
    }, theme);
    await page.waitForTimeout(300);

    for (const targetWidth of sidebarWidths) {
      // Drag resize handle to set sidebar width accurately
      const handle = await page.$('[role="separator"][aria-label="Ubah Lebar Sidebar"]');
      if (handle) {
        const box = await handle.boundingBox();
        if (box) {
          await page.mouse.move(box.x + box.width / 2, box.y + 150);
          await page.mouse.down();
          await page.mouse.move(targetWidth, box.y + 150, { steps: 8 });
          await page.mouse.up();
          await page.waitForTimeout(150);
        }
      }

      for (const tab of tabs) {
        // Click tab
        await page.click(`button[data-tab-id="${tab}"]`);
        await page.waitForTimeout(150);

        const runData = await page.evaluate(({ tabId, expectedWidth }) => {
          // 0. Actual sidebar width
          const aside = document.querySelector('aside[data-sidebar-panel="true"]') as HTMLElement;
          const actualSidebarWidth = aside ? Math.round(aside.getBoundingClientRect().width) : expectedWidth;

          // 1. Content Left Padding
          const panel = document.querySelector(`[data-tab-content="${tabId}"]`) as HTMLElement;
          let leftPadding = 0;
          if (panel) {
            const cs = window.getComputedStyle(panel);
            leftPadding = parseFloat(cs.paddingLeft) || 0;
          }

          // 2. Tab Labels Visibility Check
          // Rule: >= 360 -> labels visible, < 360 -> labels hidden/icon only
          const tabLabels = Array.from(document.querySelectorAll('[data-sidebar-tab-label]')) as HTMLElement[];
          const anyLabelVisible = tabLabels.some(l => {
            const rect = l.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0 && window.getComputedStyle(l).display !== 'none';
          });
          const expectedVisible = actualSidebarWidth >= 360;
          const labelsRulePassed = anyLabelVisible === expectedVisible;

          // 3. Canvas Toolbar Overlap Check
          const toolbarBtns = Array.from(document.querySelectorAll('[data-canvas-toolbar] button')) as HTMLElement[];
          let overlapCount = 0;
          let maxOverlap = 0;
          for (let i = 0; i < toolbarBtns.length; i++) {
            const r1 = toolbarBtns[i].getBoundingClientRect();
            for (let j = i + 1; j < toolbarBtns.length; j++) {
              const r2 = toolbarBtns[j].getBoundingClientRect();
              const interLeft = Math.max(r1.left, r2.left);
              const interRight = Math.min(r1.right, r2.right);
              const interTop = Math.max(r1.top, r2.top);
              const interBottom = Math.min(r1.bottom, r2.bottom);

              if (interRight > interLeft && interBottom > interTop) {
                const area = (interRight - interLeft) * (interBottom - interTop);
                if (area > 0.5) {
                  overlapCount++;
                  if (area > maxOverlap) maxOverlap = area;
                }
              }
            }
          }

          // 4. Hit-Test elementFromPoint for ALL interactive elements
          const interactive = Array.from(document.querySelectorAll(
            'button, input, [role="tab"], [role="slider"]'
          )) as HTMLElement[];

          const obscured: any[] = [];
          for (const el of interactive) {
            // Skip hidden elements (e.g. inside closed drawers or display:none)
            const rect = el.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0 || rect.bottom < 0 || rect.top > window.innerHeight) continue;
            if (window.getComputedStyle(el).display === 'none' || window.getComputedStyle(el).visibility === 'hidden') continue;

            const cx = rect.left + rect.width / 2;
            const cy = rect.top + rect.height / 2;
            if (cx < 0 || cx > window.innerWidth || cy < 0 || cy > window.innerHeight) continue;

            const topEl = document.elementFromPoint(cx, cy);
            // Element is obscured ONLY if topEl is not the element itself AND topEl is not a child inside the element
            if (topEl && topEl !== el && !el.contains(topEl)) {
              obscured.push({
                tag: el.tagName.toLowerCase(),
                textOrLabel: (el.getAttribute('aria-label') || el.innerText || el.getAttribute('title') || '').slice(0, 30).trim(),
                expectedSelector: el.className ? `${el.tagName.toLowerCase()}.${el.className.split(' ')[0]}` : el.tagName.toLowerCase(),
                actualTag: topEl.tagName.toLowerCase(),
                actualSelector: topEl.className ? `${topEl.tagName.toLowerCase()}.${topEl.className.split(' ')[0]}` : topEl.tagName.toLowerCase(),
              });
            }
          }

          return {
            actualSidebarWidth,
            leftPaddingPx: Math.round(leftPadding),
            paddingValid: leftPadding >= 12,
            tabLabelsVisible: anyLabelVisible,
            labelsRulePassed,
            toolbarOverlapCount: overlapCount,
            maxOverlapArea: Math.round(maxOverlap),
            totalInteractiveElements: interactive.length,
            obscuredElementsCount: obscured.length,
            obscuredList: obscured,
          };
        }, { tabId: tab, expectedWidth: targetWidth });

        results.push({
          theme,
          sidebarWidth: targetWidth,
          tab,
          ...runData,
        });
      }
    }
  }

  await browser.close();
  console.log('=== RAW JSON RESULT TRACK H2 ===');
  console.log(JSON.stringify(results, null, 2));
}

runH2Test().catch((err) => {
  console.error('Test H2 error:', err);
  process.exit(1);
});
