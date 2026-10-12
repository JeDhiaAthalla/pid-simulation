import * as fs from 'fs';
import * as path from 'path';

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

console.log('| File | text-white | bg-black | slate/gray/zinc | border-white | rgba | #hex | hsl | Total |');
console.log('|---|---|---|---|---|---|---|---|---|');

let grandTotal = 0;
for (const file of files) {
  const content = fs.readFileSync(file, 'utf8');
  const row: Record<string, number> = {};
  let total = 0;
  for (const [k, p] of Object.entries(patterns)) {
    const matches = content.match(p);
    const count = matches ? matches.length : 0;
    row[k] = count;
    total += count;
  }
  if (total > 0) {
    grandTotal += total;
    const rel = file.replace(/\\/g, '/');
    console.log(
      `| ${rel} | ${row['text-white']} | ${row['bg-black']} | ${row['slate/gray/zinc']} | ${row['border-white']} | ${row['rgba']} | ${row['#hex']} | ${row['hsl']} | ${total} |`
    );
  }
}
console.log(`\nGrand Total: ${grandTotal} hardcoded color instances.`);
