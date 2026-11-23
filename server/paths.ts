import { join, resolve } from "node:path";

// Paseo's home as the daemon finds it (resolvePaseoHome in
// packages/server/src/server/paseo-home.ts), which a plugin cannot import.
function expandHomeDir(input: string, home: string): string {
  if (input.startsWith("~/")) return join(home, input.slice(2));
  if (input === "~") return home;
  return input;
}

/** The plugin runs in a subprocess the daemon starts, which inherits the daemon's env. */
export function paseoHome(env: NodeJS.ProcessEnv, home: string): string {
  return resolve(expandHomeDir(env.PASEO_HOME ?? "~/.paseo", home));
}

export function claudeConfigFile(env: NodeJS.ProcessEnv, home: string): string {
  return join(expandHomeDir(env.CLAUDE_CONFIG_DIR || home, home), ".claude.json");
}

export function officeDir(env: NodeJS.ProcessEnv, home: string): string {
  return join(paseoHome(env, home), "office");
}

export function boardsFile(env: NodeJS.ProcessEnv, home: string): string {
  return join(officeDir(env, home), "boards.json");
}

/** The stand-up notes writer's state: the writer at work and how the last write went. */
export function notesWriterFile(env: NodeJS.ProcessEnv, home: string): string {
  return join(officeDir(env, home), "notes-writer.json");
}

/** What the incidents check has seen in each tracker, and the open incidents. */
export function incidentsFile(env: NodeJS.ProcessEnv, home: string): string {
  return join(officeDir(env, home), "incidents.json");
}

/** The tracker connections saved from the settings. It holds tokens: owner-only. */
export function trackersFile(env: NodeJS.ProcessEnv, home: string): string {
  return join(officeDir(env, home), "trackers.json");
}

/** The team chat's conversation, kept as upstream's engine writes it. */
export function chatFile(env: NodeJS.ProcessEnv, home: string): string {
  return join(officeDir(env, home), "chat.json");
}

/** A folder skills are read from, and the name the card gives it. */
export interface SkillFolder {
  label: string;
  path: string;
}

const SKILL_HOMES = [".claude", ".agents", ".codex"] as const;

/**
 * The host's skills folders. The Claude config folder is `CLAUDE_CONFIG_DIR`, else `~/.claude`, as
 * Claude Code finds it; the other two are where Paseo installs its own skills
 * (packages/server/src/server/orchestration-skills/internal/paths.ts).
 */
export function hostSkillFolders(env: NodeJS.ProcessEnv, home: string): SkillFolder[] {
  const claude = resolve(expandHomeDir(env.CLAUDE_CONFIG_DIR || "~/.claude", home));
  return [
    { label: ".claude", path: join(claude, "skills") },
    { label: ".agents", path: join(home, ".agents", "skills") },
    { label: ".codex", path: join(home, ".codex", "skills") },
  ];
}

/** A workspace's own skills folders, named as the host's are. */
export function workspaceSkillFolders(folder: string): SkillFolder[] {
  return SKILL_HOMES.map((label) => ({ label, path: join(folder, label, "skills") }));
}

export function liftFile(env: NodeJS.ProcessEnv, home: string) {
  return join(officeDir(env, home), "lift.json");
}

/** What the office saw each agent do, for the timeline and the week's recap. */
export function timelineFile(env: NodeJS.ProcessEnv, home: string) {
  return join(officeDir(env, home), "timeline.json");
}

/** What was said in each conversation, while the owner has the history vault on. */
export function vaultFile(env: NodeJS.ProcessEnv, home: string) {
  return join(officeDir(env, home), "vault.json");
}

export function tenureFile(env: NodeJS.ProcessEnv, home: string) {
  return join(officeDir(env, home), "tenure.json");
}

/** The owner's duty list; the day's duties are posts on the duty board in boards.json. */
export function dutiesFile(env: NodeJS.ProcessEnv, home: string) {
  return join(officeDir(env, home), "duties.json");
}
