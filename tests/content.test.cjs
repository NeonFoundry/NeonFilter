const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const source = ['targets.js', 'effects.js', 'content.js'].map(file => readFileSync(require('node:path').join(__dirname, '..', file), 'utf8')).join('\n');

function setup(saved = { enabled: false, intensity: 65 }, activate = saved.enabled) {
  const listeners = [];
  const events = {};
  const overlays = [];
  const elements = [];
  let messageListener;
  const motion = { matches: false, addEventListener(name, fn) { this.change = fn; } };
  let observer;
  let routeCheck;
  class Element {
    constructor() {
      this.children = [];
      this.style = { setProperty(name, value) { this[name] = value; } };
      this.isConnected = false;
    }
    setAttribute(name, value) { this[name] = value; }
    attachShadow() { this.shadow = new Element(); return this.shadow; }
    append(...items) { this.children.push(...items); items.forEach(item => { item.isConnected = true; }); }
    replaceChildren(...items) { this.children = []; this.append(...items); }
    remove() { this.isConnected = false; this.open = false; }
    matches() { return Boolean(this.open); }
    showPopover() { this.open = true; }
    hidePopover() { this.open = false; }
  }
  const root = new Element();
  const context = vm.createContext({
    URL,
    setInterval(fn) { routeCheck = fn; return 1; },
    clearInterval() { routeCheck = undefined; },
    matchMedia: () => motion,
    window: { addEventListener(name, fn) { events[name] = fn; } },
    crypto: { randomUUID: () => 'test-filter' },
    CSS: { escape: value => value },
    location: { href: 'https://example.test/gallery' },
    document: {
      documentElement: root,
      createElement(name) { const element = new Element(); element.tagName = name; elements.push(element); if (name === 'neon-crt-overlay') overlays.push(element); return element; },
      createElementNS(ns, name) { const element = new Element(); element.tagName = name; elements.push(element); return element; },
      addEventListener(name, fn) { events[name] = fn; }
    },
    MutationObserver: class {
      constructor(fn) { this.callback = fn; observer = this; }
      observe() { this.active = true; }
      disconnect() { this.active = false; }
    },
    chrome: { runtime: { onMessage: { addListener(fn) { messageListener = fn; } } }, storage: {
      local: { get: async () => saved },
      onChanged: { addListener: fn => listeners.push(fn) }
    } }
  });
  vm.runInContext(source, context);
  const send = values => messageListener({ type: 'neon-apply', values }, {}, () => {});
  if (activate) send({ enabled: true });
  return {
    storageChange(values) { listeners.forEach(fn => fn(Object.fromEntries(Object.entries(values).map(([key, newValue]) => [key, { newValue }])), 'local')); },
    route(url) { context.location.href = url; routeCheck?.(); },
    send(message) { return new Promise(resolve => messageListener(message, {}, resolve)); },
    overlays, events, context, elements, motion,
    navigate(url) { context.location.href = url; messageListener({ type: 'neon-navigation' }, {}, () => {}); },
    get observer() { return observer; },
    change(values, area = 'local') { if (area === 'local') send(values); }
  };
}

test('starts off and fresh defaults target images without a whole-page overlay', async () => {
  const env = setup();
  await Promise.resolve();
  assert.equal(env.overlays.length, 0);
  env.change({ enabled: true });
  assert.equal(env.overlays.length, 0);
  const svg = env.elements.find(element => element.tagName === 'svg');
  const style = env.elements.find(element => element.tagName === 'style');
  assert.equal(svg.isConnected, true);
  assert.ok(style.textContent.startsWith(':is(img)'));
});

test('explicit whole-page scope enables a single overlay, updates intensity, and removes it on disable', async () => {
  const env = setup({ enabled: false, intensity: 65, scope: 'page' });
  await Promise.resolve();
  assert.equal(env.overlays.length, 0);
  env.change({ enabled: true });
  const host = env.overlays[0];
  assert.equal(host.isConnected, true);
  assert.equal(host.open, true);
  const screen = host.shadow.children[1];
  assert.equal(screen.style['--strength'], 0.65);
  env.change({ intensity: 100 });
  assert.equal(screen.style['--strength'], 1);
  env.change({ intensity: 0 });
  assert.equal(screen.style['--softness'], '0px');
  env.change({ enabled: false });
  assert.equal(host.isConnected, false);
  assert.equal(env.observer.active, false);
  env.change({ enabled: true });
  assert.equal(env.overlays.length, 1);
  assert.equal(host.isConnected, true);
});

test('image scope replaces page overlay and fully cleans up when disabled', async () => {
  const env = setup({ enabled: true, intensity: 65, scope: 'page' });
  await Promise.resolve();
  env.change({ scope: 'images' });
  assert.equal(env.overlays[0].isConnected, false);
  const svg = env.elements.find(element => element.tagName === 'svg');
  const style = env.elements.find(element => element.tagName === 'style' && element.textContent.startsWith(':is(img)'));
  assert.equal(svg.isConnected, true);
  assert.match(style.textContent, /https:\/\/example.test\/gallery#neon-crt-test-filter/);
  env.change({ mode: 'scanlines' });
  assert.equal(svg.children[0].children.find(node => node.result === 'line').height, '1.6');
  env.change({ intensity: 0 });
  assert.equal(style.textContent, '');
  env.change({ enabled: false });
  assert.equal(svg.isConnected, false);
  assert.equal(style.isConnected, false);
  assert.equal(env.observer.active, false);
  env.change({ enabled: true, intensity: 80 });
  assert.equal(svg.isConnected, true);
  env.change({ scope: 'page' });
  assert.equal(svg.isConnected, false);
  assert.equal(style.isConnected, false);
  assert.equal(env.overlays[0].isConnected, true);
});

test('saved image scope starts without a viewport overlay and remounts removed resources', async () => {
  const env = setup({ enabled: true, intensity: 65, scope: 'images' });
  await Promise.resolve();
  assert.equal(env.overlays.length, 0);
  const svg = env.elements.find(element => element.tagName === 'svg');
  svg.remove();
  env.observer.callback();
  assert.equal(svg.isConnected, true);
});

test('element-type scope targets all matching tags on its saved page without compounding nested matches', async () => {
  const env = setup({ enabled: true, intensity: 65, scope: 'element', target: { url: 'https://example.test/gallery', tagName: 'canvas' } });
  await Promise.resolve();
  assert.equal(env.overlays.length, 0);
  const style = env.elements.find(element => element.tagName === 'style');
  assert.ok(style.textContent.startsWith(':is(canvas):not(:is(canvas) :is(canvas)) { filter:'));
  env.change({ target: { url: 'https://example.test/gallery', tagName: 'div' } });
  assert.ok(style.textContent.startsWith(':is(div):not(:is(div) :is(div)) { filter:'));
  env.change({ target: { url: 'https://different.test/', tagName: 'canvas' } });
  assert.equal(style.textContent, '');
  env.change({ target: null });
  assert.equal(style.textContent, '');
});

test('images and several enabled types combine and can be toggled without deleting saved choices', async () => {
  const types = [
    { url: 'https://example.test/gallery', tagName: 'canvas', enabled: true },
    { url: 'https://example.test/gallery', tagName: 'div', enabled: true },
    { url: 'https://other.test/', tagName: 'video', enabled: true }
  ];
  const env = setup({ enabled: true, targeting: { wholePage: false, images: true, types } });
  await Promise.resolve();
  const style = env.elements.find(element => element.tagName === 'style');
  assert.ok(style.textContent.startsWith(':is(img, canvas, div):not(:is(img, canvas, div) :is(img, canvas, div))'));
  env.change({ targeting: { wholePage: false, images: true, types: types.map(entry => ({ ...entry, enabled: false })) } });
  assert.ok(style.textContent.startsWith(':is(img)'));
  env.change({ targeting: { wholePage: false, images: false, types: [] } });
  assert.equal(style.textContent, '');
  env.change({ targeting: { wholePage: true, images: true, types } });
  assert.equal(style.isConnected, false);
  env.change({ targeting: { wholePage: false, images: true, types } });
  assert.equal(style.isConnected, true);
  assert.ok(style.textContent.startsWith(':is(img, canvas, div)'));
});

test('restores saved settings and prevents duplicate injections', async () => {
  const env = setup({ enabled: true, intensity: 80, scope: 'page' });
  await Promise.resolve();
  vm.runInContext(source, env.context);
  assert.equal(env.overlays.length, 1);
  assert.equal(env.overlays[0].shadow.children[1].style['--strength'], 0.8);
  env.overlays[0].remove();
  env.observer.callback();
  assert.equal(env.overlays[0].isConnected, true);
  env.events.fullscreenchange();
  assert.equal(env.overlays[0].open, true);
});

test('preserves tab messages received during initialization', async () => {
  const env = setup({ enabled: true, intensity: 65, scope: 'page' });
  env.change({ intensity: 25 });
  await Promise.resolve();
  assert.equal(env.overlays[0].isConnected, true);
  assert.equal(env.overlays[0].shadow.children[1].style['--strength'], 0.25);
  env.change({ enabled: false }, 'sync');
  assert.equal(env.overlays[0].isConnected, true);
});

test('switches styles live, remembers style while off, and defaults older settings to aperture', async () => {
  const env = setup({ enabled: true, intensity: 70, scope: 'page' });
  await Promise.resolve();
  const screen = env.overlays[0].shadow.children[1];
  assert.equal(screen['data-mode'], 'aperture');
  env.change({ mode: 'scanlines' });
  assert.equal(screen['data-mode'], 'scanlines');
  assert.equal(screen.style['--strength'], 0.7);
  assert.equal(env.overlays.length, 1);
  env.change({ enabled: false });
  env.change({ mode: 'aperture' });
  env.change({ enabled: true });
  assert.equal(screen['data-mode'], 'aperture');
  env.change({ mode: 'unknown' });
  assert.equal(screen['data-mode'], 'aperture');
});

test('restores saved scanlines and respects mode changes during initialization', async () => {
  const env = setup({ enabled: true, intensity: 65, mode: 'scanlines', scope: 'page' });
  await Promise.resolve();
  assert.equal(env.overlays[0].shadow.children[1]['data-mode'], 'scanlines');
  const racing = setup({ enabled: true, intensity: 65, mode: 'aperture', scope: 'page' });
  racing.change({ mode: 'scanlines' });
  await Promise.resolve();
  assert.equal(racing.overlays[0].shadow.children[1]['data-mode'], 'scanlines');
});

test('refreshes SVG references on navigation while keeping same-site types active', async () => {
  const env = setup({ enabled: true, targeting: { wholePage: false, images: false, types: [{ url: 'https://example.test/gallery', tagName: 'canvas', enabled: true }] } });
  await Promise.resolve();
  const style = env.elements.find(element => element.tagName === 'style');
  env.navigate('https://example.test/another-page?view=2');
  assert.match(style.textContent, /:is\(canvas\)/);
  assert.match(style.textContent, /another-page\?view=2#neon-crt-test-filter/);
  style.remove();
  env.events.pageshow();
  assert.equal(style.isConnected, true);
  env.navigate('https://elsewhere.test/page');
  assert.equal(style.textContent, '');
  env.navigate('https://example.test/gallery');
  assert.match(style.textContent, /:is\(canvas\)/);
});

test('motion primitives are opt-in, pause for hidden documents and reduced motion, and return when allowed', async () => {
  const env = setup({ enabled: true, scope: 'images', effects: { shimmer: 40, glitch: 40, roll: 20, rgb: 20 } });
  await Promise.resolve();
  const svg = env.elements.find(element => element.tagName === 'svg');
  const nodes = element => [element, ...element.children.flatMap(nodes)];
  const hasAnimation = () => nodes(svg).some(element => element.tagName === 'animate');
  assert.equal(hasAnimation(), true);
  env.context.document.hidden = true;
  env.events.visibilitychange();
  assert.equal(hasAnimation(), false);
  env.context.document.hidden = false;
  env.events.visibilitychange();
  assert.equal(hasAnimation(), true);
  env.motion.matches = true;
  env.motion.change();
  assert.equal(hasAnimation(), false);
  env.change({ effects: { shimmer: 0, glitch: 0, roll: 0 } });
  env.motion.matches = false;
  env.motion.change();
  assert.equal(hasAnimation(), false);
});

test('whole-page tuning and motion flags respond live and vanish at zero intensity', async () => {
  const env = setup({ enabled: true, scope: 'page', effects: { spacing: 7, darkness: 90, shimmer: 50, glitch: 30, roll: 20 } });
  await Promise.resolve();
  const screen = env.overlays[0].shadow.children[1];
  assert.equal(screen.style['--spacing'], '7px');
  assert.equal(screen['data-shimmer'], 'true');
  env.change({ intensity: 0 });
  assert.equal(screen['data-shimmer'], 'false');
  assert.equal(screen['data-glitch'], 'false');
  assert.equal(screen['data-roll'], 'false');
});

test('cyberpunk tearing is additive, opt-in, and removed for reduced motion or zero intensity', async () => {
  const tuning = { cyberpunk: true, cyberAmount: 70, cyberFrequency: 50, cyberSplit: 60 };
  const env = setup({ enabled: true, scope: 'images', effects: tuning });
  await Promise.resolve();
  const svg = env.elements.find(element => element.tagName === 'svg');
  const hasTear = () => svg.children[0].children.some(element => element.result === 'cyberTear');
  const nodes = element => [element, ...element.children.flatMap(nodes)];
  const cyberAnimations = () => nodes(svg).filter(element => element.tagName === 'animate').length;
  assert.equal(hasTear(), true);
  assert.ok(svg.children[0].children.some(element => element.result === 'cyberSplit'));
  assert.ok(cyberAnimations() > 0);
  env.change({ effects: { ...tuning, cyberpunk: false } });
  assert.equal(hasTear(), false);
  env.change({ effects: tuning });
  assert.equal(hasTear(), true);
  env.motion.matches = true;
  env.motion.change();
  assert.equal(hasTear(), true);
  assert.equal(cyberAnimations(), 0);
  env.motion.matches = false;
  env.change({ intensity: 0 });
  assert.equal(hasTear(), false);
  env.change({ intensity: 65, scope: 'page' });
  const screen = env.overlays[0].shadow.children[1];
  assert.equal(screen['data-cyber'], 'true');
  assert.equal(screen['data-cyber-motion'], 'true');
  assert.equal(screen.style['--cyber-duration'], '7.25s');
  assert.equal(screen.style['--cyber-rest-shift'], '1.8199999999999998px');
  env.motion.matches = true;
  env.motion.change();
  assert.equal(screen['data-cyber'], 'true');
  assert.equal(screen['data-cyber-motion'], 'false');
  env.change({ effects: { ...tuning, cyberpunk: false } });
  assert.equal(screen['data-cyber'], 'false');
});


test('shared storage changes cannot enable or change another tab', async () => {
  const first = setup({ enabled: true, scope: 'page', intensity: 65 });
  const second = setup({ enabled: false, scope: 'page', intensity: 65 });
  await Promise.resolve();
  second.storageChange({ enabled: true, intensity: 15 });
  first.change({ intensity: 30 });
  assert.equal(second.overlays.length, 0);
  assert.equal((await second.send({ type: 'neon-get-state' })).settings.intensity, 65);
  assert.equal((await first.send({ type: 'neon-get-state' })).settings.intensity, 30);
});

test('legacy global power does not turn on a newly injected document', async () => {
  const env = setup({ enabled: true, scope: 'page', intensity: 80 }, false);
  const { settings } = await env.send({ type: 'neon-get-state' });
  assert.equal(settings.enabled, false);
  assert.equal(settings.intensity, 80);
  assert.equal(env.overlays.length, 0);
});

test('route polling refreshes pushState SVG references without navigation permission', async () => {
  const env = setup({ enabled: true, scope: 'images' });
  await Promise.resolve();
  env.route('https://example.test/new-route');
  const style = env.elements.find(element => element.tagName === 'style');
  assert.match(style.textContent, /new-route#neon-crt-test-filter/);
});
