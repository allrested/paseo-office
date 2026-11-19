// PASEO: stand-in for my-office's ui/group-chat.js (its chat window), which Paseo does not take. What the office's
// people say in the group chat goes to the host as a kind and a few words (host.life); the office's server words it
// (shared/life-lines.ts). A line the games say in their own words (chatSay) still goes nowhere.
import { host } from '../paseo-host.js';

const sent = new Map();
export function chatLife(kind, vars = {}) {
  const out = {};
  for (const [k, v] of Object.entries(vars)) if (v != null && typeof v !== 'object') out[k] = String(v).slice(0, 200);
  // upstream's once per period (v.every, 20 minutes unless said), per kind and person; the server keys it the same way
  const key = `${kind}:${out.id || ''}`, every = Number(out.every) || 20 * 60e3, now = Date.now();
  if ((sent.get(key) || 0) > now) return;
  if (sent.size > 200) for (const [k, until] of sent) if (until <= now) sent.delete(k);
  sent.set(key, now + every);
  host.life(kind, out);
}
export function chatSay() {}
// (the chat does not keep a picture: the office's server drops a photo's data)
export function chatPhoto() { return null; }
