// PASEO: stand-in for my-office's ui/group-chat.js (its chat window), which Paseo does not take. What the
// office's people would say in the group chat goes to the host as a kind and a few words (host.life); the host's
// server words it. A line the games say with their own words (chatSay) still goes nowhere.
import { host } from '../paseo-host.js';

const sent = new Map();
export function chatLife(kind, vars = {}) {
  const out = {};
  for (const [k, v] of Object.entries(vars)) if (v != null && typeof v !== 'object' && k !== 'photo') out[k] = String(v).slice(0, 200);
  // upstream's own once-per-period rule (v.every) is the server's too: the same kind and period says one line
  const key = `${kind}:${out.id || ''}`;
  const now = Date.now();
  if ((sent.get(key) || 0) > now) return;
  if (sent.size > 200) for (const [k, expiry] of sent) if (expiry <= now) sent.delete(k);
  sent.set(key, now + (Number(out.every) || 20 * 60e3));
  host.life(kind, out);
}
export function chatSay() {}
// (the chat does not keep a picture: the server drops a photo's data)
export function chatPhoto() { return null; }
