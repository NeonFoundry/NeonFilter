const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../targets.js'), 'utf8');
const context = vm.createContext({ URL, CSS: { escape: value => value } });
vm.runInContext(source, context);
const targets = context.NeonTargets;

test('adding types is additive, deduplicates, and retains images through toggles and clearing', () => {
  let state = targets.normalize({ scope: 'images' });
  const change = (action, extras = {}) => { state = targets.update({ targeting: state }, { action, ...extras }); };
  const canvas = { url: 'https://example.test/', tagName: 'canvas' };
  const div = { url: 'https://example.test/', tagName: 'div' };
  change('addType', canvas);
  change('addType', div);
  change('addType', canvas);
  assert.equal(state.images, true);
  assert.equal(state.types.length, 2);
  change('toggleType', { ...canvas, enabled: false });
  assert.equal(state.types.length, 2);
  assert.equal(state.types[0].enabled, false);
  assert.equal(state.types[1].enabled, true);
  change('images', { enabled: false });
  assert.equal(state.types[1].enabled, true);
  change('images', { enabled: true });
  change('wholePage', { enabled: true });
  assert.equal(state.types.length, 2);
  assert.equal(state.images, true);
  change('wholePage', { enabled: false });
  change('clearTypes');
  assert.equal(state.types.length, 0);
  assert.equal(state.images, true);
});

test('migrates previous picks and does not resurrect them after clearing', () => {
  const old = { scope: 'element', target: { url: 'https://example.test/', tagName: 'canvas' } };
  const migrated = targets.normalize(old);
  assert.equal(migrated.wholePage, false);
  assert.equal(migrated.types[0].tagName, 'canvas');
  const cleared = targets.update(old, { action: 'clearTypes' });
  assert.equal(targets.normalize({ ...old, targeting: cleared }).types.length, 0);
});

test('migrates exact-page targets to a site and deduplicates picks across routes', () => {
  const old = { targeting: { wholePage: false, images: false, types: [
    { url: 'https://example.test/a', tagName: 'canvas', enabled: true },
    { url: 'https://example.test/b', tagName: 'canvas', enabled: true }
  ] } };
  const migrated = targets.normalize(old);
  assert.equal(migrated.types.length, 1);
  assert.equal(migrated.types[0].url, 'https://example.test');
  assert.ok(targets.selector(migrated, 'https://example.test/c').includes('canvas'));
  assert.equal(targets.selector(migrated, 'https://other.test/c'), '');
  const toggled = targets.update({ targeting: migrated }, { action: 'toggleType', url: 'https://example.test/b', tagName: 'canvas', enabled: false });
  assert.equal(targets.selector(toggled, 'https://example.test/c'), '');
});

test('div ids target the specific element and divs without ids still target all divs', () => {
  let state = targets.normalize();
  state = targets.update({ targeting: state }, { action: 'addType', url: 'https://example.test/a', tagName: 'div', id: 'app-shell' });
  state = targets.update({ targeting: state }, { action: 'addType', url: 'https://example.test/b', tagName: 'div' });
  state = targets.update({ targeting: state }, { action: 'addType', url: 'https://example.test/c', tagName: 'div', id: 'app-shell' });

  assert.equal(state.types.length, 2);
  assert.equal(state.types[0].id, 'app-shell');
  assert.equal(state.types[1].id, undefined);
  assert.match(targets.selector(state, 'https://example.test/page'), /#app-shell/);
  assert.match(targets.selector(state, 'https://example.test/page'), /div/);

  const toggled = targets.update({ targeting: state }, { action: 'toggleType', url: 'https://example.test/x', tagName: 'div', id: 'app-shell', enabled: false });
  assert.doesNotMatch(targets.selector(toggled, 'https://example.test/page'), /#app-shell/);
  assert.match(targets.selector(toggled, 'https://example.test/page'), /div/);
});

test('serializes simultaneous picker additions in the service worker', async () => {
  let listener;
  let saved = { scope: 'images' };
  const worker = vm.createContext({
    importScripts() {}, NeonTargets: targets,
    chrome: {
      webNavigation: { onHistoryStateUpdated: { addListener() {} }, onReferenceFragmentUpdated: { addListener() {} } },
      runtime: { onMessage: { addListener(fn) { listener = fn; } }, onInstalled: { addListener() {} }, onStartup: { addListener() {} } },
      storage: { local: { get: async () => ({ ...saved }), set: async values => { saved = { ...saved, ...values }; } }, onChanged: { addListener() {} } }
    }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../background.js'), 'utf8'), worker);
  const send = tagName => new Promise(resolve => listener({ type: 'neon-update-targets', change: { action: 'addType', tagName, url: 'https://example.test/' } }, {}, resolve));
  const responses = await Promise.all([send('canvas'), send('div')]);
  assert.ok(responses.every(response => response.ok));
  assert.equal(saved.targeting.types.length, 2);
  assert.equal(saved.targeting.images, true);
  assert.equal(saved.enabled, true);
});
