import { chromium } from 'playwright';

const CHROMIUM_PATH = 'C:\\Users\\dhia\\AppData\\Local\\ms-playwright\\chromium-1243\\chrome-win64\\chrome.exe';

interface ContrastResult {
  selector: string;
  text: string;
  fontSize: string;
  fontWeight: string;
  textColor: string;
  bgColor: string;
  contrastRatio: number;
  isLargeText: boolean;
  requiredRatio: number;
  passed: boolean;
}

interface ScopeAudit {
  theme: 'dark' | 'light';
  tab: string;
  totalTested: number;
  failingCount: number;
  violators: ContrastResult[];
}

async function runAuditG5() {
  const browser = await chromium.launch({
    executablePath: CHROMIUM_PATH,
    headless: true,
  });

  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });

  const themes: ('dark' | 'light')[] = ['dark', 'light'];
  const tabs = ['control', 'metrics', 'tuning', 'signal'];
  const report: ScopeAudit[] = [];

  for (const theme of themes) {
    // Ensure app is in target theme by checking document.documentElement
    const isCurrentlyLight = await page.evaluate(() => document.documentElement.classList.contains('light'));
    if ((theme === 'light' && !isCurrentlyLight) || (theme === 'dark' && isCurrentlyLight)) {
      await page.click('button[aria-label*="Tema"]');
      await page.waitForTimeout(400);
    }

    for (const tab of tabs) {
      await page.click(`button[data-tab-id="${tab}"]`);
      await page.waitForTimeout(200);

      const auditData = await page.evaluate(`
        (() => {
          const parseColor = (str) => {
            if (!str || str === 'transparent' || str === 'rgba(0, 0, 0, 0)') {
              return [0, 0, 0, 0];
            }
            const m = str.match(/rgba?\\(\\s*([\\d.]+)\\s*,\\s*([\\d.]+)\\s*,\\s*([\\d.]+)(?:\\s*,\\s*([\\d.]+))?\\s*\\)/);
            if (m) {
              return [
                parseFloat(m[1]),
                parseFloat(m[2]),
                parseFloat(m[3]),
                m[4] !== undefined ? parseFloat(m[4]) : 1.0,
              ];
            }
            return [0, 0, 0, 0];
          };

          const blendColors = (fg, bg) => {
            const a = fg[3] + bg[3] * (1 - fg[3]);
            if (a <= 0) return [0, 0, 0, 0];
            const r = (fg[0] * fg[3] + bg[0] * bg[3] * (1 - fg[3])) / a;
            const g = (fg[1] * fg[3] + bg[1] * bg[3] * (1 - fg[3])) / a;
            const b = (fg[2] * fg[3] + bg[2] * bg[3] * (1 - fg[3])) / a;
            return [r, g, b, a];
          };

          const getLuminance = (r, g, b) => {
            const [rs, gs, bs] = [r, g, b].map((c) => {
              const s = c / 255;
              return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
            });
            return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
          };

          const getContrast = (lum1, lum2) => {
            const l1 = Math.max(lum1, lum2);
            const l2 = Math.min(lum1, lum2);
            return (l1 + 0.05) / (l2 + 0.05);
          };

          const defaultBg = document.documentElement.classList.contains('light')
            ? [246, 248, 251, 1.0]
            : [9, 13, 22, 1.0];

          const getEffectiveBg = (el) => {
            let curr = el;
            let layers = [];
            while (curr && curr !== document.documentElement) {
              const cs = window.getComputedStyle(curr);
              const bg = parseColor(cs.backgroundColor);
              if (bg[3] > 0) {
                layers.unshift(bg);
                if (bg[3] >= 0.99) break;
              }
              curr = curr.parentElement;
            }
            let res = defaultBg;
            for (const layer of layers) {
              res = blendColors(layer, res);
            }
            return res;
          };

          const scopes = [
            'aside[data-sidebar-panel="true"]',
            '[data-canvas-toolbar="true"]',
          ];

          const candidateElements = [];
          for (const scopeSel of scopes) {
            const container = document.querySelector(scopeSel);
            if (!container) continue;

            const allDescendants = Array.from(container.querySelectorAll('*'));
            for (const el of allDescendants) {
              let hasDirectText = false;
              for (let i = 0; i < el.childNodes.length; i++) {
                const node = el.childNodes[i];
                if (node.nodeType === Node.TEXT_NODE && node.nodeValue && node.nodeValue.trim().length > 0) {
                  hasDirectText = true;
                  break;
                }
              }
              if (hasDirectText) candidateElements.push(el);
            }
          }

          const results = [];
          const seen = new Set();

          for (const el of candidateElements) {
            const rect = el.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0 || rect.bottom < 0 || rect.top > window.innerHeight) continue;
            const cs = window.getComputedStyle(el);
            if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) <= 0.05) continue;

            const text = el.innerText ? el.innerText.trim().replace(/\\s+/g, ' ') : '';
            if (!text || text.length === 0) continue;

            const key = el.tagName + ':' + text.slice(0, 30) + ':' + Math.round(rect.top) + ':' + Math.round(rect.left);
            if (seen.has(key)) continue;
            seen.add(key);

            const textColorRaw = parseColor(cs.color);
            let ancestorOpacity = 1.0;
            let c = el;
            while (c) {
              ancestorOpacity *= parseFloat(window.getComputedStyle(c).opacity) || 1.0;
              c = c.parentElement;
            }

            const effectiveFg = [
              textColorRaw[0],
              textColorRaw[1],
              textColorRaw[2],
              textColorRaw[3] * ancestorOpacity,
            ];

            const effectiveBg = getEffectiveBg(el);
            const finalFg = blendColors(effectiveFg, effectiveBg);

            const fgLum = getLuminance(finalFg[0], finalFg[1], finalFg[2]);
            const bgLum = getLuminance(effectiveBg[0], effectiveBg[1], effectiveBg[2]);
            const ratio = getContrast(fgLum, bgLum);

            const fontSizePx = parseFloat(cs.fontSize) || 12;
            const fontWeightNum = parseInt(cs.fontWeight) || 400;
            const isLargeText = fontSizePx >= 24 || (fontSizePx >= 18.5 && fontWeightNum >= 600);
            const requiredRatio = isLargeText ? 3.0 : 4.5;
            const passed = ratio >= requiredRatio - 0.05;

            const classPrefix = el.className && typeof el.className === 'string'
              ? '.' + el.className.split(' ')[0]
              : '';
            const selector = el.tagName.toLowerCase() + (el.id ? '#' + el.id : classPrefix);

            results.push({
              selector,
              text: text.slice(0, 35),
              fontSize: fontSizePx.toFixed(1) + 'px',
              fontWeight: cs.fontWeight,
              textColor: 'rgb(' + Math.round(finalFg[0]) + ', ' + Math.round(finalFg[1]) + ', ' + Math.round(finalFg[2]) + ')',
              bgColor: 'rgb(' + Math.round(effectiveBg[0]) + ', ' + Math.round(effectiveBg[1]) + ', ' + Math.round(effectiveBg[2]) + ')',
              contrastRatio: parseFloat(ratio.toFixed(2)),
              isLargeText,
              requiredRatio,
              passed,
            });
          }

          const violators = results.filter((r) => !r.passed);
          return {
            totalTested: results.length,
            failingCount: violators.length,
            violators,
          };
        })()
      `) as any;

      report.push({
        theme,
        tab,
        ...auditData,
      });
    }
  }

  await browser.close();

  console.log('=== LAPORAN AUDIT KONTRAS WCAG OTOMATIS (TRACK G5) ===');
  console.log(JSON.stringify(report, null, 2));

  let totalAll = 0;
  let totalFail = 0;
  for (const r of report) {
    totalAll += r.totalTested;
    totalFail += r.failingCount;
  }
  console.log(`\nRINGKASAN: Total teks diuji = ${totalAll}, Total pelanggaran (< 4.5:1 / 3:1) = ${totalFail}`);
}

runAuditG5().catch((err) => {
  console.error('Audit G5 error:', err);
  process.exit(1);
});
