// PASEO: stand-in for my-office's ui/settings.js, which Paseo does not take. Upstream's popover holds the time buttons,
// the switches and the tour's button; Paseo has none of them. What stays is what other modules call.
import { state } from '../core/state.js';
import { host } from '../paseo-host.js';
import { night } from '../world/room-update.js';
import { applyNight, holdNight } from '../world/backdrops/index.js';

/**
 * Upstream's 'auto' follows the clock; Paseo's follows the app's theme (the scene is lit by night while the app is dark).
 * 'day' and 'night' hold against the theme: only photo mode's buttons and the clip ask for them, and photo mode's end
 * asks for 'auto' again (ui/photo.js).
 */
export function setTimeMode(mode) {
  if (mode === 'day' || mode === 'night') holdNight(mode === 'night');
  else applyNight(host.night);
}
/** Photo mode's Auto, Day and Night show the light the scene is in; world/room-update.js setNight calls this, so a theme change during a held photo shows Auto again. */
export function syncTimeBtns() {
  const mode = state.nightManual ? (night ? 'night' : 'day') : 'auto';
  for (const b of document.querySelectorAll('[data-ph-time]')) b.setAttribute('aria-pressed', String(b.dataset.phTime === mode));
}
export function syncToggles() {}
/** Upstream's settings popover: there is none here (its tour button, `#btn-tips`, is not in the page either). */
export function togglePop() {}
