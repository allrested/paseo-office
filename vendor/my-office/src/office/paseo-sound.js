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

/**
 * Finds out whether this page lets audio start. With no Web Audio it is 'unsupported' at once. Otherwise the first
 * press (pointerup, which counts as a gesture on a touch screen where pointerdown does not, or a key) makes a context
 * of its own, asks it to run, and says 'ready' if it runs and 'blocked' if it throws, rejects or has not run within
 * `timeoutMs`. The context is closed after. Returns the function that stops listening.
 */
export function watchAudio(win = window, timeoutMs = 1500) {
  const Context = win.AudioContext || win.webkitAudioContext;
  if (!Context) {
    setAudio('unsupported');
    return () => {};
  }
  const events = ['pointerup', 'keydown'];
  const stop = () => {
    for (const type of events) win.removeEventListener(type, probe, true);
  };
  function probe() {
    stop();
    let context;
    try {
      context = new Context();
    } catch {
      setAudio('blocked');
      return;
    }
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      setAudio(context.state === 'running' ? 'ready' : 'blocked');
      try {
        Promise.resolve(context.close()).catch(() => {});
      } catch {
        /* already closed */
      }
    };
    const timer = setTimeout(finish, timeoutMs);
    try {
      Promise.resolve(context.resume()).then(finish, finish);
    } catch {
      finish();
    }
  }
  for (const type of events) win.addEventListener(type, probe, true);
  return stop;
}
