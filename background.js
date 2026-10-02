importScripts("targets.js");

// Serialize read/modify/write operations so picks from different tabs accumulate.
let targetUpdates = Promise.resolve();
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message.type !== "neon-update-targets") return;
  const update = targetUpdates.then(async () => {
    const settings = await chrome.storage.local.get(["targeting", "scope", "target"]);
    const targeting = NeonTargets.update(settings, message.change);
    await chrome.storage.local.set({ targeting });
    return targeting;
  });
  targetUpdates = update.catch(() => {});
  update.then(targeting => respond({ ok: true, targeting }), () => respond({ ok: false }));
  return true;
});

// Clear the old global power badge when upgrading from all-tabs mode.
chrome.runtime.onInstalled.addListener(() => {
  void chrome.action.setBadgeText({ text: "" });
});
