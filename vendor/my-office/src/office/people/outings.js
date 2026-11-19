// PASEO: stand-in for my-office's people/outings.js, which Paseo does not take: its trips go down to the street.
// The scenes taken from my-office ask it who is free to go (resting), who has work (called) and to put someone
// back at the desk (resume): those three are upstream's own (outings.js, at the vendored commit). There is no
// street: street() is null, so a scene that has a street half (life/drill.js) plays its office half.
import { state } from '../core/state.js';
import { rand } from '../core/env.js';
import { sessions } from './workers.js';
import { ANIM_AT, verb } from '../ui/event-text.js';
import { t as tr } from '../../i18n/index.js';

export function updateOutings() {}
export const street = () => null;
export const mainExit = () => null;
export function outside() {}
export function walk(w, S, pts, cb) { cb(); }
export const resting = (w) => !w.sub && w.root.parent && !w.leaving && !w.away && !w.homeBound && !w.chore && !w.after && !w.want && w.phase !== 'walk'
  && !w.liftHold && !w.liftWait && !w.inStall && !w.wcBusy && !w.queued && w.anim === 'sleep' && w.station === 'desk'
  && sessions.get(w.id)?.status === 'rest' && !sessions.get(w.id)?.bg?.length;
export const called = (w) => { const s = sessions.get(w.id); return !!w.want || !s || s.status !== 'rest' || !!s.bg?.length; };
export function resume(w, item) {
  const s = sessions.get(w.id);
  w.station = 'desk';
  if (s?.status === 'wait') { w.anim = 'hand'; w.say('wait', tr('people.needsApproval'), 'wait'); }
  else if (s?.bg?.length) { w.anim = 'think'; w.say('bash', tr('people.bgWait', { desc: s.bg[0].desc })); }
  else if (s?.status === 'work') { w.anim = ANIM_AT.desk; if (s.last) w.say(s.last.type, s.last.label || verb(s.last)); }
  else if (item && w.P.held[item]) { w.anim = 'coffee'; w.restAt = state.sim + (item === 'cup' ? rand(25, 45) : rand(40, 75)); w.dwellUntil = state.sim + 2; }
  else if (item) { w.carry = null; w.anim = 'tidy'; w.restAt = state.sim + 3; w.dwellUntil = state.sim + 2; }
  else { w.anim = 'sleep'; w.hush(); }
}
