globalThis.NeonEffects = {
  defaults: { spacing: 4, darkness: 65, bloom: 15, softness: 15, color: 30, rgb: 0, vignette: 65, shimmer: 0, glitch: 0, roll: 0, cyberpunk: false, cyberAmount: 55, cyberFrequency: 35, cyberSplit: 60 },
  presets: {
    clean: { spacing: 3, darkness: 35, bloom: 8, softness: 5, color: 15, rgb: 0, vignette: 25, shimmer: 0, glitch: 0, roll: 0 },
    arcade: { spacing: 4, darkness: 75, bloom: 35, softness: 18, color: 45, rgb: 20, vignette: 75, shimmer: 12, glitch: 0, roll: 8 },
    worn: { spacing: 5, darkness: 80, bloom: 45, softness: 32, color: 25, rgb: 40, vignette: 85, shimmer: 45, glitch: 50, roll: 25 }
  },
  normalize(values = {}) {
    return Object.fromEntries(Object.entries(this.defaults).map(([key, fallback]) => {
      const value = values?.[key];
      if (key === "cyberpunk") return [key, value === true];
      return [key, typeof value === "number" && Number.isFinite(value)
        ? Math.max(key === "spacing" ? 2 : key === "cyberFrequency" ? 1 : 0, Math.min(key === "spacing" ? 8 : 100, value)) : fallback];
    }));
  },
  cyberDuration(effects) { return 12 - effects.cyberFrequency * 0.095; },
  // Native SVG primitives keep filters attached to images/canvas without copying pixels.
  primitives(node, effects, mode, strength, motion) {
    const period = effects.spacing;
    const tile = { x: 0, y: 0, width: period, height: period };
    const primitives = [node("feFlood", { ...tile, "flood-color": "white", result: "paper" })];
    const merge = node("feMerge", { ...tile, result: "tile" });
    merge.append(node("feMergeNode", { in: "paper" }));
    if (mode === "aperture") {
      for (const [index, color] of ["#ffb8c0", "#b8ffce", "#bdc8ff"].entries()) {
        primitives.push(node("feFlood", { x: index * period / 3, y: 0, width: period / 3, height: period,
          "flood-color": color, "flood-opacity": strength * 0.22, result: `rgb${index}` }));
        merge.append(node("feMergeNode", { in: `rgb${index}` }));
      }
    }
    const darkness = strength * effects.darkness / 100 * (mode === "scanlines" ? 0.95 : 0.55);
    primitives.push(node("feFlood", { ...tile, height: period * (mode === "scanlines" ? 0.4 : 0.25),
      "flood-color": "black", "flood-opacity": darkness, result: "line" }));
    merge.append(node("feMergeNode", { in: "line" }));
    primitives.push(merge, node("feTile", { in: "tile", x: "0%", y: "0%", width: "100%", height: "100%", result: "texture" }));
    let texture = "texture";
    if (motion && effects.roll > 0 && strength > 0) {
      const roll = node("feOffset", { in: "texture", dy: 0, result: "rolling" });
      roll.append(node("animate", { attributeName: "dy", values: `0;${period}`, dur: `${14 - effects.roll * 0.12}s`, repeatCount: "indefinite" }));
      primitives.push(roll); texture = "rolling";
    }
    primitives.push(node("feGaussianBlur", { in: "SourceGraphic", stdDeviation: strength * effects.softness / 100 * 1.5, result: "soft" }),
      node("feColorMatrix", { in: "soft", type: "saturate", values: 1 + strength * effects.color / 100, result: "color" }));
    let source = "color";
    if (effects.rgb > 0 && strength > 0) {
      for (const [index, channel] of ["red", "green", "blue"].entries()) {
        const matrix = [0, 1, 2].map(row => [0, 1, 2, 3, 4].map(col => row === index && col === index ? 1 : 0).join(" ")).join(" ") + " 0 0 0 1 0";
        primitives.push(node("feColorMatrix", { in: "color", type: "matrix", values: matrix, result: channel }));
        primitives.push(node("feOffset", { in: channel, dx: (index - 1) * effects.rgb / 100 * strength * 3, result: `${channel}Shift` }));
      }
      primitives.push(node("feBlend", { in: "redShift", in2: "greenShift", mode: "screen", result: "rg" }),
        node("feBlend", { in: "rg", in2: "blueShift", mode: "screen", result: "converged" }));
      source = "converged";
    }
    if (effects.bloom > 0 && strength > 0) {
      primitives.push(node("feGaussianBlur", { in: source, stdDeviation: 2.5, result: "halo" }));
      const dim = node("feComponentTransfer", { in: "halo", result: "dimHalo" });
      for (const channel of ["R", "G", "B"]) dim.append(node(`feFunc${channel}`, { type: "linear", slope: effects.bloom / 100 * strength * 0.6 }));
      primitives.push(dim, node("feBlend", { in: source, in2: "dimHalo", mode: "screen", result: "bloom" }));
      source = "bloom";
    }
    if (motion && effects.shimmer > 0 && strength > 0) {
      const shimmer = node("feComponentTransfer", { in: source, result: "shimmer" });
      const depth = effects.shimmer / 100 * strength * 0.055;
      for (const channel of ["R", "G", "B"]) {
        const func = node(`feFunc${channel}`, { type: "linear", slope: 1 });
        func.append(node("animate", { attributeName: "slope", values: `1;${1 - depth};1;${1 + depth / 2};1`, dur: "2.7s", repeatCount: "indefinite" }));
        shimmer.append(func);
      }
      primitives.push(shimmer); source = "shimmer";
    }
    if (motion && effects.glitch > 0 && strength > 0) {
      const shift = node("feOffset", { in: source, dx: 0, result: "glitch" });
      const amount = effects.glitch / 100 * strength * 7;
      shift.append(node("animate", { attributeName: "dx", values: `0;0;${amount};${-amount / 2};0;0`, keyTimes: "0;0.86;0.875;0.895;0.915;1", calcMode: "discrete", dur: "7s", repeatCount: "indefinite" }));
      primitives.push(shift); source = "glitch";
    }
    if (effects.cyberpunk && effects.cyberAmount > 0 && strength > 0) {
      const duration = `${this.cyberDuration(effects)}s`;
      const burst = (attributeName, amount) => node("animate", {
        attributeName, values: `0;0;${amount};${-amount * 0.6};${amount * 0.3};0;0`,
        keyTimes: "0;0.7;0.72;0.76;0.8;0.84;1", calcMode: "discrete", dur: duration, repeatCount: "indefinite"
      });
      const amount = strength * effects.cyberAmount / 100;
      const restingTear = amount * 8;
      // Flatten the green displacement channel so tearing moves horizontally only.
      primitives.push(node("feTurbulence", { type: "fractalNoise", baseFrequency: "0.001 0.12", numOctaves: 1, seed: 9, result: "cyberNoise" }),
        node("feColorMatrix", { in: "cyberNoise", type: "matrix", values: "1 0 0 0 0 0 0 0 0 0.5 0 0 1 0 0 0 0 0 1 0", result: "cyberMap" }));
      const tear = node("feDisplacementMap", { in: source, in2: "cyberMap", scale: restingTear, xChannelSelector: "R", yChannelSelector: "G", result: "cyberTear" });
      if (motion) tear.append(burst("scale", amount * 45));
      primitives.push(tear);
      source = "cyberTear";
      if (effects.cyberSplit > 0) {
        primitives.push(node("feColorMatrix", { in: source, type: "matrix", values: "1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0", result: "cyberRed" }),
          node("feColorMatrix", { in: source, type: "matrix", values: "0 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 1 0", result: "cyberCyan" }));
        for (const [channel, direction] of [["Red", -1], ["Cyan", 1]]) {
          const split = direction * amount * effects.cyberSplit / 100;
          const offset = node("feOffset", { in: `cyber${channel}`, dx: split * 1.75, result: `cyber${channel}Shift` });
          if (motion) offset.append(burst("dx", split * 10));
          primitives.push(offset);
        }
        primitives.push(node("feBlend", { in: "cyberRedShift", in2: "cyberCyanShift", mode: "screen", result: "cyberSplit" }));
        source = "cyberSplit";
      }
    }
    primitives.push(node("feBlend", { in: source, in2: texture, mode: "multiply", result: "crt" }),
      node("feComposite", { in: "crt", in2: "SourceAlpha", operator: "in" }));
    return primitives;
  }
};
