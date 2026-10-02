let currentTabId;
async function sendToTab(message) {
  if (currentTabId === undefined) throw new Error("No active tab");
  const response = await chrome.tabs.sendMessage(currentTabId, message, { frameId: 0 });
  if (!response?.ok) throw new Error("Page unavailable");
  return response;
}
async function saveSettings(values) {
  const { enabled, ...preferences } = values;
  // Start both operations before the popup can close during a slider adjustment.
  await Promise.all([
    sendToTab({ type: "neon-apply", values }),
    Object.keys(preferences).length ? chrome.storage.local.set(preferences) : Promise.resolve()
  ]);
}

const power = document.querySelector("#power");
const slider = document.querySelector("#intensity");
const value = document.querySelector("#value");
const status = document.querySelector("#status");
const error = document.querySelector("#error");
const modePicker = document.querySelector("#mode-picker");
const modeOptions = document.querySelectorAll('input[name="mode"]');
let savedMode = "aperture";
const scopePicker = document.querySelector("#scope-picker");
const pickElement = document.querySelector("#pick-element");
const wholePage = document.querySelector("#whole-page");
const includeImages = document.querySelector("#include-images");
const targetList = document.querySelector("#target-list");
const clearTypes = document.querySelector("#clear-types");
let savedTargeting = NeonTargets.normalize();
const effectsControls = document.querySelector("#effects-controls");
const resetEffects = document.querySelector("#reset-effects");
const cyberToggle = document.querySelector("#cyberpunk");
const cyberControls = document.querySelector("#cyber-controls");
let savedEffects = NeonEffects.normalize();
const effectLabels = { spacing: "Scanline spacing", darkness: "Scanline darkness", bloom: "Bloom / glow", softness: "Softness", color: "Colour strength", rgb: "RGB separation", vignette: "Edge shading", shimmer: "Shimmer", glitch: "Glitches", roll: "Scanline drift", cyberAmount: "Tearing strength", cyberFrequency: "Burst frequency", cyberSplit: "Colour splitting" };
for (const [key, labelText] of Object.entries(effectLabels)) {
  const row = document.createElement("div");
  row.className = "slider-label";
  const label = document.createElement("label");
  label.htmlFor = `effect-${key}`;
  label.textContent = labelText;
  const output = document.createElement("output");
  output.id = `value-${key}`;
  output.setAttribute("for", `effect-${key}`);
  row.append(label, output);
  const input = document.createElement("input");
  input.id = `effect-${key}`;
  input.type = "range";
  input.min = key === "spacing" ? 2 : key === "cyberFrequency" ? 1 : 0;
  input.max = key === "spacing" ? 8 : 100;
  input.step = key === "spacing" ? 0.5 : 1;
  input.addEventListener("input", () => {
    renderEffects({ ...savedEffects, [key]: Number(input.value) });
    saveSettings({ effects: savedEffects }).catch(showError);
  });
  (key.startsWith("cyber") ? cyberControls : effectsControls).append(row, input);
}

cyberToggle.addEventListener("change", async () => {
  cyberToggle.disabled = true;
  try {
    const effects = { ...savedEffects, cyberpunk: cyberToggle.checked };
    await saveSettings({ effects });
    renderEffects(effects);
    error.hidden = true;
  } catch { renderEffects(savedEffects); showError(); }
  finally { cyberToggle.disabled = false; }
});

function renderEffects(values) {
  savedEffects = NeonEffects.normalize(values);
  cyberToggle.checked = savedEffects.cyberpunk;
  cyberControls.disabled = !savedEffects.cyberpunk;
  for (const [key, value] of Object.entries(savedEffects)) {
    if (key === "cyberpunk") continue;
    document.querySelector(`#effect-${key}`).value = value;
    document.querySelector(`#value-${key}`).textContent = key === "cyberFrequency" ? `Every ${NeonEffects.cyberDuration(savedEffects).toFixed(1)}s` : key === "spacing" ? `${value}px` : value === 0 ? "Off" : `${value}%`;
  }
  for (const button of document.querySelectorAll("[data-preset]")) {
    button.setAttribute("aria-pressed", String(Object.entries(NeonEffects.presets[button.dataset.preset]).every(([key, value]) => savedEffects[key] === value)));
  }
  document.body.style.setProperty("--preview-spacing", `${savedEffects.spacing}px`);
  document.body.style.setProperty("--preview-darkness", savedEffects.darkness / 100 * 0.95);
  document.body.style.setProperty("--preview-line", `${savedEffects.spacing * 0.4}px`);
  document.body.style.setProperty("--preview-glow", `${savedEffects.bloom / 100 * 24}px`);
}

for (const button of document.querySelectorAll("[data-preset]")) button.addEventListener("click", async () => {
  const effects = { ...savedEffects, ...NeonEffects.presets[button.dataset.preset] };
  const mode = button.dataset.preset === "clean" ? "aperture" : "scanlines";
  try { await saveSettings({ effects, mode }); renderEffects(effects); renderMode(mode); error.hidden = true; }
  catch { showError(); }
});
resetEffects.addEventListener("click", async () => {
  try { await saveSettings({ effects: NeonEffects.defaults }); renderEffects(NeonEffects.defaults); error.hidden = true; }
  catch { showError(); }
});

function renderTargets(targeting) {
  savedTargeting = targeting;
  wholePage.checked = targeting.wholePage;
  includeImages.checked = targeting.images;
  targetList.replaceChildren();
  for (const entry of targeting.types) {
    const label = document.createElement("label");
    label.className = "target-toggle";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = entry.enabled;
    input.addEventListener("change", () => void updateTargets({ action: "toggleType", url: entry.url, tagName: entry.tagName, id: entry.id, enabled: input.checked }));
    const text = document.createElement("span");
    text.textContent = entry.id ? `#${entry.id}` : `<${entry.tagName}>`;
    const page = document.createElement("small");
    try { const url = new URL(entry.url); page.textContent = url.host ? `${url.host} · All pages` : url.pathname; }
    catch { page.textContent = entry.url; }
    page.title = entry.url;
    text.append(page);
    label.append(input, text);
    targetList.append(label);
  }
  if (!targeting.types.length) {
    const empty = document.createElement("p");
    empty.className = "empty-targets";
    empty.textContent = "No types yet. Pick an element to add its type.";
    targetList.append(empty);
  }
  clearTypes.disabled = !targeting.types.length;
  document.querySelector("#scope-description").textContent = targeting.wholePage
    ? "Whole page is on. Your image and type choices stay saved."
    : "Images and enabled types work together. Saved types are available across their site when you activate a tab.";
}

async function updateTargets(change) {
  scopePicker.disabled = true;
  try {
    const result = await chrome.runtime.sendMessage({ type: "neon-update-targets", change });
    if (!result?.ok) throw new Error("Couldn't save targets");
    await sendToTab({ type: "neon-apply", values: { targeting: result.targeting } });
    renderTargets(result.targeting);
    error.hidden = true;
  } catch { renderTargets(savedTargeting); showError(); }
  finally { scopePicker.disabled = false; }
}

wholePage.addEventListener("change", () => void updateTargets({ action: "wholePage", enabled: wholePage.checked }));
includeImages.addEventListener("change", () => void updateTargets({ action: "images", enabled: includeImages.checked }));
clearTypes.addEventListener("click", () => void updateTargets({ action: "clearTypes" }));

function renderMode(mode) {
  savedMode = mode === "scanlines" ? "scanlines" : "aperture";
  document.body.dataset.mode = savedMode;
  for (const option of modeOptions) option.checked = option.value === savedMode;
  document.querySelector("#mode-description").textContent = savedMode === "scanlines"
    ? "Bold horizontal lines with wider spacing."
    : "Fine RGB phosphor texture.";
}

function renderEnabled(enabled) {
  power.setAttribute("aria-checked", String(enabled));
  document.body.dataset.enabled = String(enabled);
  status.textContent = enabled ? "On for this tab." : "Ready for this tab.";
}
function renderIntensity(intensity) {
  slider.value = intensity;
  value.textContent = `${intensity}%`;
  document.body.style.setProperty("--preview-strength", intensity / 100);
}
function showError() {
  error.textContent = "Couldn't save settings. Close and reopen the extension to retry.";
  error.hidden = false;
}

power.addEventListener("click", async () => {
  const enabled = power.getAttribute("aria-checked") !== "true";
  power.disabled = true;
  try {
    await saveSettings({ enabled });
    renderEnabled(enabled);
    error.hidden = true;
  } catch { showError(); }
  finally { power.disabled = false; }
});
slider.addEventListener("input", () => {
  const intensity = Number(slider.value);
  renderIntensity(intensity);
  // Write immediately so closing the popup cannot discard a pending adjustment.
  saveSettings({ intensity }).catch(showError);
});
modePicker.addEventListener("change", async (event) => {
  const mode = event.target.value;
  if (mode !== "aperture" && mode !== "scanlines") return;
  modePicker.disabled = true;
  try {
    await saveSettings({ mode });
    renderMode(mode);
    error.hidden = true;
  } catch {
    renderMode(savedMode);
    showError();
  } finally { modePicker.disabled = false; }
});
pickElement.addEventListener("click", async () => {
  pickElement.disabled = true;
  try {
    const response = await sendToTab({ type: "neon-pick-element" });
    if (!response?.ok) throw new Error("Picker unavailable");
    window.close();
  } catch {
    error.textContent = "Can't select here. Refresh the webpage after reloading the extension, then try again. Chrome internal pages are excluded.";
    error.hidden = false;
  } finally { pickElement.disabled = false; }
});
async function initialize() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined) throw new Error("No active tab");
  currentTabId = tab.id;
  await chrome.scripting.executeScript({
    target: { tabId: currentTabId }, files: ["targets.js", "effects.js", "content.js"]
  });
  const { settings } = await sendToTab({ type: "neon-get-state" });
  renderEnabled(settings.enabled);
  renderIntensity(settings.intensity);
  renderMode(settings.mode);
  renderTargets(NeonTargets.normalize(settings));
  renderEffects(settings.effects);
  power.disabled = false;
  slider.disabled = false;
  modePicker.disabled = false;
  scopePicker.disabled = false;
  effectsControls.disabled = false;
  resetEffects.disabled = false;
  cyberToggle.disabled = false;
  for (const button of document.querySelectorAll("[data-preset]")) button.disabled = false;
}
initialize().catch(() => {
  status.textContent = "Unavailable on this page.";
  error.textContent = "Open a regular webpage and reopen Neon Filter. Chrome internal pages, the Web Store, and protected viewers cannot be filtered.";
  error.hidden = false;
});
