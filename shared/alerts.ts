import { z } from "zod";

/**
 * What the office noticed and the owner may want to act on:
 * - `loop`: an agent made the same failing call three times running;
 * - `refused`: the provider's auto mode refused a call;
 * - `clash`: two agents changed the same file within a few minutes;
 * - `port`: a command failed because its port is taken;
 * - `checks`: the checks of a workspace's pull request fail.
 */
export const ALERT_KINDS = ["loop", "refused", "clash", "port", "checks"] as const;
export type AlertKind = (typeof ALERT_KINDS)[number];

export const AlertSchema = z.object({
  id: z.string(),
  kind: z.enum(ALERT_KINDS),
  /** Epoch ms it was first noticed. */
  at: z.number(),
  /** Whom it is about; for `checks`, an agent of the workspace that rests and could fix them. */
  agentId: z.string().optional(),
  /** `clash`: the other agent. */
  otherAgentId: z.string().optional(),
  workspaceId: z.string().optional(),
  /** `port`: the port that is taken. */
  port: z.number().optional(),
  title: z.string(),
  detail: z.string(),
});
export type Alert = z.output<typeof AlertSchema>;

/** The most characters of a pinned note, and of a hint sent from an alert. */
export const PINNED_NOTES_MAX = 1000;
export const HINT_MAX = 500;

/** What "Tell both", "Tell the agent" and "Fix it" send. One line each: an agent reads it mid-turn. */
export function clashNote(file: string, other: string): string {
  return `Office notice: another session (${other}) changed ${file} in the last few minutes. Read the file again before you change it, and do not undo that session's work.`;
}
export function portNote(port: number, holder: string | null): string {
  const who = holder === null ? "another process" : `another session's server (${holder})`;
  return `Office notice: port ${port} is held by ${who}. Do not stop it; start yours on another port.`;
}
export function checksNote(failing: string): string {
  return `The checks of this workspace's pull request are failing${failing === "" ? "" : ` (${failing})`}. Find out why and fix it, then say what you changed.`;
}
export function pinnedNote(notes: string): string {
  return `Office notice: this conversation was just compacted. The owner's pinned notes still apply:\n${notes}`;
}
