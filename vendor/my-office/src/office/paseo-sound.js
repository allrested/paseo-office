// PASEO: the Sound switch's state in the page, and whether the page lets audio start. Upstream's switch is a
// toggle in its settings panel (ui/settings.js), which the port does not take. ui/camera-bar.js draws the
// button from this; paseo-entry.js turns the state into upstream's `sfx.set`. No upstream file is imported.

const listeners = new Set();

export const sound = {
  /** Whether sounds play: what was last asked for (setOn), while audio can start; false wherever it cannot. */
  on: false,
  /**
   * 'idle' until a press has tried to start audio, then 'ready'. 'unsupported': the page has no Web Audio, known at
   * once, and final. 'blocked': the last press did not start a context; the next activating press tries again, so it
   * can still turn 'ready'. 'ready' is final.
   */
  audio: 'idle',
  /** Set by paseo-entry.js: the button asks for the switch to be `next`. */
  request() {},
  /** Calls `listener` whenever `on` or `audio` changes; returns the function that stops it. */
  subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

const emit = () => {
  for (const listener of listeners) listener();
};

/** Whether a press can start audio here, as far as is known. */
export const available = () => sound.audio !== 'blocked' && sound.audio !== 'unsupported';

/** What was last asked for, by the host or a press: kept while audio cannot start, so it applies once it can. */
let wanted = false;

/** `sound.on` from what was asked and whether audio can start; listeners hear a change only. */
function apply() {
  const next = wanted && available();
  if (sound.on === next) return;
  sound.on = next;
  emit();
}

/** The switch, from the host or a press. Only `true` turns it on, and where audio cannot start it stays off. */
export function setOn(on) {
  wanted = on === true;
  apply();
}

function setAudio(audio) {
  if (sound.audio === audio) return;
  sound.audio = audio;
  sound.on = wanted && available();
  emit();
}

/** Run once the probe in flight settles; null while none is. */
let waiting = null;

/** Runs `done` once the probe in flight has settled `sound.audio`, or at once when none is in flight. */
export function whenProbed(done) {
  if (waiting) waiting.push(done);
  else done();
}

/** The last press that started a probe, with what the switch was when it arrived. */
let seen = null;

/**
 * What `on` was, and whether audio could start (`can`), when the press `event` reached the probe: before the probe
 * could change either. Null for an event that started no probe. A press's own probe may end between the window's
 * listener and the pressed element's (a context that already runs settles in the microtasks after the first
 * listener), so an element that asks what its press means must ask this, not the state it finds.
 */
export const before = (event) => (seen && seen.event === event ? seen : null);

const QUIET_KEYS = new Set(['Escape', 'Shift', 'Control', 'Alt', 'AltGraph', 'Meta', 'CapsLock', 'Fn', 'OS']);

/**
 * Finds out whether this page lets audio start. With no Web Audio it is 'unsupported' at once, for good. Otherwise a
 * press that is a real user activation (pointerup, which counts as a gesture on a touch screen where pointerdown does
 * not, or a key; not Escape or a bare modifier, and not while `navigator.userActivation` says there is none) makes a
 * context of its own, asks it to run, and says 'ready' if it runs and 'blocked' if it throws, rejects or has not run
 * within `timeoutMs`. The context is closed after. 'ready' is final and stops listening; 'blocked' is not: the next
 * activating press probes again, so a slow start or a frame that gains audio later is not lost until a reload, and
 * the switch then follows what was last asked for (setOn) with no new ask. Returns the function that stops listening
 * and drops a probe in flight (no state change after it, and what waits on it in `whenProbed` is not run).
 */
export function watchAudio(win = window, timeoutMs = 1500) {
  const contextOf = () => win.AudioContext || win.webkitAudioContext;
  if (!contextOf()) {
    setAudio('unsupported');
    return () => {};
  }
  const events = ['pointerup', 'keydown'];
  let stopped = false;
  let probing = false;
  let cancel = () => {};
  const stop = () => {
    stopped = true;
    cancel();
    for (const type of events) win.removeEventListener(type, onPress, true);
  };
  function onPress(event) {
    if (stopped || probing) return;
    if (event.type === 'keydown' && QUIET_KEYS.has(event.key)) return;
    if (win.navigator?.userActivation && !win.navigator.userActivation.isActive) return;
    seen = { event, on: sound.on, can: available() };
    probe();
  }
  function probe() {
    let context;
    try {
      const Context = contextOf();
      context = new Context();
    } catch {
      setAudio('blocked');
      return;
    }
    probing = true;
    waiting = [];
    let settled = false;
    let timer;
    const finish = () => {
      if (settled) return;
      settled = true;
      probing = false;
      clearTimeout(timer);
      const then = waiting;
      waiting = null;
      if (!stopped) {
        setAudio(context.state === 'running' ? 'ready' : 'blocked');
        if (sound.audio === 'ready') stop();
        for (const done of then) done();
      }
      try {
        Promise.resolve(context.close()).catch(() => {});
      } catch {
        /* already closed */
      }
    };
    cancel = finish;
    timer = setTimeout(finish, timeoutMs);
    try {
      Promise.resolve(context.resume()).then(finish, finish);
    } catch {
      finish();
    }
  }
  for (const type of events) win.addEventListener(type, onPress, true);
  return stop;
}
