const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = file => readFileSync(path.join(__dirname, '..', file), 'utf8');

async function setup({ blocked = false, enabled = false } = {}) {
  class Node {
    constructor() { this.disabled = true; this.hidden = true; this.dataset = {}; this.listeners = {}; this.attrs = {}; this.style = { setProperty() {} }; }
    addEventListener(name, fn) { this.listeners[name] = fn; }
    setAttribute(name, value) { this.attrs[name] = value; }
    getAttribute(name) { return this.attrs[name]; }
    append() {}
    replaceChildren() {}
  }
  const nodes = new Map();
  const get = selector => {
    if (!nodes.has(selector)) nodes.set(selector, new Node());
    return nodes.get(selector);
  };
  const injections = [], messages = [], writes = [], queries = [];
  let closed = false;
  const context = vm.createContext({
    URL,
    document: { body: new Node(), querySelector: get, querySelectorAll: () => [], createElement: () => new Node() },
    window: { close() { closed = true; } },
    chrome: {
      tabs: {
        async query(query) { queries.push(query); return [{ id: 42 }, { id: 99 }]; },
        async sendMessage(tabId, message, options) {
          messages.push({ tabId, message, options });
          return { ok: true, settings: { enabled, intensity: 65, mode: 'aperture', effects: {}, targeting: null } };
        }
      },
      scripting: { async executeScript(injection) { injections.push(injection); if (blocked) throw new Error('Cannot access this page'); } },
      storage: { local: { async set(values) { writes.push(values); } } },
      runtime: { async sendMessage() { return { ok: true, targeting: { wholePage: true, images: false, types: [] } }; } }
    }
  });
  vm.runInContext(['targets.js', 'effects.js', 'popup.js'].map(read).join('\n'), context);
  await new Promise(resolve => setImmediate(resolve));
  return { get, injections, messages, writes, queries, get closed() { return closed; } };
}

test('manifest grants only temporary active-tab access and has no automatic page scripts', () => {
  const manifest = JSON.parse(read('manifest.json'));
  assert.deepEqual(manifest.permissions.sort(), ['activeTab', 'scripting', 'storage']);
  assert.equal(manifest.host_permissions, undefined);
  assert.equal(manifest.content_scripts, undefined);
});

test('popup injects only into the active tab and power never writes a global enabled flag', async () => {
  const env = await setup();
  assert.equal(env.injections.length, 1);
  assert.equal(env.injections[0].target.tabId, 42);
  assert.equal(env.injections[0].target.allFrames, undefined);
  assert.deepEqual(Array.from(env.injections[0].files), ['targets.js', 'effects.js', 'content.js']);
  assert.equal(env.queries[0].active, true);
  assert.equal(env.queries[0].currentWindow, true);
  assert.equal(env.get('#power').disabled, false);
  await env.get('#power').listeners.click();
  assert.equal(env.messages.at(-1).message.values.enabled, true);
  assert.equal(env.messages.at(-1).tabId, 42);
  assert.equal(env.messages.at(-1).options.frameId, 0);
  assert.equal(env.writes.length, 0);
});

test('reopened popup reflects document state; settings and picker address that same tab', async () => {
  const env = await setup({ enabled: true });
  assert.equal(env.get('#power').getAttribute('aria-checked'), 'true');
  env.get('#intensity').value = '30';
  env.get('#intensity').listeners.input();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(env.messages.at(-1).message.values.intensity, 30);
  assert.equal(env.writes.at(-1).intensity, 30);
  await env.get('#whole-page').listeners.change();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(env.messages.at(-1).message.values.targeting.wholePage, true);
  await env.get('#pick-element').listeners.click();
  assert.equal(env.messages.at(-1).message.type, 'neon-pick-element');
  assert.ok(env.messages.every(entry => entry.tabId === 42));
  assert.equal(env.closed, true);
});

test('blocked pages show an explanation and leave controls disabled', async () => {
  const env = await setup({ blocked: true });
  assert.equal(env.messages.length, 0);
  assert.equal(env.get('#power').disabled, true);
  assert.equal(env.get('#scope-picker').disabled, true);
  assert.equal(env.get('#error').hidden, false);
  assert.match(env.get('#error').textContent, /regular webpage/);
});
