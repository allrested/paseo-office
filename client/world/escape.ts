// Escape in the fullscreen office. A browser gives Escape to fullscreen itself, so the scene's own
// uses of the key (getting up from the karaoke, the pool table or the game sofa, leaving walk-in
// or photo mode, closing a card) never hear it. Where the browser can lock the key to the page
// (Chromium, and so the desktop app), the office holds it while fullscreen and leaves fullscreen
// itself when a press had nothing else to end. Where it cannot, nothing changes.

/**
 * What the scene marks while Escape has something to end there: seated at an activity
 * (`is-gaming`), walking (`is-fp`), photo mode (`is-photo`), the place card, the tour's card.
 */
const SCENE_BODY_MARKS = ["is-gaming", "is-fp", "is-photo"];
const SCENE_OPEN_CARDS = "#plc:not([hidden]), .tour";

/** Whether an Escape pressed in the scene's page now would be used by the scene. */
export function sceneUsesEscape(doc: Document): boolean {
  const marks = doc.body.classList;
  if (SCENE_BODY_MARKS.some((mark) => marks.contains(mark))) return true;
  return doc.querySelector(SCENE_OPEN_CARDS) !== null;
}

/** Whether an Escape pressed in Paseo's page now belongs to an open dialog of it. */
export function pageUsesEscape(doc: Document): boolean {
  return doc.querySelector("dialog[open], [aria-modal='true']") !== null;
}

interface KeyboardLock {
  lock?(keys: string[]): Promise<void>;
  unlock?(): void;
}

function keyboardOf(nav: Navigator): KeyboardLock | undefined {
  return (nav as Navigator & { keyboard?: KeyboardLock }).keyboard;
}

/** Holds Escape for the page while fullscreen; a browser without the lock keeps its own Escape. */
export function lockEscape(nav: Navigator): void {
  // A refusal (not fullscreen any more, no permission) leaves the browser's own Escape.
  void keyboardOf(nav)
    ?.lock?.(["Escape"])
    .catch(() => {});
}

export function unlockEscape(nav: Navigator): void {
  keyboardOf(nav)?.unlock?.();
}

/**
 * Leaves fullscreen after an Escape nothing used. Asked once the press has been handled, so a
 * handler that took it (`preventDefault`) is seen. `used` is read at the press, before any
 * handler ends what it was for.
 */
export function leaveFullscreenAfter(event: KeyboardEvent, used: boolean, page: Document): void {
  if (event.key !== "Escape" || used) return;
  setTimeout(() => {
    if (event.defaultPrevented || page.fullscreenElement === null) return;
    void page.exitFullscreen().catch(() => {});
  }, 0);
}
