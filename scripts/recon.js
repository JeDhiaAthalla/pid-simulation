const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

console.log('=== QUADCOPTER DEFINITION IN types/robots.ts ===');
const robotsContent = fs.readFileSync(path.join(root, 'types/robots.ts'), 'utf8');
const quadMatch = robotsContent.match(/id:\s*'quadcopter'[\s\S]*?animationHint:\s*'quadcopter',/);
if (quadMatch) {
  console.log(quadMatch[0]);
}

console.log('\n=== EXPORTS OF physicsEngine.ts ===');
const peContent = fs.readFileSync(path.join(root, 'lib/physicsEngine.ts'), 'utf8');
const peExports = peContent.match(/export\s+(?:function|const|class|type|interface)\s+([A-Za-z0-9_]+)/g);
console.log(peExports);

console.log('\n=== EXPORTS OF tuner.ts ===');
const tunerContent = fs.readFileSync(path.join(root, 'lib/tuner.ts'), 'utf8');
const tunerExports = tunerContent.match(/export\s+(?:function|const|class|type|interface)\s+([A-Za-z0-9_]+)/g);
console.log(tunerExports);

console.log('\n=== METHOD USAGE IN ControlDashboard.tsx ===');
const cdContent = fs.readFileSync(path.join(root, 'components/ControlDashboard.tsx'), 'utf8');
const methodMatch = cdContent.match(/methodNames[\s\S]*?\};/);
if (methodMatch) console.log(methodMatch[0]);

console.log('\n=== USAGE OF settlingTime, isStable, dampingAssessment IN UI ===');
function findInFile(relPath, pattern) {
  const c = fs.readFileSync(path.join(root, relPath), 'utf8');
  c.split('\n').forEach((l, idx) => {
    if (pattern.test(l)) console.log(`${relPath}:${idx+1}: ${l.trim()}`);
  });
}
findInFile('components/ControlDashboard.tsx', /settlingTime|isStable|dampingAssessment/);
findInFile('components/SimulationCanvas.tsx', /settlingTime|isStable|dampingAssessment/);
findInFile('components/OscilloscopeCanvas.tsx', /settlingTime|isStable|dampingAssessment/);

console.log('\n=== HISTORY BUFFER IN SimulationCanvas.tsx ===');
findInFile('components/SimulationCanvas.tsx', /history\.length|dataRef|2000|2500/);
