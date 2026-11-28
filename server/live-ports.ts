import { stat } from "node:fs/promises";
import type { AgentSnapshotPayload } from "@getpaseo/protocol/messages";
import {
  ACTIVITY_BACKGROUND_MS,
  ACTIVITY_INTERVAL_MS,
  ACTIVITY_TAIL_LIMIT,
  startActivityPoller,
} from "./activity.js";
import {
  GroupSessionUnavailable,
  lastAssistantText,
  type ChatServicePorts,
} from "./chat-service.js";
import { PARENT_AGENT_ID_LABEL } from "./directory.js";
import { writerMode, writerModeChoices } from "./writer-mode.js";
import type { WriterModes } from "../shared/contracts.js";
import {
  NO_ROSTER,
  ROSTER_MEMBER_KEY,
  findRosterTeam,
  rosterTeamById,
  seatOf,
  storedRosterMark,
  type Roster,
} from "../shared/roster.js";
import type { Hub, HubPorts } from "./hub.js";
import type { JanitorPorts } from "./janitor.js";
import { wakeTargetOf } from "./mention-queue.js";
import { entryWritten, nodeNotesFs } from "./notes-files.js";
import { NOTES_WRITER_TITLE, type NotesPorts } from "./notes-writer.js";
import type { OfficeAgentPorts } from "./office.js";
import { openPaseoDirectory } from "./paseo-directory.js";
import type { Paseo, PaseoHolder } from "./paseo-holder.js";
import type { SkillFolder } from "./paths.js";
import type { ScriptLogPorts } from "./script-log.js";
import { nodeSkillFiles, type SkillsPorts } from "./skills.js";
import type { Timers } from "./timers.js";
import type { WatchedEntry } from "./watchers.js";

/** Hub ports on the daemon's own API. The holder is set before the first attach. */
export function liveHubPorts(
  holder: PaseoHolder,
  timers: Timers,
  log: (message: string) => void,
  /** Whether steps name what they are at: the host's streamer mode is off. */
  named: () => boolean = () => false,
  /** Told each read's entries, for whoever watches the calls themselves. */
  onTail?: (agentId: string, entries: readonly WatchedEntry[]) => void,
): HubPorts {
  return {
    openDirectory: (onChange, onEnd) => openPaseoDirectory(holder.require(), onChange, log, onEnd),
    startActivity: (running, onChange, watched) => {
      const paseo = holder.require();
      const poller = startActivityPoller({
        running,
        tail: async (agentId) => {
          const page = await paseo.agents
            .ref(agentId)
            .timeline.refetch({ direction: "tail", limit: ACTIVITY_TAIL_LIMIT });
          onTail?.(
            agentId,
            page.entries.map((entry) => ({ seq: entry.seqEnd, item: entry.item })),
          );
          return page.entries.map((entry) => entry.item);
        },
        timers,
        log,
        named,
        onChange,
        interval: () => (watched?.() === false ? ACTIVITY_BACKGROUND_MS : ACTIVITY_INTERVAL_MS),
      });
      return () => poller.stop();
    },
    timers,
    log,
    setAgentMetadata: (agentId, patch) => holder.require().agents.ref(agentId).setMetadata(patch),
  };
}

/**
 * How far back a hand-over looks for the holder's last answer: whole turns, so a turn the plan
 * ran out in, with no answer of its own, still leaves the one before it.
 */
const LAST_ANSWER_TAIL_LIMIT = 50;

/** A finished-turn notification is normal for an available agent. Other attention needs the user. */
function availableForOfficeWork(agent: AgentSnapshotPayload, home = false): boolean {
  const attention = agent.requiresAttention || agent.attentionReason;
  return (
    // Closed and not archived is at home: a task's prompt starts its runtime again. Only a task
    // calls it back (`home`); a line in the group chat does not.
    (agent.status === "idle" || (home && agent.status === "closed")) &&
    !agent.archivedAt &&
    !agent.activeTurn &&
    !agent.backgroundWork?.count &&
    !agent.providerUnavailable &&
    agent.pendingPermissions.length === 0 &&
    (!attention || agent.attentionReason === "finished") &&
    !agent.internal &&
    !agent.background &&
    !agent.labels?.[PARENT_AGENT_ID_LABEL]?.trim() &&
    agent.title !== NOTES_WRITER_TITLE
  );
}

/**
 * Wake ports on the daemon's own API; the holder is set by every hook and handler. `roster` is the
 * roster as the settings now have it; an agent's teammate is the mark stored on it. `costOf` reads
 * the cost the directory last had for an agent, `working` whether it is in a turn.
 */
export function liveAgentPorts(
  holder: PaseoHolder,
  roster: () => Roster = () => NO_ROSTER,
  costOf: (agentId: string) => number | undefined = () => undefined,
  working: (agentId: string) => boolean = () => false,
): OfficeAgentPorts {
  // Resolves null for an agent the daemon does not know; rejects only for an empty id or a start
  // of an id that several agents share.
  const refresh = (agentId: string) => holder.require().agents.ref(agentId).refresh();
  return {
    async lobbyCandidates() {
      if (!holder.held()) return [];
      const agents = holder.require().agents;
      const ids = new Set<string>();
      // Whoever is in the office first; those at home come in only for what is left over, the
      // one that left last first.
      for (const [status, direction] of [
        ["idle", "asc"],
        ["closed", "desc"],
      ] as const) {
        let cursor: string | undefined;
        do {
          const result = await agents.list({
            filter: { statuses: [status] },
            sort: [{ key: "updated_at", direction }],
            page: { limit: 200, cursor },
          });
          for (const { agent } of result.entries) {
            if (availableForOfficeWork(agent, true)) ids.add(agent.id);
          }
          cursor = result.pageInfo.nextCursor ?? undefined;
        } while (cursor);
      }
      return [...ids];
    },
    async lobbyEligible(agentId) {
      const result = await refresh(agentId);
      return result !== null && availableForOfficeWork(result.agent, true);
    },
    async status(agentId) {
      const result = await refresh(agentId);
      return wakeTargetOf(result === null ? null : result.agent);
    },
    async resolve(agentId) {
      const result = await refresh(agentId);
      // The daemon finds archived agents by id too; the queue would drop a post for one unsent.
      return result === null || wakeTargetOf(result.agent) === "gone" ? null : result.agent.id;
    },
    // Waits for the API: the boards load, and copy the lobby claims, before any hook has run.
    async workspaceOf(agentId) {
      const result = await (await holder.wait()).agents.ref(agentId).refresh();
      return result?.agent.workspaceId ?? null;
    },
    // A turn may start between the status read and the send. A prompt with a source agent joins
    // it (the daemon steers agent messages); one as from the user would cut it unless it steers.
    send: (agentId, prompt, source, messageId) =>
      holder
        .require()
        .agents.ref(agentId)
        .send(prompt, {
          ...(source === null
            ? { activeTurnBehavior: "steer" as const }
            : { sourceAgentId: source }),
          ...(messageId ? { messageId } : {}),
        }),
    async teamOf(agentId) {
      const result = await refresh(agentId);
      const mark = storedRosterMark(result?.agent.metadata?.[ROSTER_MEMBER_KEY]);
      return seatOf(roster(), mark)?.team.id ?? null;
    },
    findTeam: async (nameOrId) => findRosterTeam(roster(), nameOrId)?.id ?? null,
    teamName: (teamId) => rosterTeamById(roster(), teamId)?.name ?? null,
    costOf,
    working,
    async providerOf(agentId) {
      const result = await refresh(agentId);
      return result?.agent.provider || null;
    },
    async lastAnswerOf(agentId, since) {
      const page = await holder
        .require()
        .agents.ref(agentId)
        .timeline.refetch({ direction: "tail", limit: LAST_ANSWER_TAIL_LIMIT, wholeTurns: true });
      if (page.error) throw new Error(page.error);
      // An entry with no time cannot be placed after the claim. A turn counts by when it ended.
      const timed = page.entries.flatMap((entry) => {
        const at = Date.parse(entry.timestamp ?? "");
        return Number.isNaN(at) ? [] : [{ entry, at }];
      });
      const ended = new Map<string, number>();
      for (const { entry, at } of timed) {
        const turn = entry.turnId ?? `@${at}`;
        ended.set(turn, Math.max(ended.get(turn) ?? at, at));
      }
      const recent = timed.filter(
        ({ entry, at }) => (ended.get(entry.turnId ?? `@${at}`) ?? at) >= since,
      );
      return lastAssistantText(recent.map(({ entry }) => entry.item));
    },
  };
}

/** The team chat's ports on the daemon's own API; the holder is set by every hook and handler. */
export function liveChatPorts(holder: PaseoHolder): Pick<ChatServicePorts, "send" | "readTurn"> {
  return {
    async send(agentId, prompt, images, delivery) {
      const ref = holder.require().agents.ref(agentId);
      if (delivery?.group) {
        const result = await ref.refresh();
        if (!result || !availableForOfficeWork(result.agent))
          throw new GroupSessionUnavailable("The session is no longer available for a group reply");
      }
      await ref.send(prompt, {
        activeTurnBehavior: "steer",
        ...(delivery ? { messageId: delivery.messageId } : {}),
        ...(images ? { images } : {}),
      });
    },
    // The hook's own recipe (PluginHookEvents["agent.turn.after"]): the latest whole turn, kept
    // only when it is the turn that ended. A null turn id has no entries.
    async readTurn(agentId, turnId, group, officeIds = []) {
      const missing = { matches: !group, text: null };
      if (turnId === null) return missing;
      const timeline = holder.require().agents.ref(agentId).timeline;
      const options = { limit: 1, wholeTurns: true };
      let page = await timeline.refetch({ direction: "tail", ...options });
      // Another turn may already have started by the time this hook reads. Only walk back to
      // the reservation; a group message cannot be present in any older turn.
      if (group)
        while (
          !page.error &&
          !page.entries.some((entry) => entry.turnId === turnId) &&
          page.hasOlder &&
          page.startCursor &&
          Date.parse(page.entries[0]?.timestamp ?? "") >= group.sentAt
        ) {
          page = await timeline.refetch({
            direction: "before",
            cursor: page.startCursor,
            ...options,
          });
        }
      if (page.error) throw new Error(page.error);
      const turn = page.entries.filter((entry) => entry.turnId === turnId);
      const items = turn.map((entry) => entry.item);
      if (!group) return { matches: true, text: lastAssistantText(items) };
      const index = items.findIndex(
        (item) =>
          item.type === "user_message" &&
          (item.clientMessageId === group.messageId || item.messageId === group.messageId),
      );
      if (index < 0) return missing;
      const known = new Set([group.messageId, ...officeIds]);
      const privateTurn = items.some(
        (item) =>
          item.type === "user_message" &&
          !known.has(item.clientMessageId ?? "") &&
          !known.has(item.messageId ?? ""),
      );
      if (privateTurn) return { matches: true, privateTurn: true, text: null };
      return { matches: true, text: lastAssistantText(items.slice(index + 1)) };
    },
  };
}

/** Janitor ports on the daemon's own API; the holder is set by the handler that uses them. */
export function liveJanitorPorts(holder: PaseoHolder): JanitorPorts {
  const ref = (agentId: string) => holder.require().agents.ref(agentId);
  return {
    async status(agentId) {
      const result = await ref(agentId).refresh();
      if (result === null) return null;
      // An archived agent keeps the status it was archived in; it takes no prompt.
      return result.agent.archivedAt ? "closed" : result.agent.status;
    },
    async commands(agentId) {
      const { commands, error } = await ref(agentId).commands();
      if (error !== null && commands.length === 0) throw new Error(error);
      return commands.map((command) => command.name);
    },
    send: (agentId, text) => ref(agentId).send(text),
  };
}

/** Skill ports on the daemon's own disk and API; the holder is set by the handler that uses them. */
export function liveSkillsPorts(
  holder: PaseoHolder,
  hub: Pick<Hub, "workspaceIds">,
  hostFolders: readonly SkillFolder[],
  now: () => number,
  log: (message: string) => void,
): SkillsPorts {
  return {
    files: nodeSkillFiles,
    hostFolders,
    workspaceIds: () => hub.workspaceIds(),
    async workspaceFolder(workspaceId) {
      const snapshot = await holder.require().workspaces.ref(workspaceId).refresh();
      return snapshot?.workspaceDirectory ?? snapshot?.projectRootPath ?? null;
    },
    now,
    log,
  };
}

/** Log ports on the daemon's own API; the holder is set by the handler that uses them. */
export function liveScriptLogPorts(
  holder: PaseoHolder,
  hub: Pick<Hub, "script">,
  now: () => number,
): ScriptLogPorts {
  return {
    script: (workspaceId, name) => hub.script(workspaceId, name),
    async tail(terminalId, rows) {
      // A negative start counts from the end (packages/server/src/terminal/terminal-capture.ts).
      const captured = await holder
        .require()
        .terminals.ref(terminalId)
        .capture({ start: -rows, stripAnsi: true });
      return { lines: captured.lines, total: captured.totalLines };
    },
    now,
  };
}

type AgentConfig = Parameters<Paseo["agents"]["create"]>[0]["config"];

/**
 * The host's default provider, as the host can tell it. The app's new-agent form starts from the
 * provider the device chose last, which the host never sees; so this takes the first enabled,
 * ready provider in the daemon's order, with the model the form gives that provider: its default
 * (else its first selectable one). The mode is `writerMode`'s: the settings' where the provider
 * offers it, else the one that accepts edits, else the provider's default. Nobody watches the
 * 8:00 writer, so by default it edits the notes without asking.
 */
async function writerProvider(paseo: Paseo, cwd: string) {
  const { entries } = await paseo.providers.waitForReady({ cwd });
  const entry = entries.find((candidate) => candidate.enabled && candidate.status === "ready");
  if (entry === undefined) throw new Error("No agent provider is ready on this host");
  return entry;
}

/** The provider the writer would start on now, its modes, and the one `wanted` comes to. */
export async function readWriterModes(
  holder: PaseoHolder,
  cwd: string,
  wanted: string,
): Promise<WriterModes> {
  const entry = await writerProvider(holder.require(), cwd);
  const { modeId, fellBack } = writerMode(entry, wanted);
  return {
    provider: entry.label ?? entry.provider,
    modes: writerModeChoices(entry),
    modeId: modeId ?? null,
    fellBack,
  };
}

async function defaultAgentConfig(paseo: Paseo, cwd: string, wanted: string): Promise<AgentConfig> {
  const entry = await writerProvider(paseo, cwd);
  const models = (entry.models ?? []).filter((model) => model.isSelectable !== false);
  const model = models.find((candidate) => candidate.isDefault) ?? models[0];
  if (model === undefined) {
    throw new Error(`The provider ${entry.label ?? entry.provider} offers no model`);
  }
  const { modeId } = writerMode(entry, wanted);
  return {
    provider: `${entry.provider}/${model.id}`,
    ...(modeId ? { modeId } : {}),
  };
}

/** The notes writer's ports on the daemon's own API and disk; the caller adds the rest. */
export function liveNotesPorts(
  holder: PaseoHolder,
  hub: Pick<Hub, "read">,
): Pick<NotesPorts, "snapshot" | "isDirectory" | "startAgent" | "archive" | "alive" | "hasEntry"> {
  return {
    snapshot: () => hub.read(),
    isDirectory: (path) =>
      stat(path).then(
        (found) => found.isDirectory(),
        () => false,
      ),
    async startAgent({ cwd, title, prompt, mode }) {
      const paseo = holder.require();
      const config = await defaultAgentConfig(paseo, cwd, mode ?? "");
      const workspace = await paseo.workspaces.open(cwd);
      const agent = await workspace.agents.create({ config, title, prompt });
      return agent.id;
    },
    async archive(agentId) {
      await holder.require().agents.ref(agentId).archive();
    },
    async alive(agentId) {
      const result = await holder.require().agents.ref(agentId).refresh();
      if (result === null || result.agent.archivedAt) return false;
      return result.agent.status === "running" || result.agent.status === "initializing";
    },
    hasEntry: ({ folder, ...day }) => entryWritten(folder, day, nodeNotesFs),
  };
}
