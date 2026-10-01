const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const context = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname, '../effects.js'), 'utf8'), context);
const effects = context.NeonEffects;

test('tuning clamps invalid settings and defaults to no animation', () => {
  const defaults = effects.normalize();
  assert.equal(defaults.shimmer + defaults.glitch + defaults.roll, 0);
  const corrected = effects.normalize({ spacing: -10, bloom: 200, glitch: NaN, softness: 'bad' });
  assert.equal(corrected.spacing, 2);
  assert.equal(corrected.bloom, 100);
  assert.equal(corrected.glitch, 0);
  assert.equal(corrected.softness, effects.defaults.softness);
});

test('all presets normalize without changing their values', () => {
  for (const preset of Object.values(effects.presets)) {
    assert.equal(JSON.stringify(effects.normalize(preset)), JSON.stringify({ ...effects.defaults, ...preset }));
  }
});

test('cyberpunk is a strict opt-in and its controls have bounded values', () => {
  assert.equal(effects.normalize().cyberpunk, false);
  assert.equal(effects.normalize({ cyberpunk: 'true' }).cyberpunk, false);
  const tuned = effects.normalize({ cyberpunk: true, cyberAmount: 200, cyberFrequency: 0, cyberSplit: -10 });
  assert.equal(tuned.cyberpunk, true);
  assert.equal(tuned.cyberAmount, 100);
  assert.equal(tuned.cyberFrequency, 1);
  assert.equal(tuned.cyberSplit, 0);
  assert.ok(effects.cyberDuration(tuned) > effects.cyberDuration(effects.normalize({ cyberFrequency: 100 })));
});
