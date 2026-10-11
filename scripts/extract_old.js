const fs = require('fs');
const readline = require('readline');

const rl = readline.createInterface({
  input: fs.createReadStream('C:/Users/dhia/.gemini/antigravity-ide/brain/11d5c912-858f-482a-a835-d5b9c6f253ca/.system_generated/logs/transcript_full.jsonl')
});

rl.on('line', (line) => {
  for (let s = 217; s <= 222; s++) {
    if (line.includes(`"step_index":${s}`) || line.includes(`"step_index": ${s}`)) {
      const json = JSON.parse(line);
      console.log('Found step:', s, 'type:', json.type);
      fs.appendFileSync('scripts/old_physics_steps.txt', `\n=== STEP ${s} ===\n${json.content || ''}\n`);
    }
  }
});
