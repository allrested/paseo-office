/** A provider's modes, as Paseo lists them. */
export interface ProviderModes {
  modes?: readonly { id: string; label?: string | null }[] | null;
  defaultModeId?: string | null;
}

export interface WriterModeChoice {
  id: string;
  label: string;
}

// Claude's "Accept File Edits", which a provider extending Claude lists too.
const ACCEPT_EDITS_MODE = "acceptEdits";
// A writer that only plans writes nothing, so the mode is not offered.
const PLAN_MODE = "plan";

/** The modes the stand-up writer can be started in: the provider's, less the one that only plans. */
export function writerModeChoices(provider: ProviderModes): WriterModeChoice[] {
  return (provider.modes ?? [])
    .filter((mode) => mode.id !== PLAN_MODE)
    .map((mode) => ({ id: mode.id, label: mode.label?.trim() || mode.id }));
}

export interface WriterMode {
  /** The mode the writer starts in; absent where the provider names none. */
  modeId?: string;
  /** A mode was asked for and the provider does not offer it. */
  fellBack: boolean;
}

/**
 * The mode the writer starts in. `wanted` is the settings' mode, empty for none: then, and for a
 * mode the provider does not offer, it is the provider's mode that accepts edits, else its
 * default. Codex's and OpenCode's default modes edit in the workspace without asking already.
 */
export function writerMode(provider: ProviderModes, wanted: string): WriterMode {
  const choices = writerModeChoices(provider);
  const asked = wanted.trim();
  if (asked !== "" && choices.some((mode) => mode.id === asked)) {
    return { modeId: asked, fellBack: false };
  }
  const acceptsEdits = choices.some((mode) => mode.id === ACCEPT_EDITS_MODE);
  const modeId = acceptsEdits ? ACCEPT_EDITS_MODE : (provider.defaultModeId ?? undefined);
  return { ...(modeId ? { modeId } : {}), fellBack: asked !== "" };
}
