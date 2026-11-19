// PASEO: stand-in for my-office's world/backdrops/index.js. Upstream chooses a street, a countryside or a beach by
// localStorage and runs the day and night by the clock; Paseo has the plain backdrop in the app's surface colour, or
// the street when the device asked for it (host.street), and day and night follow the app's theme.
import * as THREE from '../../../../three/three.module.min.js';
import { state } from '../../core/state.js';
import { scene } from '../../scene/renderer.js';
import { buildCity } from './city.js';
import { cityDay, cityNight } from '../windows.js';
import { night, setNight } from '../room-update.js';
import { buildGrid, fp } from '../../interact/first-person.js';
import { host } from '../../paseo-host.js';

export let THEMES;
export let THEME;

/** The plain backdrop and the far haze take the app's surface colour; the street keeps its own sky and fog. */
export function applySurface() {
  if (THEME !== THEMES.plain) return;
  const colour = new THREE.Color(host.surface);
  THEME.sky = colour;
  THEME.fog = [host.surface, host.surface];
  scene.background = colour;
  if (scene.fog) scene.fog.color.copy(colour);
}
/** Night with Paseo's dark theme, day with the light one: never by the clock. */
export function applyNight(on) {
  state.nightManual = false;
  setNight(on);
  applySurface();
}
/** Upstream's setScene, for the two themes: the street is built the first time it is chosen. */
export function setScene(name, apply = true) {
  const t = THEMES[name] || THEMES.plain;
  if (t.build && !t.group) { t.group = new THREE.Group(); t.group.userData.noMerge = true; scene.add(t.group); t.live = t.build(t.group); t.live.night(night); }
  for (const x of Object.values(THEMES)) if (x.group) x.group.visible = x === t;
  THEME = t;
  if (fp.grid) fp.grid = buildGrid();
  if (apply) setNight(night);
}
export function holdNight(on) {
  state.nightManual = true;
  setNight(on);
  applySurface();
}
export function setup() {
  THEMES = {
    plain: { fog: [host.surface, host.surface], wins: [cityDay, cityNight], sky: new THREE.Color(host.surface), live: null },
    city: { build: buildCity, fog: ['#CCD8E4', '#16223E'], wins: [cityDay, cityNight] },
  };
  setScene(host.street ? 'city' : 'plain', false);
  applyNight(host.night);
}
