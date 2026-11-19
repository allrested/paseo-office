// PASEO: which weather the scene draws for what the host sent. Pure, no scene in it, so
// client/world/weather-plan.test.ts runs it. The host's server reads the weather service and
// resolves the setting; the scene gets only this.

/**
 * The weather of a season, for the host's "follow the season". Upstream has no weather by season:
 * this is Paseo's. A season not named here draws clear weather, which is no weather.
 */
export const SEASON_WEATHER = { halloween: { code: 3, temp: null, cloud: 0.9 } };

const share = (value) => (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0);

/**
 * What to draw for `scene` ({ kind: 'none' | 'season' | 'reading', code, temp, cloud }) in the
 * scene's own `season`: { code, temp, cloud } or null for no weather. A code that is not a whole
 * number from 0 to 99 draws none.
 */
export function weatherToDraw(scene, season) {
  if (!scene || typeof scene !== 'object') return null;
  if (scene.kind === 'season') return SEASON_WEATHER[season] ? { ...SEASON_WEATHER[season] } : null;
  if (scene.kind !== 'reading') return null;
  const { code } = scene;
  if (!Number.isInteger(code) || code < 0 || code > 99) return null;
  return { code, temp: Number.isFinite(scene.temp) ? scene.temp : null, cloud: share(scene.cloud) };
}
