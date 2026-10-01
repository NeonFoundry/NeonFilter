// Shared by the popup, service worker, and content script.
globalThis.NeonTargets = {
  site(url) {
    try { const parsed = new URL(url); return parsed.origin === "null" ? parsed.href.split("#")[0] : parsed.origin; }
    catch { return url; }
  },
  normalize(settings = {}) {
    if (settings.targeting) {
      const saved = settings.targeting;
      const types = [];
      for (const entry of Array.isArray(saved.types) ? saved.types : []) {
        if (!entry || typeof entry.url !== "string" || !/^[a-z][a-z0-9-]*$/.test(entry.tagName)) continue;
        const url = this.site(entry.url);
        const existing = types.find(item => item.url === url && item.tagName === entry.tagName);
        if (existing) { existing.enabled ||= entry.enabled !== false; continue; }
        types.push({ url, tagName: entry.tagName, enabled: entry.enabled !== false });
      }
      return { wholePage: saved.wholePage === true, images: saved.images === true, types };
    }
    const target = settings.target;
    return {
      wholePage: !["images", "element"].includes(settings.scope),
      images: settings.scope === "images",
      types: target?.tagName ? [{ url: this.site(target.url), tagName: target.tagName, enabled: true }] : []
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
      const entry = next.types.find(item => item.url === url && item.tagName === change.tagName);
      if (change.action === "addType") {
        if (entry) entry.enabled = true;
        else next.types.push({ url, tagName: change.tagName, enabled: true });
        next.wholePage = false;
      } else if (entry) entry.enabled = Boolean(change.enabled);
    } else throw new Error("Unknown target change");
    return next;
  },
  selector(targeting, url) {
    const tags = new Set(targeting.images ? ["img"] : []);
    for (const entry of targeting.types) if (entry.enabled && this.site(entry.url) === this.site(url)) tags.add(entry.tagName);
    if (!tags.size) return "";
    const group = `:is(${[...tags].map(tag => CSS.escape(tag)).join(", ")})`;
    // Apply once across ALL selected types, including img nested inside div.
    return `${group}:not(${group} ${group})`;
  }
};
