// PASEO: the host supplies the backdrop preference and the app's day or night theme.
import * as THREE from '../../../../three/three.module.min.js';
import { state } from '../../core/state.js';
import { scene } from '../../scene/renderer.js';
import { buildCity } from './city.js';
import { buildCountry } from './countryside.js';
import { buildBeach } from './beach.js';
import { cityDay, cityNight, viewTex } from '../windows.js';
import { night, setNight } from '../room-update.js';
import { buildGrid, fp } from '../../interact/first-person.js';
import { host } from '../../paseo-host.js';

export let THEMES;
export let THEME;

/** The plain backdrop and the far haze take the app's surface colour. */
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
/** Build the chosen landscape and its two window views on first use. */
export function setScene(name, apply = true) {
  const t = THEMES[name] || THEMES.plain;
  if (t.build && !t.group) { t.group = new THREE.Group(); t.group.userData.noMerge = true; scene.add(t.group); t.live = t.build(t.group); t.live.night(night); }
  if (!t.wins) t.wins = [viewTex(t.view, false), viewTex(t.view, true)];
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
    countryside: { build: buildCountry, fog: ['#D6E4D3', '#14222C'], view: 'country' },
    beach: { build: buildBeach, fog: ['#D2E6F1', '#12223A'], view: 'beach' },
  };
  setScene(host.scene, false);
  applyNight(host.night);
}
