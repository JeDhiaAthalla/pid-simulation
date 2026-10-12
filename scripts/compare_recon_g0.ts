import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

function searchDir(dir: string, fileList: string[] = []): string[] {
  if (!fs.existsSync(dir)) return fileList;
  const files = fs.readdirSync(dir);
  for (const f of files) {
    const full = path.join(dir, f);
    if (fs.statSync(full).isDirectory()) {
      searchDir(full, fileList);
    } else if (f.endsWith('.tsx') || f.endsWith('.ts') || f.endsWith('.css')) {
      fileList.push(full);
    }
  }
  return fileList;
}

const files = searchDir('components').concat(['app/globals.css', 'app/page.tsx']);
const patterns: Record<string, RegExp> = {
  'text-white': /text-white(?:\/\d+)?/g,
  'bg-black': /bg-black(?:\/\d+)?/g,
  'slate/gray/zinc': /(?:text|bg|border)-(?:slate|gray|zinc)-(?:\d+)(?:\/\d+)?/g,
  'border-white': /border-white(?:\/\d+)?/g,
  'rgba': /rgba\([^)]+\)/g,
  '#hex': /#[0-9a-fA-F]{3,8}\b/g,
  'hsl': /hsla?\([^)]+\)/g,
};

function countColors(content: string): number {
  let total = 0;
  for (const [k, p] of Object.entries(patterns)) {
    const matches = content.match(p);
    total += matches ? matches.length : 0;
  }
  return total;
}

console.log('| File | Total SEBELUM (HEAD) | Total SESUDAH (Current) | Selisih | Alasan Sisa Dipertahankan |');
console.log('|---|---|---|---|---|');

let grandBefore = 0;
let grandAfter = 0;

for (const file of files) {
  const rel = file.replace(/\\/g, '/');
  let contentBefore = '';
  try {
    contentBefore = execSync(`git show HEAD:"${rel}"`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
  } catch (e) {
    contentBefore = '';
  }
  
  const contentAfter = fs.readFileSync(file, 'utf8');
  
  const totalBefore = contentBefore ? countColors(contentBefore) : 0;
  const totalAfter = countColors(contentAfter);
  
  if (totalBefore > 0 || totalAfter > 0) {
    grandBefore += totalBefore;
    grandAfter += totalAfter;
    let reason = '-';
    if (rel.includes('SimulationCanvas.tsx')) {
      reason = 'Canvas 2D rendering: warna render robot (rotor, link, chassis), trail grid, dan fallback context.';
    } else if (rel.includes('OscilloscopeCanvas.tsx') || rel.includes('RobotAnimationCanvas.tsx')) {
      reason = 'Komponen legacy (unmounted/dead code), dipertahankan untuk referensi tanpa diubah.';
    } else if (rel.includes('globals.css')) {
      reason = 'Definisi variabel CSS root (--bg, --surface, --text, slider thumb styles, canvas container gradient).';
    } else if (rel.includes('TuningTab.tsx') || rel.includes('MetricsTab.tsx') || rel.includes('GainControl.tsx')) {
      reason = 'Gradient bar step response & inline sparkline SVG stroke/fill.';
    } else if (rel.includes('CodeExportDrawer.tsx')) {
      reason = 'Backdrop overlay bg-black/60 dan syntax high banner text-white.';
    } else if (rel.includes('page.tsx')) {
      reason = 'Root shell container dark mode classes.';
    }
    console.log(`| ${rel} | ${totalBefore} | ${totalAfter} | ${totalAfter - totalBefore} | ${reason} |`);
  }
}

console.log(`\nGrand Total SEBELUM: ${grandBefore} -> SESUDAH: ${grandAfter} (Pengurangan: ${grandBefore - grandAfter})`);
