// PASEO: stand-in for life/rain.js. The cleaner puts upstream's wet-floor sign beside a freshly mopped aisle.
import * as THREE from '../../../three/three.module.min.js';
import { canvasTex, fitText, mat, put, rbox } from '../scene/blocks.js';
import { t as tr } from '../../i18n/index.js';
export function updateSeason() {}
let wetTex;
export function wetSign() {
  const g = new THREE.Group();
  wetTex ||= canvasTex(160, 256, (c, w, h) => {
    c.fillStyle = '#F5C518'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#1E1E1E'; c.beginPath(); c.moveTo(w / 2, 26); c.lineTo(w - 22, 112); c.lineTo(22, 112); c.closePath(); c.fill();
    c.fillStyle = '#F5C518'; c.font = '900 64px "Be Vietnam Pro", system-ui, sans-serif'; c.textAlign = 'center'; c.fillText('!', w / 2, 102);
    c.fillStyle = '#1E1E1E'; c.font = '800 34px "Be Vietnam Pro", system-ui, sans-serif'; for (const [k, y] of [['life.wetFloor1', 168], ['life.wetFloor2', 208]]) { const s = tr(k); fitText(c, s, w - 16); c.fillText(s, w / 2, y); }
  });
  const yellow = mat('#F5C518', { roughness: 0.5 });
  for (const s of [-1, 1]) {
    const leaf = new THREE.Group(); leaf.position.y = 0.62; leaf.rotation.x = s * 0.2; g.add(leaf);
    put(leaf, rbox(0.3, 0.62, 0.015, yellow, 0.01), 0, -0.31, s * 0.008);
    put(leaf, new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.42), mat('#FFFFFF', { map: wetTex, roughness: 0.6 })), 0, -0.3, s * 0.017).rotation.y = s > 0 ? 0 : Math.PI;
  }
  put(g, rbox(0.06, 0.04, 0.05, '#1E1E1E', 0.01), 0, 0.64, 0);
  return g;
}
