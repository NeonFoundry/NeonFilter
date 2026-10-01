(() => {
  // Installation-time injection and declarative injection can race.
  if (globalThis.__neonFilterLoaded) return;
  globalThis.__neonFilterLoaded = true;

  let host;
  let screen;
  let enabled = false;
  let intensity = 65;
  let mode = "aperture";
  let effects = NeonEffects.normalize();
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const motionAllowed = () => !reducedMotion.matches && !document.hidden;
  const targetSettings = {};
  let targeting = NeonTargets.normalize();
  let cancelPicker;
  let imageSvg;
  let imageFilter;
  let imageStyle;
  const filterId = `neon-crt-${crypto.randomUUID()}`;
  const pendingChanges = {};
  let initialized = false;
  const observer = new MutationObserver(() => {
    if (!enabled) return;
    if (!targeting.wholePage) mountImages();
    else if (host && !host.isConnected) mount();
  });

  function svgNode(name, attributes = {}) {
    const node = document.createElementNS("http://www.w3.org/2000/svg", name);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
    return node;
  }

  function mountImages() {
    if (!document.documentElement || !imageSvg) return;
    if (!imageSvg.isConnected) document.documentElement.append(imageSvg);
    if (!imageStyle.isConnected) document.documentElement.append(imageStyle);
  }

  function renderImages() {
    if (!imageSvg) {
      imageSvg = svgNode("svg", { width: 0, height: 0, "aria-hidden": "true" });
      imageSvg.style.cssText = "position:fixed!important;width:0!important;height:0!important;pointer-events:none!important;overflow:hidden!important;";
      imageFilter = svgNode("filter", {
        id: filterId, x: "0%", y: "0%", width: "100%", height: "100%",
        "color-interpolation-filters": "sRGB", primitiveUnits: "userSpaceOnUse"
      });
      imageSvg.append(imageFilter);
      imageStyle = document.createElement("style");
    }
    imageFilter.replaceChildren(...NeonEffects.primitives(svgNode, effects, mode, intensity / 100, motionAllowed()));
    // An absolute same-document URL also works on sites with a <base> element.
    const reference = `${location.href.split("#")[0]}#${filterId}`;
    const selector = NeonTargets.selector(targeting, location.href.split("#")[0]);
    imageStyle.textContent = intensity === 0 || !selector ? "" : `${selector} { filter: url(${JSON.stringify(reference)}) !important; }`;
    mountImages();
  }

  function startPicker() {
    cancelPicker?.();
    const picker = document.createElement("div");
    picker.setAttribute("popover", "manual");
    picker.style.cssText = "all:initial!important;position:fixed!important;inset:0!important;width:100%!important;height:100%!important;margin:0!important;padding:0!important;border:0!important;background:transparent!important;pointer-events:none!important;z-index:2147483647!important;";
    const shadow = picker.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = ":host::backdrop{background:transparent;pointer-events:none}.box{position:fixed;border:2px solid #8effb0;background:#8effb01a;box-sizing:border-box}.hint{position:fixed;top:16px;left:50%;transform:translateX(-50%);padding:12px 18px;border-radius:8px;background:#10291e;color:#c9ffda;font:14px/1.5 system-ui;box-shadow:0 3px 20px #0006;text-align:center}";
    const box = document.createElement("div");
    box.className = "box";
    const hint = document.createElement("div");
    hint.className = "hint";
    hint.textContent = "Pick a type to filter everywhere on this page. Esc cancels. ArrowUp selects parent.";
    shadow.append(style, box, hint);
    document.documentElement.append(picker);
    try { picker.showPopover(); } catch { /* Fixed-position fallback. */ }
    let selected;
    const highlight = () => {
      if (!selected?.isConnected) return;
      const rect = selected.getBoundingClientRect();
      box.style.cssText = `left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;`;
      const idTarget = selected.localName === "div" && selected.id ? `#${selected.id}` : `<${selected.localName}>`;
      hint.textContent = `Click to filter ${idTarget}. Esc cancels. ArrowUp selects parent.`;
    };
    const move = event => {
      if (!(event.target instanceof Element) || event.target === picker) return;
      selected = event.target;
      highlight();
    };
    const stop = () => {
      document.removeEventListener("pointermove", move, true);
      document.removeEventListener("click", choose, true);
      document.removeEventListener("pointerdown", block, true);
      document.removeEventListener("pointerup", block, true);
      document.removeEventListener("keydown", key, true);
      document.removeEventListener("scroll", highlight, true);
      window.removeEventListener("resize", highlight);
      picker.remove();
      cancelPicker = null;
    };
    const block = event => { event.preventDefault(); event.stopImmediatePropagation(); };
    const choose = async event => {
      block(event);
      if (!selected && event.target instanceof Element) selected = event.target;
      if (!selected?.isConnected || selected === picker) return;
      const chosenTarget = { url: location.href.split("#")[0], tagName: selected.localName };
      if (selected.localName === "div" && selected.id) chosenTarget.id = selected.id;
      try {
        const result = await chrome.runtime.sendMessage({ type: "neon-update-targets", change: { action: "addType", ...chosenTarget } });
        if (!result?.ok) throw new Error("Couldn't save type");
        apply({ targeting: result.targeting, enabled: true });
        stop();
      } catch {
        hint.textContent = "Couldn't save selection. Try again, or press Esc to cancel.";
      }
    };
    const key = event => {
      if (event.key === "Escape") { block(event); stop(); }
      if (event.key === "ArrowUp" && selected?.parentElement) {
        block(event);
        selected = selected.parentElement;
        highlight();
      }
      if (event.key === "Enter" && selected) void choose(event);
    };
    document.addEventListener("pointermove", move, true);
    document.addEventListener("click", choose, true);
    document.addEventListener("pointerdown", block, true);
    document.addEventListener("pointerup", block, true);
    document.addEventListener("keydown", key, true);
    document.addEventListener("scroll", highlight, true);
    window.addEventListener("resize", highlight);
    cancelPicker = stop;
  }

  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (message.type === "neon-navigation") {
      cancelPicker?.();
      render();
      respond({ ok: true });
    }
    if (message.type === "neon-pick-element") {
      startPicker();
      respond({ ok: true });
    }
  });

  function build() {
    host = document.createElement("neon-crt-overlay");
    host.setAttribute("aria-hidden", "true");
    host.setAttribute("popover", "manual");
    host.style.cssText = "all:initial!important;position:fixed!important;inset:0!important;width:100%!important;height:100%!important;margin:0!important;padding:0!important;border:0!important;overflow:hidden!important;pointer-events:none!important;z-index:2147483647!important;background:transparent!important;color-scheme:normal!important;";
    const shadow = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = `
      :host::backdrop { background: transparent !important; pointer-events: none !important; }
      .screen { position:absolute; inset:0; pointer-events:none; }
      .glass { position:absolute; inset:0; backdrop-filter:blur(var(--softness)) saturate(var(--saturation)) contrast(var(--contrast)) brightness(var(--bloom)); }
      .texture { position:absolute; inset:0; opacity:var(--strength);
        background:repeating-linear-gradient(0deg,rgba(0,0,0,var(--line-darkness)) 0px,rgba(0,0,0,var(--line-darkness)) var(--line-width),transparent var(--line-width),transparent var(--spacing)),
          repeating-linear-gradient(90deg,rgba(255,40,70,.075) 0px,rgba(255,40,70,.075) 1px,rgba(60,255,150,.06) 1px,rgba(60,255,150,.06) 2px,rgba(70,100,255,.075) 2px,rgba(70,100,255,.075) 3px); }
      .screen[data-mode="scanlines"] .texture {
        background:repeating-linear-gradient(0deg,rgba(0,0,0,var(--line-darkness)) 0px,rgba(0,0,0,var(--line-darkness)) var(--line-width),transparent var(--line-width),transparent var(--spacing)); }
      .edges { position:absolute; inset:0; opacity:var(--vignette);
        background:radial-gradient(ellipse at center,transparent 42%,rgba(0,8,5,.16) 74%,rgba(0,5,3,.66) 100%),
          linear-gradient(115deg,rgba(170,255,209,.045),transparent 42%);
        box-shadow:inset 0 0 65px rgba(0,10,5,.24); }
      .shimmer { position:absolute; inset:0; background:#d6ffe8; opacity:0; }
      .glitch { position:absolute; left:0; right:0; top:35%; height:8%; opacity:0; background:linear-gradient(0deg,transparent,#8cffc233,transparent); backdrop-filter:contrast(1.2) saturate(.65); }
      .screen[data-shimmer="true"] .shimmer { animation:shimmer 2.7s linear infinite; }
      .screen[data-glitch="true"] .glitch { animation:glitch 7s steps(1) infinite; }
      .screen[data-roll="true"] .texture { animation:roll var(--roll-speed) linear infinite; }
      @keyframes shimmer { 0%,50%,100% { opacity:0; } 25%,75% { opacity:var(--shimmer); } }
      @keyframes roll { to { background-position:0 var(--spacing),0 0; } }
      @keyframes glitch { 0%,86%,92%,100% { opacity:0; } 87% { opacity:var(--glitch); top:30%; } 89% { opacity:var(--glitch); top:64%; } }
      .cyber { position:absolute; inset:-20px; opacity:0; pointer-events:none; mix-blend-mode:screen;
        background:repeating-linear-gradient(0deg,transparent 0px,transparent 24px,rgba(0,255,234,var(--cyber-tint)) 25px,transparent 28px,transparent 55px,rgba(255,0,153,var(--cyber-tint)) 56px,transparent 61px);
        backdrop-filter:hue-rotate(var(--cyber-hue)) saturate(1.8) contrast(1.25); }
      .cyber::before,.cyber::after { content:""; position:absolute; left:-8%; right:-8%; height:7%; opacity:0;
        background:linear-gradient(90deg,transparent,rgba(0,255,234,var(--cyber-band)),transparent);
        box-shadow:0 0 18px rgba(0,255,234,var(--cyber-band)); backdrop-filter:hue-rotate(var(--cyber-hue)) saturate(2) contrast(1.35); }
      .cyber::before { top:22%; transform:translateX(var(--cyber-rest-shift)); }
      .cyber::after { top:61%; height:5%; background:linear-gradient(90deg,transparent,rgba(255,0,153,var(--cyber-band)),transparent);
        box-shadow:0 0 18px rgba(255,0,153,var(--cyber-band)); transform:translateX(calc(var(--cyber-rest-shift) * -1)); }
      .screen[data-cyber="true"] .cyber { opacity:var(--cyber-rest); transform:translateX(var(--cyber-rest-shift)); }
      .screen[data-cyber="true"] .cyber::before { opacity:var(--cyber-rest); }
      .screen[data-cyber="true"] .cyber::after { opacity:var(--cyber-rest); }
      .screen[data-cyber-motion="true"] .cyber { animation:cyber var(--cyber-duration) steps(1) infinite; }
      .screen[data-cyber-motion="true"] .cyber::before { animation:cyber-band-a var(--cyber-duration) steps(1) infinite; }
      .screen[data-cyber-motion="true"] .cyber::after { animation:cyber-band-b var(--cyber-duration) steps(1) infinite; }
      @keyframes cyber { 0%,70%,84%,100% { opacity:var(--cyber-rest); transform:translateX(var(--cyber-rest-shift)); }
        72% { opacity:calc(var(--cyber-amount) * 0.7); transform:translateX(var(--cyber-shift)); }
        76% { opacity:calc(var(--cyber-amount) * 0.7); transform:translate(calc(var(--cyber-shift) * -0.6),11%); }
        80% { opacity:calc(var(--cyber-amount) * 0.7); transform:translate(calc(var(--cyber-shift) * 0.3),-7%); } }
      @keyframes cyber-band-a { 0%,70%,84%,100% { opacity:var(--cyber-rest); transform:translateX(var(--cyber-rest-shift)); }
        72% { opacity:var(--cyber-amount); transform:translateX(var(--cyber-shift)); top:18%; }
        76% { opacity:var(--cyber-amount); transform:translateX(calc(var(--cyber-shift) * -0.6)); top:47%; }
        80% { opacity:var(--cyber-amount); transform:translateX(calc(var(--cyber-shift) * 0.35)); top:74%; } }
      @keyframes cyber-band-b { 0%,70%,84%,100% { opacity:var(--cyber-rest); transform:translateX(calc(var(--cyber-rest-shift) * -1)); }
        72% { opacity:var(--cyber-amount); transform:translateX(calc(var(--cyber-shift) * -0.5)); top:66%; }
        76% { opacity:var(--cyber-amount); transform:translateX(calc(var(--cyber-shift) * 0.45)); top:29%; }
        80% { opacity:var(--cyber-amount); transform:translateX(calc(var(--cyber-shift) * -0.2)); top:52%; } }
    `;
    screen = document.createElement("div");
    screen.className = "screen";
    for (const name of ["glass", "texture", "edges", "shimmer", "glitch", "cyber"]) {
      const layer = document.createElement("div");
      layer.className = name;
      screen.append(layer);
    }
    shadow.append(style, screen);
  }

  function mount() {
    if (!document.documentElement) return;
    if (!host.isConnected) document.documentElement.append(host);
    // The top layer covers page dialogs without changing the page's layout.
    try { if (!host.matches(":popover-open")) host.showPopover(); } catch { /* Fixed-position fallback. */ }
  }

  function render() {
    observer.disconnect();
    if (!enabled) {
      host?.remove();
      imageStyle?.remove();
      imageSvg?.remove();
      return;
    }
    if (!targeting.wholePage) {
      host?.remove();
      renderImages();
      observer.observe(document.documentElement, { childList: true });
      return;
    }
    imageStyle?.remove();
    imageSvg?.remove();
    if (!host) build();
    screen.setAttribute("data-mode", mode);
    const strength = intensity / 100;
    screen.style.setProperty("--strength", strength);
    screen.style.setProperty("--softness", `${strength * effects.softness / 100 * 1.5}px`);
    screen.style.setProperty("--saturation", 1 + strength * effects.color / 100);
    screen.style.setProperty("--contrast", 1 + strength * 0.12);
    screen.style.setProperty("--bloom", 1 + strength * effects.bloom / 100 * 0.18);
    screen.style.setProperty("--vignette", strength * effects.vignette / 65);
    screen.style.setProperty("--spacing", `${effects.spacing}px`);
    screen.style.setProperty("--line-width", `${effects.spacing * (mode === "scanlines" ? 0.4 : 0.25)}px`);
    screen.style.setProperty("--line-darkness", effects.darkness / 100 * (mode === "scanlines" ? 0.95 : 0.55));
    screen.style.setProperty("--shimmer", strength * effects.shimmer / 100 * 0.055);
    screen.style.setProperty("--glitch", strength * effects.glitch / 100);
    screen.style.setProperty("--roll-speed", `${14 - effects.roll * 0.12}s`);
    for (const key of ["shimmer", "glitch", "roll"]) screen.setAttribute(`data-${key}`, String(motionAllowed() && effects[key] > 0 && strength > 0));
    const cyberEnabled = effects.cyberpunk && effects.cyberAmount > 0 && strength > 0;
    screen.setAttribute("data-cyber", String(cyberEnabled));
    screen.setAttribute("data-cyber-motion", String(cyberEnabled && motionAllowed()));
    screen.style.setProperty("--cyber-duration", `${NeonEffects.cyberDuration(effects)}s`);
    screen.style.setProperty("--cyber-amount", strength * effects.cyberAmount / 100);
    screen.style.setProperty("--cyber-shift", `${effects.cyberAmount / 100 * strength * 24}px`);
    screen.style.setProperty("--cyber-rest", strength * effects.cyberAmount / 100 * 0.22);
    screen.style.setProperty("--cyber-rest-shift", `${effects.cyberAmount / 100 * strength * 4}px`);
    screen.style.setProperty("--cyber-tint", effects.cyberSplit / 100 * 0.7);
    screen.style.setProperty("--cyber-band", effects.cyberSplit / 100 * 0.85);
    screen.style.setProperty("--cyber-hue", `${effects.cyberSplit / 100 * 70}deg`);
    mount();
    observer.observe(document.documentElement, { childList: true });
  }

  function apply(values) {
    if ("effects" in values) effects = NeonEffects.normalize(values.effects);
    for (const key of ["targeting", "scope", "target"]) if (key in values) targetSettings[key] = values[key];
    targeting = NeonTargets.normalize(targetSettings);
    if ("mode" in values) mode = values.mode === "scanlines" ? "scanlines" : "aperture";
    if (typeof values.enabled === "boolean") enabled = values.enabled;
    if (typeof values.intensity === "number" && Number.isFinite(values.intensity)) {
      intensity = Math.max(0, Math.min(100, values.intensity));
    }
    render();
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    const values = {};
    if (changes.enabled) values.enabled = changes.enabled.newValue ?? false;
    if (changes.intensity) values.intensity = changes.intensity.newValue ?? 65;
    if (changes.mode) values.mode = changes.mode.newValue ?? "aperture";
    if (changes.effects) values.effects = changes.effects.newValue ?? {};
    if (changes.scope) values.scope = changes.scope.newValue ?? "page";
    if (changes.target) values.target = changes.target.newValue ?? null;
    if (changes.targeting) values.targeting = changes.targeting.newValue ?? { wholePage: false, images: false, types: [] };
    if (!initialized) Object.assign(pendingChanges, values);
    apply(values);
  });
  chrome.storage.local.get({ enabled: false, intensity: 65, mode: "aperture", scope: "page", target: null, targeting: null, effects: {} }).then(values => {
    initialized = true;
    apply({ ...values, ...pendingChanges });
  }).catch(() => {});

  // Restore cached documents and refresh absolute SVG references after route changes.
  window.addEventListener("pageshow", () => render());
  window.addEventListener("popstate", () => render());
  window.addEventListener("hashchange", () => render());
  document.addEventListener("visibilitychange", () => render());
  reducedMotion.addEventListener("change", () => render());

  document.addEventListener("fullscreenchange", () => {
    if (!enabled || !targeting.wholePage || !host) return;
    try { host.hidePopover(); } catch { /* Already closed. */ }
    mount();
  });
})();
