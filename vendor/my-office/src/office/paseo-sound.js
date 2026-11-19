// PASEO: the Sound switch's state in the page, and whether the page lets audio start. Upstream's switch is a
// toggle in its settings panel (ui/settings.js), which the port does not take. ui/camera-bar.js draws the
// button from this; paseo-entry.js turns the state into upstream's `sfx.set`. No upstream file is imported.

const listeners = new Set();

export const sound = {
  /** Whether sounds play: the person's choice, and false wherever audio cannot start. */
  on: false,
  /**
   * 'idle' until a press has tried to start audio, then 'ready'. 'unsupported': the page has no Web Audio, known at
   * once. 'blocked': a press did not start a context (a frame that never lets audio start). Neither changes until
   * the page is loaded again.
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

/** The switch, from the host or a press. Only `true` turns it on, and where audio cannot start it stays off. */
export function setOn(on) {
  const next = on === true && available();
  if (sound.on === next) return;
  sound.on = next;
  emit();
}

function setAudio(audio) {
  if (sound.audio === audio) return;
  sound.audio = audio;
  if (!available()) sound.on = false;
  emit();
}

const QUIET_KEYS = new Set(['Escape', 'Shift', 'Control', 'Alt', 'AltGraph', 'Meta', 'CapsLock', 'Fn', 'OS']);

/**
 * Finds out whether this page lets audio start. With no Web Audio it is 'unsupported' at once, for good. Otherwise a
 * press that is a real user activation (pointerup, which counts as a gesture on a touch screen where pointerdown does
 * not, or a key; not Escape or a bare modifier, and not while `navigator.userActivation` says there is none) makes a
 * context of its own, asks it to run, and says 'ready' if it runs and 'blocked' if it throws, rejects or has not run
 * within `timeoutMs`. The context is closed after. 'ready' is final and stops listening; 'blocked' is not: the next
 * activating press probes again, so a slow start or a frame that gains audio later is not lost until a reload.
 * Returns the function that stops listening and drops a probe in flight (no state change after it).
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
    let settled = false;
    let timer;
    const finish = () => {
      if (settled) return;
      settled = true;
      probing = false;
      clearTimeout(timer);
      if (!stopped) {
        setAudio(context.state === 'running' ? 'ready' : 'blocked');
        if (sound.audio === 'ready') stop();
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
