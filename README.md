![GitHub release](https://img.shields.io/github/v/release/NeonFoundry/NeonFilter?style=for-the-badge&color=FF06B5)
![License](https://img.shields.io/github/license/NeonFoundry/NeonFilter?style=for-the-badge)
![JavaScript](https://img.shields.io/badge/JavaScript-ES6+-F7DF1E?style=for-the-badge&logo=javascript&logoColor=000000)
![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white)
![Manifest](https://img.shields.io/badge/Manifest-V3-FF06B5?style=for-the-badge&logo=googlechrome&logoColor=white)

# Neon Filter — CRT

A build-free Chrome extension that puts scanlines, RGB phosphor texture, a soft glow, and curved-screen shading over the entire webpage viewport. The toolbar popup has a current-tab power switch and a live intensity slider. Preferences persist locally across browser restarts. Each newly opened document starts switched off; changing controls affects only the current tab.

## Install

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode** in the top-right corner.
3. Click **Load unpacked** and select this folder (the one containing `manifest.json`).
4. Pin **Neon Filter — CRT** from Chrome's extensions menu.
5. Click its toolbar button and turn on **CRT display**.

The extension accesses a page only when you open its toolbar popup. After reloading or navigating to a new document, reopen the popup and switch the filter on. After editing the extension, click Reload on its card and refresh previously filtered webpages.

## Behavior and limits

- **Images** and picked element types are additive. Enable Images, then use **Add element type** as often as you like. Each pick adds its HTML tag to the saved list without replacing earlier picks. Selecting the same tag on the same page again re-enables the existing entry without creating a duplicate.
- Fresh installs start with **Whole page** unchecked and **Images** checked.
- Each saved type has an independent checkbox. Turning it off keeps it in the list; **Clear types** removes the saved list while retaining the Images setting. Choices persist across popup closure, refreshes, and browser restarts. Previous image and element-type settings are migrated automatically.
- **Whole page** temporarily covers everything with one overlay, keeping the Images and type choices saved. Turn it off to resume those choices. Enabling Images or adding a type turns Whole page off so you can see the targeted result. The main power switch pauses effects in the current tab without clearing preferences.
- Images covers standard `<img>` elements (including `<picture>` and lazy-loaded images) in the main document. For backgrounds, canvas viewers, or other containers, click **Add element type**, hover, and click. Picking a `<canvas>` filters every canvas on that page; picking a `<div id="main">` targets `#main`, while a div without an id falls back to filtering every div. Press **Up arrow** to pick the parent type, **Enter** to confirm, or **Esc** to cancel. The picker names the target before selection.
- Picked types apply across their saved site (same origin), shown beneath each entry. Existing page-specific picks automatically become site-wide and duplicate types are merged. Images applies across sites. New matching elements are automatically covered. Overlapping selections receive the effect once through their outermost matching ancestor; turning off a child's type cannot exclude it from an enabled container's effect. Effects replace matching elements' CSS filters while active and restore site styling when disabled. Zero intensity leaves styling unchanged.
- Shadow DOM and frame internals are not individually targeted; the picker selects the outer widget/frame. Very old single-element selectors without a saved tag need to be picked again.
- Choose **Aperture grille** for the original fine RGB texture or **Scanlines** for darker, wider horizontal bands. The preview updates with your choice; style and intensity are saved as preferences and applied only to the tab being controlled. Existing installations keep the aperture grille style.
- The overlay stays fixed while you scroll and does not intercept clicks, selection, or typing. Switching off removes it entirely.
- Motion is off by default. **Shimmer**, **Glitches**, and **Scanline drift** add optional animation; reduced-motion system settings and hidden tabs pause it. Master power and zero intensity disable all effects.
- Webpage content, including embedded frames, is covered by one top-level overlay. Fullscreen changes re-promote the overlay; browser-controlled video modes such as picture-in-picture are outside the page.
- Chrome's toolbar, internal pages, Chrome Web Store, and built-in PDF viewer cannot be filtered. Local HTML files require **Allow access to file URLs** in the extension's details.
- The CRT curvature is simulated with shading; this does not geometrically warp page content.
- Uses only `activeTab`, `scripting`, and `storage` permissions. No blanket host access, automatic content scripts, navigation monitoring permission, dependencies, analytics, remote code, or network requests. Page access is granted when you invoke the extension, as described in [Chrome activeTab documentation](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab).

## CRT tuning

Use **Clean**, **Arcade**, or **Worn tube** to set a starting point, then adjust **CRT tuning**. Presets change display settings and screen style, keeping your targets and master intensity. **Reset tuning** restores static default tuning without clearing targets.

**Cyberpunk glitch** is a separate opt-in checkbox with **Tearing strength**, **Burst frequency** (shown as seconds between bursts), and **Colour splitting**. Images and selected types get horizontal displacement with animated red/cyan separation; Whole page gets moving cyan/magenta distortion bands. It combines with existing CRT effects. Turning it off preserves its sliders; CRT presets also preserve cyberpunk settings. Reset tuning switches it off and restores its sliders. Reduced motion, hidden tabs, zero intensity, and the master power switch suppress the animation.

- **Scanline spacing / darkness:** control line pitch and contrast independently.
- **Bloom / glow, Softness, Colour strength:** tune the phosphor-like halo, sharpness, and saturation.
- **RGB separation:** offset colour channels on images and selected element types. This control does not alter whole-page mode.
- **Edge shading:** adjust the whole-page vignette; it does not shade individual targets.
- **Shimmer:** subtle brightness variation, **Glitches:** intermittent image displacement (or a distortion band in whole-page mode), **Scanline drift:** slow moving scanlines.

Image/type mode uses an SVG filter chain for bloom, channel separation, and animation. Whole-page mode uses a viewport overlay and backdrop filters; its glow is an approximation. These are emulator-inspired visual effects, not MAME's renderer, physical tube emulation, or geometric curvature. The popup preview illustrates style, spacing, darkness, and glow; inspect the webpage for the full effect. For context, see [MAME's HLSL controls](https://docs.mamedev.org/advanced/hlsl.html).

Full navigation or reload requires reopening the popup and switching on again. In-document route changes refresh filter references locally while enabled; cached back/forward documents retain their own state. Local-file picks remain specific to that file. Saved site targeting rules do not grant access to other tabs or pages.

## Quick verification

Load unpacked, open two ordinary websites, and enable the filter from the popup in one tab. Only that tab should change. Enable the second tab separately, then change intensity or power in the first and confirm the second is unchanged. Scroll, click links, type in a field, reload a tab, and reopen the popup. Confirm preferences persist but the new document starts off. Turn on, then off, and confirm the effect disappears. Check fullscreen video separately on your preferred sites.

Pick a type on one page, navigate to another page on the same site, and test back/forward. Try a preset and the tuning sliders in both Whole page and targeted modes. Run automated checks with `node --test tests/*.test.cjs`.

Implementation reference: [Chrome content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts).

Image mode uses a local SVG filter with [tiled filter primitives](https://www.w3.org/TR/SVG11/filters.html), without downloading or copying image data.
