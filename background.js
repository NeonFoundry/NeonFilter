importScripts("targets.js");

function refreshRoute(details) {
  if (details.frameId !== 0) return;
  chrome.tabs.sendMessage(details.tabId, { type: "neon-navigation" }, { frameId: 0 }).catch(() => {});
}
chrome.webNavigation.onHistoryStateUpdated.addListener(refreshRoute);
chrome.webNavigation.onReferenceFragmentUpdated.addListener(refreshRoute);

// Serialize read/modify/write operations so picks from different tabs accumulate.
let targetUpdates = Promise.resolve();
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message.type !== "neon-update-targets") return;
  const update = targetUpdates.then(async () => {
    const settings = await chrome.storage.local.get(["targeting", "scope", "target"]);
    const targeting = NeonTargets.update(settings, message.change);
    await chrome.storage.local.set({ targeting, ...(message.change.action === "addType" ? { enabled: true } : {}) });
    return targeting;
  });
  targetUpdates = update.catch(() => {});
  update.then(targeting => respond({ ok: true, targeting }), () => respond({ ok: false }));
  return true;
});

async function updateBadge() {
  const { enabled = false } = await chrome.storage.local.get("enabled");
  await chrome.action.setBadgeBackgroundColor({ color: "#176c52" });
  await chrome.action.setBadgeText({ text: enabled ? "ON" : "" });
}

chrome.runtime.onInstalled.addListener(async () => {
  await updateBadge();
  // Declarative scripts cover future navigations; inject into already open tabs too.
  const tabs = await chrome.tabs.query({});
  await Promise.allSettled(tabs.filter(tab => tab.id !== undefined).map(tab =>
    chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["targets.js", "effects.js", "content.js"] })
  ));
});
chrome.runtime.onStartup.addListener(updateBadge);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.enabled) void updateBadge();
});
