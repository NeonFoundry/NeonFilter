// Shared by the popup, service worker, and content script.
globalThis.NeonTargets = {
  site(url) {
    try { const parsed = new URL(url); return parsed.origin === "null" ? parsed.href.split("#")[0] : parsed.origin; }
    catch { return url; }
  },
  id(value) {
    return typeof value === "string" && value.trim() ? value.trim() : "";
  },
  sameTarget(left, right) {
    return left.url === right.url && left.tagName === right.tagName && this.id(left.id) === this.id(right.id);
  },
  targetLabel(entry) {
    const id = this.id(entry.id);
    return id ? `#${id}` : entry.tagName;
  },
  normalize(settings = {}) {
    if (settings.targeting) {
      const saved = settings.targeting;
      const types = [];
      for (const entry of Array.isArray(saved.types) ? saved.types : []) {
        if (!entry || typeof entry.url !== "string" || !/^[a-z][a-z0-9-]*$/.test(entry.tagName)) continue;
        const url = this.site(entry.url);
        const target = { url, tagName: entry.tagName, id: this.id(entry.id), enabled: entry.enabled !== false };
        const existing = types.find(item => this.sameTarget(item, target));
        if (existing) { existing.enabled ||= entry.enabled !== false; continue; }
        types.push(target.id ? target : { url, tagName: target.tagName, enabled: target.enabled });
      }
      return { wholePage: saved.wholePage === true, images: saved.images === true, types };
    }
    const target = settings.target;
    return {
      wholePage: settings.scope === "page",
      images: settings.scope === "images",
      types: target?.tagName ? [this.id(target.id)
        ? { url: this.site(target.url), tagName: target.tagName, id: this.id(target.id), enabled: true }
        : { url: this.site(target.url), tagName: target.tagName, enabled: true }] : []
    };
  },
  update(settings, change) {
    const next = this.normalize(settings);
    if (change.action === "wholePage") next.wholePage = Boolean(change.enabled);
    else if (change.action === "images") {
      next.images = Boolean(change.enabled);
      if (next.images) next.wholePage = false;
    } else if (change.action === "clearTypes") next.types = [];
    else if (["addType", "toggleType"].includes(change.action)) {
      if (typeof change.url !== "string" || !/^[a-z][a-z0-9-]*$/.test(change.tagName)) throw new Error("Invalid element type");
      const url = this.site(change.url);
      const target = { url, tagName: change.tagName, id: this.id(change.id), enabled: true };
      const entry = next.types.find(item => this.sameTarget(item, target));
      if (change.action === "addType") {
        if (entry) entry.enabled = true;
        else next.types.push(target.id ? target : { url, tagName: target.tagName, enabled: true });
        next.wholePage = false;
      } else if (entry) entry.enabled = Boolean(change.enabled);
    } else throw new Error("Unknown target change");
    return next;
  },
  selector(targeting, url) {
    const selectors = new Set(targeting.images ? ["img"] : []);
    for (const entry of targeting.types) {
      if (!entry.enabled || this.site(entry.url) !== this.site(url)) continue;
      selectors.add(this.id(entry.id) ? `#${CSS.escape(this.id(entry.id))}` : CSS.escape(entry.tagName));
    }
    if (!selectors.size) return "";
    const group = `:is(${[...selectors].join(", ")})`;
    // Apply once across ALL selected targets, including img nested inside div.
    return `${group}:not(${group} ${group})`;
  }
};
