/** On a workspace: the office's own name for its team. Paseo never reads the key. */
export const TEAM_NAME_KEY = "office.team.name";
export const TEAM_NAME_MAX = 40;

/** A team name as it is kept: one line, trimmed, at most TEAM_NAME_MAX characters; "" for none. */
export function tidyTeamName(name: string): string {
  return name.replace(/\s+/g, " ").trim().slice(0, TEAM_NAME_MAX);
}

/** The team name stored on a workspace, or null when it has none. */
export function storedTeamName(metadata: Readonly<Record<string, unknown>> | null | undefined) {
  const stored = metadata?.[TEAM_NAME_KEY];
  const name = typeof stored === "string" ? tidyTeamName(stored) : "";
  return name === "" ? null : name;
}

/** The name a workspace's team goes by: the office's own, else the workspace's. */
export function teamNameOf(workspace: {
  name: string;
  metadata?: Readonly<Record<string, unknown>> | null;
}): string {
  return storedTeamName(workspace.metadata) ?? workspace.name;
}
