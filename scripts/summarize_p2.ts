import * as fs from 'fs';

const data = JSON.parse(fs.readFileSync('scripts/p2_raw_hit_test.json', 'utf8'));

console.log('| Viewport | Sidebar | Tab | Drawer State | Status | Tested Elements | Obscured Count |');
console.log('|---|---|---|---|---|---|---|');

data.forEach((d: any) => {
  if (d.status === 'N/A') {
    console.log(`| ${d.viewport} | ${d.sidebarWidth}px | ${d.tab} | ${d.drawerState} | N/A (Lebar > Layar) | - | - |`);
  } else {
    console.log(`| ${d.viewport} | ${d.sidebarWidth}px | ${d.tab} | ${d.drawerState} | VALID | ${d.totalTested} | ${d.obscuredCount} |`);
  }
});
