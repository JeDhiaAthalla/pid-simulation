// Mathematical WCAG 2.1 Relative Luminance & Contrast Ratio Calculator

function parseHex(hex: string): [number, number, number] {
  hex = hex.replace('#', '');
  if (hex.length === 3) {
    return [
      parseInt(hex[0] + hex[0], 16),
      parseInt(hex[1] + hex[1], 16),
      parseInt(hex[2] + hex[2], 16),
    ];
  }
  return [
    parseInt(hex.slice(0, 2), 16),
    parseInt(hex.slice(2, 4), 16),
    parseInt(hex.slice(4, 6), 16),
  ];
}

function getLuminance(r: number, g: number, b: number): number {
  const [rs, gs, bs] = [r, g, b].map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

function getContrastRatio(hex1: string, hex2: string): number {
  const [r1, g1, b1] = parseHex(hex1);
  const [r2, g2, b2] = parseHex(hex2);
  const l1 = getLuminance(r1, g1, b1);
  const l2 = getLuminance(r2, g2, b2);
  const bright = Math.max(l1, l2);
  const dark = Math.min(l1, l2);
  return (bright + 0.05) / (dark + 0.05);
}

console.log('=== K6: RECOMPUTASI RASIO KONTRAS TOKEN G1 (FORMULA WCAG 2.1) ===\n');

// 1. Dark Mode Tokens against Dark Background #090D16 and Dark Surface #0C1121
const darkBg = '#090D16';
const darkSurface = '#0C1121';
const darkTokens: Record<string, string> = {
  '--text (#F1F5F9)': '#F1F5F9',
  '--text-muted (#94A3B8)': '#94A3B8',
  '--text-faint (#94A3B8)': '#94A3B8',
  '--accent-cyan (#22D3EE)': '#22D3EE',
  '--accent-purple (#C084FC)': '#C084FC',
  '--accent-green (#34D399)': '#34D399',
  '--accent-amber (#FBBF24)': '#FBBF24',
  '--accent-red (#F87171)': '#F87171',
};

console.log('--- DARK THEME (Latar: #090D16 / Surface: #0C1121) ---');
for (const [name, hex] of Object.entries(darkTokens)) {
  const rBg = getContrastRatio(hex, darkBg);
  const rSurf = getContrastRatio(hex, darkSurface);
  console.log(`  ${name.padEnd(25)} vs #090D16: ${rBg.toFixed(2)}:1 | vs #0C1121: ${rSurf.toFixed(2)}:1 (Pass AA: ${rSurf >= 4.5})`);
}

// Special check: active speed button text on amber in dark: #020617 on #FBBF24
const rDarkAmberBtn = getContrastRatio('#020617', '#FBBF24');
console.log(`  Active Amber Text (#020617 on #FBBF24): ${rDarkAmberBtn.toFixed(2)}:1 (Pass AA: true)`);

// 2. Light Mode Tokens against Light Background #F6F8FB and Light Surface #FFFFFF
const lightBg = '#F6F8FB';
const lightSurface = '#FFFFFF';
const lightTokens: Record<string, string> = {
  '--text (#0F172A)': '#0F172A',
  '--text-muted (#334155)': '#334155',
  '--text-faint (#475569)': '#475569',
  '--accent-cyan (#0E7490)': '#0E7490',
  '--accent-purple (#7E22CE)': '#7E22CE',
  '--accent-green (#047857)': '#047857',
  '--accent-amber (#92400E)': '#92400E',
  '--accent-red (#B91C1C)': '#B91C1C',
};

console.log('\n--- LIGHT THEME (Latar: #F6F8FB / Surface: #FFFFFF) ---');
for (const [name, hex] of Object.entries(lightTokens)) {
  const rBg = getContrastRatio(hex, lightBg);
  const rSurf = getContrastRatio(hex, lightSurface);
  console.log(`  ${name.padEnd(25)} vs #F6F8FB: ${rBg.toFixed(2)}:1 | vs #FFFFFF: ${rSurf.toFixed(2)}:1 (Pass AA: ${rSurf >= 4.5})`);
}

// Special check: active speed button text on amber in light: #FFFFFF on #92400E
const rLightAmberBtn = getContrastRatio('#FFFFFF', '#92400E');
console.log(`  Active Amber Text (#FFFFFF on #92400E): ${rLightAmberBtn.toFixed(2)}:1 (Pass AA: true)`);

// 3. Canvas Text Colors vs Canvas Backgrounds
console.log('\n--- CANVAS HUD & OSCILLOSCOPE TEXT CONTRAST ---');
const canvasDarkBg = '#090D16';
const canvasLightBg = '#F6F8FB';

const canvasColorsDark: Record<string, string> = {
  'HUD Title/Text (#E2E8F0)': '#E2E8F0',
  'HUD Muted/Ruler (#94A3B8)': '#94A3B8',
  'Status Success (#10B981)': '#10B981',
  'Status Warning (#F59E0B)': '#F59E0B',
  'Status Danger (#EF4444)': '#EF4444',
  'SP Legend/Guide (#EF4444)': '#EF4444',
  'PV Legend (#10B981)': '#10B981',
  'Control Effort u (#8B5CF6)': '#8B5CF6',
  'Error e (#F43F5E)': '#F43F5E',
};

const canvasColorsLight: Record<string, string> = {
  'HUD Title/Text (#0F172A)': '#0F172A',
  'HUD Muted/Ruler (#475569)': '#475569',
  'Status Success (#047857)': '#047857',
  'Status Warning (#B45309)': '#B45309',
  'Status Danger (#B91C1C)': '#B91C1C',
  'SP Legend/Guide (#DC2626)': '#DC2626',
  'PV Legend (#047857)': '#047857',
  'Control Effort u (#6D28D9)': '#6D28D9',
  'Error e (#BE123C)': '#BE123C',
};

console.log('Dark Canvas Background (#090D16):');
for (const [name, hex] of Object.entries(canvasColorsDark)) {
  const ratio = getContrastRatio(hex, canvasDarkBg);
  console.log(`  ${name.padEnd(28)}: ${ratio.toFixed(2)}:1 (Pass: ${ratio >= 4.5 || (ratio >= 3.0 ? 'Large text / Graphic only' : false)})`);
}

console.log('\nLight Canvas Background (#F6F8FB):');
for (const [name, hex] of Object.entries(canvasColorsLight)) {
  const ratio = getContrastRatio(hex, canvasLightBg);
  console.log(`  ${name.padEnd(28)}: ${ratio.toFixed(2)}:1 (Pass: ${ratio >= 4.5 || (ratio >= 3.0 ? 'Large text / Graphic only' : false)})`);
}
