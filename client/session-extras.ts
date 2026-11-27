/**
 * What the session panel offers beyond a reply: the slash commands the running session lists, and
 * the session's own options (a model, a mode, whatever its provider draws) as Paseo describes
 * them. Paseo gives a plugin no call of its own for a mode or a model: an option is how one is
 * changed, where the provider has one.
 */

export interface SessionCommand {
  name: string;
  description: string;
}

/** The most commands the list under the reply box shows at once. */
export const COMMANDS_SHOWN = 8;

/**
 * The word a slash command is being typed as: the text after a leading "/", while it is the
 * whole of what is typed. Null once there is a space, a new line, or no slash at the start.
 */
export function commandWord(text: string): string | null {
  return /^\/[^\s/]*$/.test(text) ? text.slice(1).toLowerCase() : null;
}

/** The commands that start with what is typed, then those that only hold it, in the session's order. */
export function matchingCommands(
  commands: readonly SessionCommand[],
  text: string,
): SessionCommand[] {
  const word = commandWord(text);
  if (word === null) return [];
  const starts = commands.filter((command) => command.name.toLowerCase().startsWith(word));
  const holds = commands.filter(
    (command) =>
      !command.name.toLowerCase().startsWith(word) && command.name.toLowerCase().includes(word),
  );
  return [...starts, ...holds].slice(0, COMMANDS_SHOWN);
}

export type SessionOption =
  | { type: "toggle"; key: string; label: string; hint: string | null; value: boolean }
  | {
      type: "select";
      key: string;
      label: string;
      hint: string | null;
      value: string | null;
      choices: { value: string; label: string }[];
    };

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * An agent's options as the panel draws them: each control with the value the agent runs with,
 * or the control's default. A control of a kind the office does not know is left out.
 */
export function sessionOptions(controls: unknown, options: unknown): SessionOption[] {
  if (!Array.isArray(controls)) return [];
  const values = record(options) ?? {};
  const drawn: SessionOption[] = [];
  for (const item of controls) {
    const control = record(item);
    if (control === null) continue;
    const { key, label, type } = control;
    if (typeof key !== "string" || typeof label !== "string") continue;
    const hint = typeof control.description === "string" ? control.description : null;
    const value = values[key] ?? control.defaultValue;
    if (type === "toggle") {
      drawn.push({ type, key, label, hint, value: value === true });
    } else if (type === "select" && Array.isArray(control.choices)) {
      const choices = control.choices.flatMap((raw) => {
        const choice = record(raw);
        return choice !== null &&
          typeof choice.value === "string" &&
          typeof choice.label === "string"
          ? [{ value: choice.value, label: choice.label }]
          : [];
      });
      if (choices.length === 0) continue;
      drawn.push({
        type,
        key,
        label,
        hint,
        value: typeof value === "string" ? value : null,
        choices,
      });
    }
  }
  return drawn;
}
