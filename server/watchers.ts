import { LOOP_NOTE, type Alert } from "../shared/alerts.js";
import type { OfficeAgent } from "../shared/contracts.js";
import { agentTitle } from "../shared/model.js";
import type { DirectoryView } from "./hub.js";

/** A timeline entry as the watchers read it: where it is in the timeline, and the item. */
export interface WatchedEntry {
  seq: number;
  item: {
    type: string;
    status?: unknown;
    name?: unknown;
    callId?: unknown;
    detail?: unknown;
    error?: unknown;
  };
}

export interface WatcherPorts {
  now(): number;
  /** Whether alerts may name a file or a command: the host's streamer mode is off. */
  named(): boolean;
  /** The owner's pinned notes; empty for none. */
  pinnedNotes(): string;
  /** Says the pinned notes to an agent whose conversation was compacted mid-turn. */
  remind(agentId: string, notes: string): void;
  /**
   * Told each alert once, as it is raised, with the name of the agent it is about; a loop again
   * if the office stops the agent's turn.
   */
  raised?(alert: Alert, agent: string | null): void;
  /** Whether the office acts on a loop by itself: the host's Stop repeated failing calls is on. */
  guarding(): boolean;
  /** Sends a line into the agent's running turn. */
  steer(agentId: string, text: string): void;
  /** Stops the agent's running turn; false where the host cannot. */
  stop(agentId: string): Promise<boolean>;
}

export interface Watchers {
  /** The office as the directory reports it; null when the office stops watching. */
  view(view: DirectoryView | null): void;
  /** The newest entries of a running agent's timeline, oldest first, as each activity read sees them. */
  tail(agentId: string, entries: readonly WatchedEntry[]): void;
  alerts(): Alert[];
  dismiss(id: string): void;
  /**
   * Why a request should be refused: the agent asks for the very call that just failed three
   * times running. Null for any other request.
   */
  repeats(agentId: string, request: { name?: unknown; detail?: unknown }): string | null;
}

/** The same failing call this many times running is a loop. */
export const LOOP_CALLS = 3;
/** Two agents changing one file within this long is a clash; a clash and a refusal are shown this long. */
export const CLASH_WINDOW_MS = 10 * 60_000;
export const ALERT_TTL_MS = 30 * 60_000;
const CALLS_KEPT = 30;
const DETAIL_MAX = 200;

const REFUSED = /auto mode classifier|denied by the .{0,40}classifier/i;
const PORT_TAKEN = /EADDRINUSE|address already in use/i;

interface Call {
  id: string;
  sig: string;
  /** What the call was asked to do, as a request for it would say: null where that is not known. */
  ask: string | null;
  tool: string;
  label: string;
  file: string | null;
  status: string;
  error: string;
}

function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;
}

function text(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  const message = field(value, "message");
  if (typeof message === "string") return message;
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return "";
  }
}

function cut(value: string, max = DETAIL_MAX): string {
  const line = value.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

function baseName(path: string): string {
  return path.split(/[\\/]/).at(-1) ?? path;
}

/**
 * A call by what it was asked to do: the tool with its command or its file. A request for a call
 * carries these too, and nothing of how the call ended, so the two can be told to be the same.
 */
function askOf(tool: string, detail: unknown): string | null {
  const command = field(detail, "command");
  if (typeof command === "string" && command !== "") return `${tool}\n${command}`;
  const filePath = field(detail, "filePath");
  return typeof filePath === "string" && filePath !== "" ? `${tool}\n${filePath}` : null;
}

function callOf(item: WatchedEntry["item"]): Call | null {
  if (item.type !== "tool_call" || typeof item.callId !== "string" || item.callId === "") {
    return null;
  }
  const tool = typeof item.name === "string" ? cut(item.name, 40) : "a tool";
  const command = field(item.detail, "command");
  const filePath = field(item.detail, "filePath");
  const isEdit = ["edit", "write"].includes(String(field(item.detail, "type")));
  let label = "";
  if (typeof command === "string") label = cut(command, 80);
  else if (typeof filePath === "string") label = baseName(filePath);
  return {
    id: item.callId,
    // What makes two calls the same call: the tool and what it was given.
    sig: `${tool}\n${text(item.detail)}`,
    ask: askOf(tool, item.detail),
    tool,
    label,
    file: isEdit && typeof filePath === "string" ? filePath : null,
    status: typeof item.status === "string" ? item.status : "",
    error: text(item.error),
  };
}

interface Watched {
  calls: Call[];
  /** The last timeline sequence number read: a compaction after it is new. */
  seq: number;
}

interface Edit {
  agentId: string;
  at: number;
}

/**
 * Notices what Claude Code's hooks would: a loop of failing calls, a call auto mode refused, two
 * agents in one file, a taken port, failing checks. It reads what the office reads anyway (each
 * running agent's newest timeline entries every 5 s, and the directory), so it notices only while
 * an office is open, and for every provider.
 */
export function createWatchers(ports: WatcherPorts): Watchers {
  const watched = new Map<string, Watched>();
  const names = new Map<string, string>();
  const edits = new Map<string, Edit[]>();
  const alerts = new Map<string, Alert>();
  const dismissed = new Set<string>();
  /** The call each looping agent keeps making, and how it failed. */
  const loops = new Map<string, { ask: string; error: string }>();
  /**
   * What the office did about each loop. A loop is acted on from the read after the one that saw
   * it, so that a refused request (`guarded`) has come first. `hinted` is how many identical
   * failures there were when the hint was sent: a stop needs one more.
   */
  const acts = new Map<string, { hinted: number | null; stopped: boolean }>();
  const guarded = new Set<string>();

  function raise(alert: Omit<Alert, "at">): void {
    if (alerts.has(alert.id) || dismissed.has(alert.id)) return;
    const raised = { ...alert, at: ports.now() };
    alerts.set(alert.id, raised);
    ports.raised?.(raised, alert.agentId === undefined ? null : (names.get(alert.agentId) ?? null));
  }
  const nameOf = (agentId: string) => names.get(agentId) ?? "An agent";
  const what = (call: Call) => (ports.named() && call.label !== "" ? call.label : call.tool);

  function noticeLoop(agentId: string, calls: readonly Call[]): void {
    const ended = calls.filter((call) => call.status !== "running");
    const last = ended.slice(-LOOP_CALLS);
    const [first] = last;
    const looping =
      last.length === LOOP_CALLS &&
      first !== undefined &&
      last.every((call) => call.status === "failed" && call.sig === first.sig);
    const id = `loop:${agentId}`;
    if (!looping || first === undefined) {
      // It got past it, or tried something else: the loop is over, and a new one is a new alert.
      alerts.delete(id);
      dismissed.delete(id);
      loops.delete(agentId);
      acts.delete(agentId);
      guarded.delete(agentId);
      return;
    }
    if (first.ask !== null) loops.set(agentId, { ask: first.ask, error: first.error });
    raise({
      id,
      kind: "loop",
      agentId,
      title: `${nameOf(agentId)} is stuck in a loop`,
      detail: cut(`${what(first)} failed ${LOOP_CALLS} times running: ${first.error}`),
    });
    actOnLoop(agentId, first, loopLength(ended));
  }

  /** How many calls at the end failed the same way: the length of the loop so far. */
  function loopLength(ended: readonly Call[]): number {
    const sig = ended.at(-1)?.sig;
    let count = 0;
    for (const call of ended.toReversed()) {
      if (call.status !== "failed" || call.sig !== sig) break;
      count += 1;
    }
    return count;
  }

  async function stopTurn(agentId: string, call: Call, length: number): Promise<void> {
    const id = `loop:${agentId}`;
    const done = await ports.stop(agentId).catch(() => false);
    const kept = alerts.get(id);
    if (!done || kept === undefined) return;
    const detail = `${cut(`${what(call)} failed ${length} times running: ${call.error}`)}. The office stopped its turn: the same call failed again after the hint.`;
    const updated = { ...kept, detail };
    alerts.set(id, updated);
    ports.raised?.(updated, names.get(agentId) ?? null);
  }

  function actOnLoop(agentId: string, call: Call, length: number): void {
    const id = `loop:${agentId}`;
    // A card the owner dismissed is theirs; a request the office refused has already been answered.
    if (!ports.guarding() || dismissed.has(id) || guarded.has(agentId)) return;
    const act = acts.get(agentId);
    if (act === undefined) {
      acts.set(agentId, { hinted: null, stopped: false });
      return;
    }
    if (act.hinted === null) {
      act.hinted = length;
      ports.steer(agentId, LOOP_NOTE);
      return;
    }
    if (length <= act.hinted || act.stopped) return;
    act.stopped = true;
    void stopTurn(agentId, call, length);
  }

  function noticeFailure(agentId: string, call: Call): void {
    if (call.status !== "failed") return;
    if (REFUSED.test(call.error)) {
      const reason = /Reason:\s*(.+?)(?:\. If you|$)/s.exec(call.error)?.[1] ?? call.error;
      raise({
        id: `refused:${agentId}:${call.id}`,
        kind: "refused",
        agentId,
        title: `Auto mode refused a call of ${nameOf(agentId)}`,
        detail: cut(`${what(call)}: ${reason}`),
      });
    }
    const port = PORT_TAKEN.test(call.error) ? /(?::|port\s+)(\d{2,5})\b/i.exec(call.error) : null;
    if (port?.[1] !== undefined) {
      raise({
        id: `port:${agentId}:${port[1]}`,
        kind: "port",
        agentId,
        port: Number(port[1]),
        title: `${nameOf(agentId)} wants port ${port[1]}, which is taken`,
        detail: cut(what(call)),
      });
    }
  }

  function noticeEdit(agentId: string, file: string): void {
    const now = ports.now();
    const recent = (edits.get(file) ?? []).filter((edit) => now - edit.at < CLASH_WINDOW_MS);
    const other = recent.find((edit) => edit.agentId !== agentId);
    edits.set(file, [...recent.filter((edit) => edit.agentId !== agentId), { agentId, at: now }]);
    if (other === undefined) return;
    const [a, b] = [agentId, other.agentId].sort();
    const shown = ports.named() ? baseName(file) : "the same file";
    raise({
      id: `clash:${a}:${b}:${file}`,
      kind: "clash",
      agentId,
      otherAgentId: other.agentId,
      title: `${nameOf(agentId)} and ${nameOf(other.agentId)} are in ${shown}`,
      detail: `Both changed ${shown} within ${CLASH_WINDOW_MS / 60_000} minutes.`,
    });
  }

  function noticeChecks(view: DirectoryView): void {
    const failing = new Set<string>();
    for (const workspace of view.workspaces) {
      const request = workspace.pullRequest;
      if (request?.checks !== "failure") continue;
      const id = `checks:${workspace.id}`;
      failing.add(id);
      const fixer = view.agents.find(
        (agent) => agent.workspaceId === workspace.id && agent.status === "idle",
      );
      const runs = request.runs.filter((run) => run.status === "failure");
      const kept = alerts.get(id);
      // The agent that could fix them changes as agents start and stop: the alert follows.
      if (kept !== undefined) {
        const { agentId: _before, ...rest } = kept;
        alerts.set(id, fixer ? { ...rest, agentId: fixer.id } : rest);
        continue;
      }
      raise({
        id,
        kind: "checks",
        workspaceId: workspace.id,
        ...(fixer ? { agentId: fixer.id } : {}),
        title: `${workspace.name}: the checks fail`,
        detail: cut(runs.map((run) => run.name).join(", ")),
      });
    }
    for (const id of alerts.keys()) {
      if (!id.startsWith("checks:") || failing.has(id)) continue;
      alerts.delete(id);
      dismissed.delete(id);
    }
  }

  function forget(gone: (agent: string) => boolean): void {
    for (const [id, alert] of alerts) {
      if (alert.kind !== "checks" && alert.agentId !== undefined && gone(alert.agentId)) {
        alerts.delete(id);
      }
    }
  }

  function seeAgents(agents: readonly OfficeAgent[]): void {
    const here = new Set(agents.map((agent) => agent.id));
    for (const agent of agents) names.set(agent.id, agentTitle(agent));
    for (const id of watched.keys()) if (!here.has(id)) watched.delete(id);
    for (const id of loops.keys()) if (!here.has(id)) loops.delete(id);
    for (const id of acts.keys()) if (!here.has(id)) acts.delete(id);
    for (const id of guarded) if (!here.has(id)) guarded.delete(id);
    for (const id of names.keys()) if (!here.has(id)) names.delete(id);
    forget((id) => !here.has(id));
    // A turn that ended is past its loop.
    for (const agent of agents) {
      if (agent.status !== "idle") continue;
      alerts.delete(`loop:${agent.id}`);
      loops.delete(agent.id);
      acts.delete(agent.id);
      guarded.delete(agent.id);
    }
  }

  return {
    view(view) {
      if (view === null) {
        watched.clear();
        edits.clear();
        return;
      }
      seeAgents(view.agents);
      noticeChecks(view);
    },
    tail(agentId, entries) {
      const state = watched.get(agentId) ?? { calls: [], seq: -1 };
      const first = !watched.has(agentId);
      watched.set(agentId, state);
      let compacted = false;
      for (const entry of entries) {
        const fresh = entry.seq > state.seq;
        if (fresh && entry.item.type === "compaction" && entry.item.status === "completed") {
          compacted = true;
        }
        const call = callOf(entry.item);
        if (call === null) continue;
        const known = state.calls.findIndex((kept) => kept.id === call.id);
        const changed = known === -1 || state.calls[known]?.status !== call.status;
        if (known === -1) state.calls.push(call);
        else state.calls[known] = call;
        // What the first read finds was there before the office looked: it is not news.
        if (first || !changed) continue;
        noticeFailure(agentId, call);
        if (call.file !== null && call.status !== "failed") noticeEdit(agentId, call.file);
      }
      state.seq = Math.max(state.seq, ...entries.map((entry) => entry.seq));
      state.calls = state.calls.slice(-CALLS_KEPT);
      noticeLoop(agentId, state.calls);
      const notes = ports.pinnedNotes().trim();
      if (compacted && !first && notes !== "") ports.remind(agentId, notes);
    },
    alerts() {
      const now = ports.now();
      for (const [id, alert] of alerts) {
        const passing = alert.kind === "refused" || alert.kind === "clash" || alert.kind === "port";
        if (passing && now - alert.at > ALERT_TTL_MS) alerts.delete(id);
      }
      return [...alerts.values()].sort((a, b) => b.at - a.at);
    },
    repeats(agentId, request) {
      const loop = loops.get(agentId);
      if (loop === undefined) return null;
      const tool = typeof request.name === "string" ? cut(request.name, 40) : "a tool";
      if (askOf(tool, request.detail) !== loop.ask) return null;
      guarded.add(agentId);
      const how = loop.error === "" ? "" : ` (${cut(loop.error, 120)})`;
      return `Office notice: this exact call failed ${LOOP_CALLS} times running${how}. It was not run again. Try another way, or say what is in the way.`;
    },
    dismiss(id) {
      if (alerts.delete(id)) dismissed.add(id);
    },
  };
}
