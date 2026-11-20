// PASEO: the duty board the host gives the scene (setDuties: client/world/world-api.ts WorldDuty): what the pantry's
// board shows, and who acts which duty out next. Nothing of the scene is in here, so a test runs it without a browser
// (client/world/duty-plan.test.ts); people/duty.js asks here and moves the people.
//
// The host keeps the list and each day's state. A duty with instructions is an agent's: its holder's figure acts it
// out once. A pretend one (no instructions) is acted out by a free figure, and the scene tells the host it is done.
// A duty waits for a free figure, never for an hour of the day: whoever is idle takes the next one open.

/** The board's rows: { chore, label, name (the holder's, '' while open), at ('✓' once done), busy, owed }. */
export function boardRows(duties, busyId) {
  return duties.map((d) => ({
    chore: d.chore,
    label: d.name,
    name: d.holder?.name ?? '',
    at: d.state === 'done' ? '✓' : '',
    busy: d.id === busyId,
    owed: d.owed,
  }));
}

/** The tooltip's rows, one duty each: { name, who (the holder's name, '' when nobody), state: open | held | done, owed }. */
export function tipRows(duties) {
  return duties.map((d) => ({
    name: d.name,
    who: d.holder?.name ?? '',
    state: d.state === 'done' ? 'done' : d.holder ? 'held' : 'open',
    owed: !!d.owed && d.state !== 'done',
  }));
}

/** The duties in a line (a toast when the board is tapped, the walk-in's label, HR's morning list). */
export function dutyLine(duties, open) {
  return duties.map((d) => {
    const who = d.holder?.name || (d.state === 'done' ? '—' : open);
    return `${d.name}: ${who}${d.state === 'done' ? ' ✓' : ''}`;
  }).join(' · ');
}

/** Whether this duty is one to act out now (not who: see nextJob). The cups wait for a cup in the sink, unless owed. */
function wanted(d, { acted, force, pile }) {
  if (acted.has(d.id)) return false;
  if (d.pretend ? d.state !== 'open' : !d.holder) return false;
  return force || d.owed || d.chore !== 'cups' || pile > 0;
}

/** Who acts it out: its holder's figure; a pretend one, the free figure that has done fewest today. */
function whoFor(d, figures, counts) {
  const ready = figures.filter((f) => f.ready);
  if (!d.pretend) return ready.find((f) => f.id === d.holder.id)?.id ?? null;
  let best = null;
  for (const f of ready) if (best === null || (counts.get(f.id) ?? 0) < (counts.get(best) ?? 0)) best = f.id;
  return best;
}

/**
 * The next duty to act out, owed ones first: { id, who }, or null. `acted`: the duties this page has acted out;
 * `counts`: how many each figure has done today; `figures`: [{ id, ready }] in the floor's order (ready: idle, with
 * nothing else on); `force` (?duty): the cups with an empty sink too; `pile`: the cups in the sink.
 */
export function nextJob({ duties, acted, counts, figures, force, pile }) {
  const order = [...duties.filter((d) => d.owed), ...duties.filter((d) => !d.owed)];
  for (const d of order) {
    if (!wanted(d, { acted, force, pile })) continue;
    const who = whoFor(d, figures, counts);
    if (who !== null) return { id: d.id, who };
  }
  return null;
}
